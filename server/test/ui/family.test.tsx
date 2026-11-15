import { afterEach, test, expect } from "bun:test";
import {
  cleanup,
  render,
  screen,
  waitFor,
  fireEvent,
  act,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig, useSWRConfig } from "swr";
import { MemoryRouter } from "react-router-dom";
import { ConfirmationProvider } from "@/components/confirmation";
import { LineConnection } from "@/LineConnection";
import { Inventory } from "@/Inventory";
import type { Food } from "@/model";
const originalFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
test("LINE pairing shows direct-chat instructions, updates connection status and confirms disconnect", async () => {
  let linked = false;
  const mutations: string[] = [];
  let refresh: () => Promise<unknown> = async () => {};
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (method !== "GET") mutations.push(method + " " + url);
      if (url.endsWith("/pair"))
        return json({
          code: "FW-ABCD-EFGH",
          expires_at_s: Math.floor(Date.now() / 1000) + 600,
        });
      if (method === "DELETE") {
        linked = false;
        return json({ ok: true });
      }
      if (url.endsWith("/test")) return json({ queued: true }, 202);
      return json({
        linked,
        ready: true,
        friend_url: "https://line.me/R/ti/p/%40foodwarden",
      });
    },
    { preconnect: originalFetch.preconnect },
  );
  function Probe() {
    const { mutate } = useSWRConfig();
    refresh = () => mutate("/api/me/line");
    return <LineConnection language="en" />;
  }
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ConfirmationProvider language="en">
        <Probe />
      </ConfirmationProvider>
    </SWRConfig>,
  );
  const user = userEvent.setup({ document });
  await user.click(
    await screen.findByRole("button", { name: "Create connection code" }),
  );
  expect(await screen.findByText("FW-ABCD-EFGH")).toBeTruthy();
  expect(
    screen.getByText("Send personal codes in a direct chat, never in a group."),
  ).toBeTruthy();
  expect(screen.getByTitle("Scan to add FoodWarden")).toBeTruthy();
  linked = true;
  await act(async () => {
    await refresh();
  });
  await user.click(await screen.findByRole("button", { name: "Disconnect" }));
  expect(screen.getByRole("alertdialog")).toBeTruthy();
  expect(mutations.some((value) => value.startsWith("DELETE"))).toBe(false);
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await user.click(screen.getByRole("button", { name: "Send test" }));
  expect(mutations).toContain("POST /api/me/line/test");
});
const food: Food = {
  id: "milk",
  nameEn: "Milk",
  nameTh: "นม",
  expiry: "2030-01-01",
  category: "Dairy",
  adviceEn: "",
  adviceTh: "",
  hasPhoto: false,
};
test("inventory search, private favorites and bulk removal use real scoped endpoints", async () => {
  const calls: string[] = [];
  let favorite = false;
  let reloads = 0;
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push(method + " " + url);
      if (method === "PUT" && url.endsWith("/favorites/milk")) {
        favorite = true;
        return json({ ok: true });
      }
      if (method === "DELETE") return json({ ok: true });
      return json({
        items: favorite
          ? [
              {
                item_key: "a".repeat(64),
                name_th: "นม",
                name_en: "Milk",
                category: "Dairy",
                count: 1,
              },
            ]
          : [],
        categories: [],
        category_counts: { Dairy: 1 },
      });
    },
    { preconnect: originalFetch.preconnect },
  );
  render(
    <MemoryRouter>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <ConfirmationProvider language="en">
          <Inventory
            fridgeId="kitchen"
            language="en"
            items={[
              food,
              {
                ...food,
                id: "apple",
                nameEn: "Apple",
                nameTh: "แอปเปิล",
                category: "Produce",
              },
            ]}
            onChanged={() => reloads++}
          />
        </ConfirmationProvider>
      </SWRConfig>
    </MemoryRouter>,
  );
  const user = userEvent.setup({ document });
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "Favorite: Milk",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  await user.click(screen.getByRole("button", { name: "Favorite: Milk" }));
  await screen.findByRole("button", { name: "Remove favorite: Milk" });
  fireEvent.change(screen.getByRole("searchbox", { name: "Search food" }), {
    target: { value: "Milk" },
  });
  expect(screen.queryByText("Apple")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Select" }));
  await user.click(
    screen.getByRole("button", { name: "Select all visible food" }),
  );
  await user.click(screen.getByRole("button", { name: "Take out" }));
  expect(calls.some((value) => value.startsWith("DELETE"))).toBe(false);
  await user.click(screen.getByRole("button", { name: /^Take out$/ }));
  await waitFor(() => expect(reloads).toBe(1));
  expect(calls).toContain("DELETE /api/fridges/kitchen/inventory/milk");
  expect(calls).not.toContain("DELETE /api/fridges/kitchen/inventory/apple");
});
