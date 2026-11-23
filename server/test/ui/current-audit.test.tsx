import { test, expect, afterEach } from "bun:test";
import { renderHook, waitFor, act, cleanup } from "@testing-library/react";
import { SWRConfig } from "swr";
import type { ReactNode } from "react";
import { useFridgeRoom } from "../../src/data";
const originalFetch = globalThis.fetch;
const originalWebSocket = globalThis.WebSocket;
const originalFormData = globalThis.FormData;
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  globalThis.WebSocket = originalWebSocket;
  globalThis.FormData = originalFormData;
});
class Socket extends EventTarget {
  static OPEN = 1;
  static CLOSED = 3;
  static sockets: Socket[] = [];
  readyState = 0;
  constructor(public url: string | URL) {
    super();
    Socket.sockets.push(this);
  }
  send() {}
  open() {
    this.readyState = 1;
    this.dispatchEvent(new Event("open"));
  }
  message(data: unknown) {
    const event = new Event("message");
    Object.defineProperty(event, "data", { value: JSON.stringify(data) });
    this.dispatchEvent(event);
  }
  close(code = 1000) {
    this.readyState = 3;
    const event = new Event("close");
    Object.defineProperty(event, "code", { value: code });
    this.dispatchEvent(event);
  }
}
function wrapper({ children }: { children: ReactNode }) {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      {children}
    </SWRConfig>
  );
}
test("regression: delayed older WebSocket status cannot replace newer displayed heartbeat", async () => {
  globalThis.WebSocket = Socket as unknown as typeof WebSocket;
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const url = String(input);
      let value: unknown = { events: [] };
      if (url.endsWith("/inventory")) value = { items: [] };
      if (url.includes("/telemetry")) value = { samples: [] };
      if (url.endsWith("/status")) value = { status: null };
      return new Response(JSON.stringify(value), {
        headers: { "Content-Type": "application/json" },
      });
    },
    { preconnect: originalFetch.preconnect },
  );
  const view = renderHook(() => useFridgeRoom("audit-fridge", null), {
    wrapper,
  });
  await waitFor(() => expect(view.result.current.history).toEqual([]));
  const socket = Socket.sockets.at(-1)!;
  act(() => socket.open());
  const status = (n: number) => ({
    type: "status",
    status: {
      gateway_seen_s: n,
      received_s: n,
      nodes: [{ node_id: "F0", last_seen_s: n }],
    },
  });
  act(() => socket.message(status(2000)));
  await waitFor(() =>
    expect(view.result.current.heartbeat?.gatewaySeenS).toBe(2000),
  );
  act(() => socket.message(status(1000)));
  await waitFor(() =>
    expect(view.result.current.heartbeat?.gatewaySeenS).toBe(2000),
  );
});
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route, useParams } from "react-router-dom";
import { FoodDetail } from "../../src/Food";
import type { Food } from "../../src/model";
import { ConfirmationProvider } from "../../src/components/confirmation";
test("regression: switching matching items while editing clears the previous draft", async () => {
  globalThis.FormData = window.FormData;
  const patches: { url: string; body: Record<string, unknown> }[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      patches.push({
        url: String(input),
        body: JSON.parse(String(init?.body)),
      });
      return new Response("{}", { status: 200 });
    },
    { preconnect: originalFetch.preconnect },
  );
  const sample: Food = {
    id: "a",
    nameEn: "Milk",
    nameTh: "นม",
    expiry: "2030-01-01",
    category: "Dairy",
    adviceEn: "",
    adviceTh: "",
    hasPhoto: false,
  };
  function ItemRoute() {
    const { itemId = "a" } = useParams();
    return (
      <>
        <output data-testid="selected-id">{itemId}</output>
        <FoodDetail
          itemId={itemId}
          items={[sample, { ...sample, id: "b" }]}
          fridgeId="audit-fridge"
          language="en"
          onChanged={() => {}}
        />
      </>
    );
  }
  render(
    <MemoryRouter initialEntries={["/fridges/audit-fridge/food/a"]}>
      <ConfirmationProvider language="en">
        <Routes>
          <Route
            path="/fridges/:fridgeId/food/:itemId"
            element={<ItemRoute />}
          />
        </Routes>
      </ConfirmationProvider>
    </MemoryRouter>,
  );
  const user = userEvent.setup({ document });
  await user.click(screen.getByRole("button", { name: "Edit item" }));
  fireEvent.change(screen.getByLabelText("English name"), {
    target: { value: "Pending change for A" },
  });
  await user.click(screen.getByRole("link", { name: "Item 2" }));
  expect(screen.getByTestId("selected-id").textContent).toBe("b");
  expect(screen.queryByLabelText("English name")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Edit item" }));
  expect(
    (screen.getByLabelText("English name") as HTMLInputElement).value,
  ).toBe("Milk");
  fireEvent.change(screen.getByLabelText("English name"), {
    target: { value: "New change for B" },
  });
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(patches).toHaveLength(1));
  expect(patches[0]!.url).toBe("/api/fridges/audit-fridge/inventory/b");
  expect(patches[0]!.body.name_en).toBe("New change for B");
});
