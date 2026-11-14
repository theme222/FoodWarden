import { afterEach, test, expect } from "bun:test";
import {
  cleanup,
  render,
  screen,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
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
        <Select value={value} onValueChange={setValue}>
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
  await user.click(screen.getByRole("combobox", { name: "Member role" }));
  await user.click(await screen.findByRole("option", { name: "Owner" }));
  expect(screen.getByRole("status").textContent).toBe("owner");
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
