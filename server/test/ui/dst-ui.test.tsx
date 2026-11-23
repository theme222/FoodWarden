import { afterEach, expect, test } from "bun:test";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { SWRConfig } from "swr";
import { Charts } from "@/Charts";
import { Devices } from "@/Devices";
import { Inventory } from "@/Inventory";
import { ConfirmationProvider } from "@/components/confirmation";
import type { Food } from "@/model";
import { SeededRng } from "../dst/prng";

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

test("DST UI: seeded inventory interactions recover cleanly from empty filters without crashes", async () => {
  const rng = new SeededRng(2026);
  const items: Food[] = [
    {
      id: "i1",
      nameEn: "Milk",
      nameTh: "นม",
      expiry: "2030-01-01",
      category: "Dairy",
      adviceEn: "",
      adviceTh: "",
      hasPhoto: false,
    },
    {
      id: "i2",
      nameEn: "Spinach",
      nameTh: "ผักโขม",
      expiry: "2020-01-01",
      category: "Produce",
      adviceEn: "",
      adviceTh: "",
      hasPhoto: false,
    },
  ];

  globalThis.fetch = Object.assign(
    async () =>
      json({
        items: [],
        categories: [],
        category_counts: { Dairy: 1, Produce: 1 },
      }),
    { preconnect: originalFetch.preconnect },
  );

  render(
    <MemoryRouter>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <ConfirmationProvider language="en">
          <Inventory
            fridgeId="dst-fridge"
            language="en"
            items={items}
            onChanged={() => {}}
          />
        </ConfirmationProvider>
      </SWRConfig>
    </MemoryRouter>,
  );

  const user = userEvent.setup({ document });
  const searchbox = screen.getByRole("searchbox", { name: "Search food" });
  const terms = ["Milk", "Spinach", "no-such-food", ""];

  for (let step = 0; step < 8; step++) {
    const term = rng.pick(terms);
    fireEvent.change(searchbox, { target: { value: term } });
    if (term === "no-such-food") {
      expect(
        await screen.findByText("No food matches these filters"),
      ).toBeTruthy();
      await user.click(screen.getByRole("button", { name: "Reset filters" }));
      expect(await screen.findByText("Milk")).toBeTruthy();
    }
  }
});

test("DST UI: Charts recovers from fetch error via Retry button and supports metric selection", async () => {
  let shouldFail = true;
  const now = Math.floor(Date.now() / 1000);
  globalThis.fetch = Object.assign(
    async () => {
      if (shouldFail) return json({ error: "DOWN" }, 500);
      return json({
        samples: [
          {
            node_id: "F0",
            timestamp_s: now - 30,
            temp_celsius: 4.5,
            voc_index: 95,
            light_ldr: 15,
          },
        ],
      });
    },
    { preconnect: originalFetch.preconnect },
  );

  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <MemoryRouter>
        <Charts fridgeId="dst-fridge" language="en" latest={null} />
      </MemoryRouter>
    </SWRConfig>,
  );

  const user = userEvent.setup({ document });
  const retry = await screen.findByRole("button", { name: "Retry" });
  shouldFail = false;
  await user.click(retry);

  await waitFor(() =>
    expect(screen.getByRole("checkbox", { name: "Temperature" })).toBeTruthy(),
  );
  const tempCheckbox = () =>
    screen.getByRole("checkbox", { name: "Temperature" }) as HTMLInputElement;
  const lightCheckbox = () =>
    screen.getByRole("checkbox", { name: "Light" }) as HTMLInputElement;

  expect(tempCheckbox().checked).toBe(true);
  expect(tempCheckbox().disabled).toBe(true);
  await user.click(tempCheckbox());
  expect(tempCheckbox().checked).toBe(true);

  await user.click(lightCheckbox());
  expect(lightCheckbox().checked).toBe(true);
  expect(tempCheckbox().disabled).toBe(false);

  await user.click(tempCheckbox());
  expect(tempCheckbox().checked).toBe(false);
  expect(lightCheckbox().checked).toBe(true);
  expect(lightCheckbox().disabled).toBe(true);

  await user.click(lightCheckbox());
  expect(lightCheckbox().checked).toBe(true);
});

test("DST UI: Devices renders schematic, auto-expands degraded node, and offers troubleshooting", () => {
  const now = Math.floor(Date.now() / 1000);
  render(
    <Devices
      heartbeat={{
        gatewaySeenS: now,
        receivedS: now,
        nodes: [
          { id: "C0", reported: true, reportedS: now, lastKnownS: now },
          {
            id: "F0",
            reported: true,
            reportedS: now - 900,
            lastKnownS: now - 900,
          },
          { id: "D0", reported: true, reportedS: now, lastKnownS: now },
        ],
      }}
      doorEvents={[]}
      error={false}
      language="en"
    />,
  );

  expect(screen.getByRole("alert").textContent).toContain(
    "1 device(s) need attention",
  );
  expect(screen.getByText(/Fridge sensor F0 sleeps/)).toBeTruthy();
});
