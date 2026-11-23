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
import { GatewaySimulator } from "@/GatewaySimulator";
import { Inventory } from "@/Inventory";
import type { Food } from "@/model";
const originalFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  sessionStorage.clear();
  localStorage.clear();
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
  function renderConnection() {
    return render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <ConfirmationProvider language="en">
          <Probe />
        </ConfirmationProvider>
      </SWRConfig>,
    );
  }
  renderConnection();
  const user = userEvent.setup({ document });
  await user.click(
    await screen.findByRole("button", { name: "Create connection code" }),
  );
  expect(await screen.findByText("FW-ABCD-EFGH")).toBeTruthy();
  expect(
    screen.getByText("Send personal codes in a direct chat, never in a group."),
  ).toBeTruthy();
  expect(screen.getByTitle("Scan to add FoodWarden")).toBeTruthy();
  cleanup();
  renderConnection();
  expect(await screen.findByText("FW-ABCD-EFGH")).toBeTruthy();
  expect(
    mutations.filter((value) => value === "POST /api/me/line/pair"),
  ).toHaveLength(1);
  linked = true;
  await act(async () => {
    await refresh();
  });
  expect(
    sessionStorage.getItem("foodwarden_line_pair:/api/me/line"),
  ).toBeNull();
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

test("charts keep sensor histories separate, support scrubbing and show the selected metric", async () => {
  const { Charts } = await import("@/Charts");
  const urls: string[] = [];
  const now = Math.floor(Date.now() / 1000);
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return json({
        samples: [
          {
            node_id: "F0",
            timestamp_s: now - 60,
            temp_celsius: 4,
            voc_index: 100,
            light_ldr: 10,
          },
          {
            node_id: "F0",
            timestamp_s: now - 30,
            temp_celsius: 6,
            voc_index: 120,
            light_ldr: 20,
          },
          {
            node_id: "F1",
            timestamp_s: now,
            temp_celsius: 20,
            voc_index: 250,
            light_ldr: 200,
          },
        ],
      });
    },
    { preconnect: originalFetch.preconnect },
  );
  const { container } = render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
<MemoryRouter>
      <Charts
        fridgeId="kitchen"
        language="en"
        latest={{
          nodeId: "F1",
          timeS: now,
          temperature: 20,
          voc: 250,
          light: 200,
        }}
      />
</MemoryRouter>
    </SWRConfig>,
  );
  const user = userEvent.setup({ document });
  const sensor = await screen.findByRole("combobox", { name: "Sensor" });
  expect(container.querySelector(".reading-selected")?.textContent).toContain(
    "Temperature: 20",
  );
  await user.selectOptions(sensor, "F0");
  expect(container.querySelector(".reading-selected")?.textContent).toContain(
    "Temperature: 6",
  );
  fireEvent.change(screen.getByRole("slider", { name: "Choose a reading" }), {
    target: { value: "0" },
  });
  expect(container.querySelector(".reading-selected")?.textContent).toContain(
    "Temperature: 4",
  );
  await user.selectOptions(screen.getByRole("combobox", { name: "Metric" }), "light");
  expect((screen.getByRole("combobox", { name: "Metric" }) as HTMLSelectElement).value).toBe("light");
  await user.selectOptions(screen.getByRole("combobox", { name: "Time range" }), "7d");
  await waitFor(() =>
    expect(urls.some((url) => url.endsWith("range=7d"))).toBe(true),
  );
});

test("private account preferences save selected values and favorite changes stay scoped", async () => {
  const { MyAccount } = await import("@/MyAccount");
  const { FridgeFavorites } = await import("@/FridgeFavorites");
  const changes: { url: string; method: string; body: unknown }[] = [];
  let preferences = {
    morning_enabled: true,
    morning_time: "07:30",
    inst_obstruct: true,
    inst_warm: true,
    inst_spoil: true,
  };
  let categories: string[] = [];
  let items = [
    {
      item_key: "b".repeat(64),
      name_th: "นม",
      name_en: "Milk",
      category: "Dairy",
      count: 0,
    },
  ];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body: unknown = init?.body
        ? JSON.parse(String(init.body))
        : undefined;
      if (method !== "GET") changes.push({ url, method, body });
      if (method === "PATCH") {
        preferences = {
          ...preferences,
          ...(body as Partial<typeof preferences>),
        };
        return json({ ok: true });
      }
      if (method === "PUT") {
        categories = (body as { categories: string[] }).categories;
        return json({ ok: true });
      }
      if (method === "DELETE") {
        items = [];
        return json({ ok: true });
      }
      if (url.endsWith("/line"))
        return json({
          linked: true,
          ready: true,
          friend_url: null,
          ...preferences,
        });
      return json({ items, categories, category_counts: { Dairy: 0 } });
    },
    { preconnect: originalFetch.preconnect },
  );
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ConfirmationProvider language="en">
        <MyAccount language="en" />
        <FridgeFavorites fridgeId="kitchen" language="en" />
      </ConfirmationProvider>
    </SWRConfig>,
  );
  const user = userEvent.setup({ document });
  const warm = await screen.findByRole("checkbox", {
    name: "The fridge gets too warm",
  });
  await waitFor(() => expect((warm as HTMLInputElement).disabled).toBe(false));
  await user.click(warm);
  fireEvent.change(screen.getByLabelText("Time (Asia/Bangkok)"), {
    target: { value: "08:15" },
  });
  await user.click(screen.getByRole("button", { name: "Save preferences" }));
  await waitFor(() =>
    expect(changes.find((change) => change.method === "PATCH")?.body).toEqual({
      morning_enabled: true,
      morning_time: "08:15",
      inst_obstruct: true,
      inst_warm: false,
      inst_spoil: true,
    }),
  );
  await user.click(await screen.findByText("Favorite food types"));
  await user.click(await screen.findByRole("button", { name: "Dairy (0)" }));
  expect(changes.find((change) => change.method === "PUT")).toEqual({
    url: "/api/fridges/kitchen/favorites/categories",
    method: "PUT",
    body: { categories: ["Dairy"] },
  });
  const remove = screen.getByRole("button", { name: "Remove favorite Milk" });
  await waitFor(() =>
    expect((remove as HTMLButtonElement).disabled).toBe(false),
  );
  await user.click(remove);
  await waitFor(() => expect(screen.queryByText("Milk")).toBeNull());
  expect(changes.find((change) => change.method === "DELETE")?.url).toBe(
    "/api/fridges/kitchen/favorites/" + "b".repeat(64),
  );
});

test("bulk editing patches only supplied fields and preserves failed items for retry", async () => {
  const { within } = await import("@testing-library/react");
  const patches: { url: string; body: unknown }[] = [];
  let reloads = 0;
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "PATCH") {
        patches.push({ url, body: JSON.parse(String(init.body)) });
        return json(
          { ok: !url.endsWith("/apple") },
          url.endsWith("/apple") ? 500 : 200,
        );
      }
      return json({ items: [], categories: [], category_counts: {} });
    },
    { preconnect: originalFetch.preconnect },
  );
  render(
    <MemoryRouter>
      <SWRConfig value={{ provider: () => new Map() }}>
        <ConfirmationProvider language="en">
          <Inventory
            fridgeId="kitchen"
            language="en"
            items={[
              food,
              { ...food, id: "apple", nameEn: "Apple", nameTh: "แอปเปิล" },
            ]}
            onChanged={() => reloads++}
          />
        </ConfirmationProvider>
      </SWRConfig>
    </MemoryRouter>,
  );
  const user = userEvent.setup({ document });
  await user.click(screen.getByRole("button", { name: "Select" }));
  await user.click(
    screen.getByRole("button", { name: "Select all visible food" }),
  );
  await user.click(screen.getByRole("button", { name: "Edit" }));
  const dialog = within(screen.getByRole("dialog"));
  await user.selectOptions(dialog.getByLabelText("Food type"), "Meat");
  await user.click(dialog.getByRole("button", { name: "Save" }));
  await screen.findByText("1 selected");
  expect(reloads).toBe(1);
  expect(patches).toHaveLength(2);
  expect(
    patches.every(
      (patch) => JSON.stringify(patch.body) === '{"category":"Meat"}',
    ),
  ).toBe(true);
  expect(
    (screen.getByRole("checkbox", { name: "Select Apple" }) as HTMLInputElement)
      .checked,
  ).toBe(true);
  expect(
    (screen.getByRole("checkbox", { name: "Select Milk" }) as HTMLInputElement)
      .checked,
  ).toBe(false);
});

test("GatewaySimulator flag toggles panel and posts telemetry, door events, and device status with gateway Bearer token", async () => {
  const user = userEvent.setup({ document });
  const calls: Array<{
    url: string;
    method: string;
    auth: string | null;
    body: unknown;
  }> = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const headers = new Headers(init?.headers);
    const bodyText = typeof init?.body === "string" ? init.body : "";
    calls.push({
      url,
      method: init?.method ?? "GET",
      auth: headers.get("Authorization"),
      body: bodyText ? JSON.parse(bodyText) : null,
    });
    return new Response(JSON.stringify({ ok: true, accepted: 1 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;

  render(
    <GatewaySimulator
      fridgeId="fridge_sim_1"
      gatewayToken="tok_secret_sim"
      language="en"
    />,
  );

  expect(screen.queryByRole("button", { name: "Send Telemetry" })).toBeNull();

  await user.click(
    screen.getByRole("button", { name: "Enable Gateway Simulator" }),
  );
  expect(localStorage.getItem("foodwarden_gateway_sim")).toBe("1");

  await user.click(screen.getByRole("button", { name: "Send Telemetry" }));
  await screen.findByText(/200 POST \/api\/telemetry\?bypass_cooldown=1/);

  await user.click(screen.getByRole("button", { name: "Send Door Event" }));
  await screen.findByText(/200 POST \/api\/door_events\?bypass_cooldown=1/);

  await user.click(screen.getByRole("button", { name: "Send Device Status" }));
  await screen.findByText(/200 POST \/api\/status/);

  expect(calls.length).toBe(3);
  expect(calls[0]).toMatchObject({
    url: "/api/telemetry?bypass_cooldown=1",
    method: "POST",
    auth: "Bearer tok_secret_sim",
  });
  expect(calls[1]).toMatchObject({
    url: "/api/door_events?bypass_cooldown=1",
    method: "POST",
    auth: "Bearer tok_secret_sim",
  });
  expect(calls[2]).toMatchObject({
    url: "/api/status",
    method: "POST",
    auth: "Bearer tok_secret_sim",
  });
});
