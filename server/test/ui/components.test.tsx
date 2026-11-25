import { afterEach, test, expect } from "bun:test";
import { createAgent } from "@ui-sdk/react/agent";
import {
  cleanup,
  render,
  screen,
  waitFor,
  fireEvent,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { MemoryRouter } from "react-router-dom";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { ConfirmationProvider, useConfirm } from "@/components/confirmation";
import { StatusAlert } from "@/components/status-alert";
import { ThemeLanguagePicker } from "@/components/theme-picker";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ComponentGalleryPage } from "@/pages/ComponentGalleryPage";

afterEach(cleanup);
test("confirmation requires an explicit action and cancellation never runs destructive work", async () => {
  let accepted = 0;
  function Action() {
    const confirm = useConfirm();
    return (
      <button
        type="button"
        onClick={async () => {
          if (await confirm("Permanently remove this item?", "Delete item"))
            accepted++;
        }}
      >
        Remove item
      </button>
    );
  }
  render(
    <ConfirmationProvider language="en">
      <Action />
    </ConfirmationProvider>,
  );
  const user = userEvent.setup({ document });
  await user.click(screen.getByRole("button", { name: "Remove item" }));
  expect(screen.getByRole("alertdialog")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(accepted).toBe(0);
  await user.click(screen.getByRole("button", { name: "Remove item" }));
  await user.click(screen.getByRole("button", { name: "Delete item" }));
  expect(accepted).toBe(1);
});
test("dialog has an accessible name, closes with Escape and returns focus", async () => {
  render(
    <Dialog>
      <DialogTrigger>Open details</DialogTrigger>
      <DialogContent>
        <DialogTitle>Food details</DialogTitle>
        <DialogDescription>Information about your food</DialogDescription>
        <DialogClose>Done</DialogClose>
      </DialogContent>
    </Dialog>,
  );
  const user = userEvent.setup({ document });
  const trigger = screen.getByRole("button", { name: "Open details" });
  await user.click(trigger);
  expect(screen.getByRole("dialog", { name: "Food details" })).toBeTruthy();
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(trigger));
});
test("tabs respond to keyboard navigation and a controlled select changes its value", async () => {
  function Example() {
    const [value, setValue] = useState<string | null>("member");
    return (
      <>
        <Tabs defaultValue="food">
          <TabsList aria-label="Sections">
            <TabsTrigger value="food">Food</TabsTrigger>
            <TabsTrigger value="devices">Devices</TabsTrigger>
          </TabsList>
          <TabsContent value="food">Food panel</TabsContent>
          <TabsContent value="devices">Devices panel</TabsContent>
        </Tabs>
        <Select
          items={{ member: "Member", owner: "Owner" }}
          value={value}
          onValueChange={setValue}
        >
          <SelectTrigger aria-label="Member role">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="member">Member</SelectItem>
            <SelectItem value="owner">Owner</SelectItem>
          </SelectContent>
        </Select>
        <output>{value}</output>
      </>
    );
  }
  render(<Example />);
  const user = userEvent.setup({ document });
  await user.click(screen.getByRole("tab", { name: "Food" }));
  await user.keyboard("{ArrowRight}");
  await user.keyboard("{Enter}");
  expect(
    screen.getByRole("tab", { name: "Devices" }).getAttribute("aria-selected"),
  ).toBe("true");
  const role = screen.getByRole("combobox", { name: "Member role" });
  expect(role.querySelector('[data-slot="select-value"]')?.textContent).toBe(
    "Member",
  );
  await user.click(role);
  await user.click(await screen.findByRole("option", { name: "Owner" }));
  expect(screen.getByRole("status").textContent).toBe("owner");
  expect(role.querySelector('[data-slot="select-value"]')?.textContent).toBe(
    "Owner",
  );
});
test("alerts and tables preserve semantic roles", () => {
  render(
    <>
      <StatusAlert>Connection lost</StatusAlert>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Food</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>Milk</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </>,
  );
  expect(screen.getByRole("alert").textContent).toContain("Connection lost");
  expect(screen.getByRole("columnheader").textContent).toBe("Food");
});
test("tabs root carries horizontal orientation stack class and gallery renders all sections across languages", async () => {
  const { container } = render(
    <Tabs defaultValue="a">
      <TabsList>
        <TabsTrigger value="a">A</TabsTrigger>
        <TabsTrigger value="b">B</TabsTrigger>
      </TabsList>
      <TabsContent value="a">Panel A</TabsContent>
      <TabsContent value="b">Panel B</TabsContent>
    </Tabs>,
  );
  const root = container.querySelector('[data-slot="tabs"]');
  expect(root?.getAttribute("data-orientation")).toBe("horizontal");
  expect(root?.className).toContain("data-[orientation=horizontal]:flex-col");
  cleanup();

  const languageChanges: string[] = [];
  const themeChanges: string[] = [];
  render(
    <MemoryRouter>
      <ConfirmationProvider language="th">
        <ComponentGalleryPage
          language="th"
          colorTheme="green"
          onLanguageChange={(next) => languageChanges.push(next)}
          onColorThemeChange={(next) => themeChanges.push(next)}
        />
      </ConfirmationProvider>
    </MemoryRouter>,
  );

  expect(
    screen.getByRole("heading", { name: "คลังคอมโพเนนต์และสถานะ" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("heading", { name: /7\. แผนผังอุปกรณ์และสถานะโหนด/ }),
  ).toBeTruthy();
  expect(
    screen.getByRole("heading", { name: /8\. กราฟข้อมูลเซนเซอร์/ }),
  ).toBeTruthy();
  expect(
    screen.getByRole("heading", { name: /9\. การ์ดรายการอาหาร/ }),
  ).toBeTruthy();

  const user = userEvent.setup({ document });
  await user.click(screen.getByRole("button", { name: "EN" }));
  await user.click(screen.getByRole("button", { name: "ฟ้าสบายตา" }));
  const favorite = screen.getByRole("button", {
    name: "รายการโปรด: นมสด",
  });
  expect(favorite.getAttribute("aria-pressed")).toBe("false");
  favorite.focus();
  await user.keyboard(" ");
  expect(favorite.getAttribute("aria-pressed")).toBe("true");
  expect(
    createAgent()
      .snapshot()
      .map((entry) => entry.label),
  ).toContain("รายการโปรด: นมสด");
  expect(languageChanges).toEqual(["en"]);
  expect(themeChanges).toEqual(["blue"]);

  cleanup();
  render(
    <MemoryRouter>
      <ConfirmationProvider language="en">
        <ComponentGalleryPage
          language="en"
          colorTheme="blue"
          onLanguageChange={() => {}}
          onColorThemeChange={() => {}}
        />
      </ConfirmationProvider>
    </MemoryRouter>,
  );
  expect(
    screen.getByRole("heading", { name: "Component & State Gallery" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("heading", { name: /4\.5 Form & Layout Primitives/ }),
  ).toBeTruthy();

  const search = screen.getByRole("searchbox", { name: "Find a demo section" });
  await user.type(search, "unmatched demo");
  expect(screen.getByText("0 sections found")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Clear" }));
  await user.type(search, "chart");
  expect(screen.getByText("1 sections found")).toBeTruthy();
  const chart = within(
    screen.getByRole("region", { name: /Sensor Chart States/ }),
  );
  await user.click(chart.getByRole("button", { name: "Loading" }));
  expect(chart.getByRole("status")).toBeTruthy();
  await user.click(chart.getByRole("button", { name: "Empty" }));
  expect(
    chart.getByText("No values for this metric in the selected period."),
  ).toBeTruthy();
  await user.click(chart.getByRole("button", { name: "Error" }));
  expect(chart.getByRole("alert")).toBeTruthy();

  await user.click(
    screen.getByRole("button", { name: "Edit Fresh Pasteurized Milk" }),
  );
  const edit = within(
    await screen.findByRole("dialog", { name: "Edit quantity" }),
  );
  const quantity = edit.getByRole("spinbutton");
  await user.clear(quantity);
  await user.type(quantity, "4");
  await user.click(edit.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "Edit quantity" })).toBeNull(),
  );
  const takeOut = screen.getByRole("button", {
    name: "Take out Fresh Pasteurized Milk",
  });
  await user.click(takeOut);
  await user.click(
    within(await screen.findByRole("alertdialog")).getByRole("button", {
      name: "Cancel",
    }),
  );
  expect(takeOut.isConnected).toBe(true);
  await user.click(takeOut);
  await user.click(
    within(await screen.findByRole("alertdialog")).getByRole("button", {
      name: "Take out",
    }),
  );
  await waitFor(() => expect(takeOut.isConnected).toBe(false));
  await user.click(screen.getByRole("button", { name: "Reset inventory" }));
  expect(
    screen.getByRole("button", { name: "Take out Fresh Pasteurized Milk" }),
  ).toBeTruthy();
});
test("shadcn form primitives toggle state and ThemeLanguagePicker updates via Base UI Select", async () => {
  const languages: string[] = [];
  const themes: string[] = [];
  function Probe() {
    const [checked, setChecked] = useState(false);
    const [enabled, setEnabled] = useState(false);
    return (
      <>
        <Card>
          <CardHeader>
            <CardTitle>Controls</CardTitle>
          </CardHeader>
          <CardContent>
            <Label htmlFor="item-input">Item</Label>
            <Input id="item-input" defaultValue="Milk" />
            <Badge variant="fresh">Fresh</Badge>
            <Checkbox
              aria-label="Agree"
              checked={checked}
              onCheckedChange={(next) => setChecked(Boolean(next))}
            />
            <Switch
              aria-label="Notify"
              checked={enabled}
              onCheckedChange={(next) => setEnabled(Boolean(next))}
            />
            <Separator />
            <Skeleton data-testid="loading-skeleton" />
          </CardContent>
        </Card>
        <ThemeLanguagePicker
          language="en"
          colorTheme="green"
          onLanguageChange={(next) => languages.push(next)}
          onColorThemeChange={(next) => themes.push(next)}
        />
      </>
    );
  }
  render(<Probe />);
  const user = userEvent.setup({ document });
  expect((screen.getByLabelText("Item") as HTMLInputElement).value).toBe(
    "Milk",
  );
  expect(screen.getByText("Fresh").getAttribute("data-variant")).toBe("fresh");
  expect(screen.getByTestId("loading-skeleton").getAttribute("data-slot")).toBe(
    "skeleton",
  );

  const checkbox = screen.getByRole("checkbox", { name: "Agree" });
  expect(checkbox.getAttribute("aria-checked")).toBe("false");
  await user.click(checkbox);
  expect(checkbox.getAttribute("aria-checked")).toBe("true");

  const sw = screen.getByRole("switch", { name: "Notify" });
  expect(sw.getAttribute("aria-checked")).toBe("false");
  await user.click(sw);
  expect(sw.getAttribute("aria-checked")).toBe("true");

  await user.click(screen.getByRole("combobox", { name: "Language" }));
  await user.click(await screen.findByRole("option", { name: "ภาษาไทย" }));
  await user.click(screen.getByRole("combobox", { name: "Color palette" }));
  await user.click(await screen.findByRole("option", { name: "Pink" }));
  expect(languages).toEqual(["th"]);
  expect(themes).toEqual(["pink"]);
});
