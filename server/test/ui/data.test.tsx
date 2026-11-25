import { afterEach, test, expect, spyOn } from "bun:test";
import {
  cleanup,
  render,
  renderHook,
  screen,
  waitFor,
  act,
  fireEvent,
  within,
} from "@testing-library/react";
import { useFridges, useFridgeRoom } from "@/data";
import { SessionCache } from "@/components/session-cache";
import { signInDestination } from "@/auth";
import { FridgePage } from "@/pages/FridgeWorkspace";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { ApiRequestError, isAccessError, swrOptions } from "@/lib/api";
const originalFetch = globalThis.fetch;
const originalSocket = globalThis.WebSocket;
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  globalThis.WebSocket = originalSocket;
});
const wrapper = ({ children }: { children: ReactNode }) => (
  <SessionCache>{children}</SessionCache>
);

test("LINE links preserve the internal destination after sign-in", () => {
  expect(
    signInDestination({
      pathname: "/fridges/demo_fridge/monitoring/history",
      search: "?kind=door&date=2026-11-25",
      hash: "#event",
    }),
  ).toBe(
    "/fridges/demo_fridge/monitoring/history?kind=door&date=2026-11-25#event",
  );
  expect(
    signInDestination({ pathname: "//other.example", search: "", hash: "" }),
  ).toBe("/fridges");
  expect(
    signInDestination({ pathname: "/api/overview", search: "", hash: "" }),
  ).toBe("/fridges");
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fridge(name: string) {
  return {
    fridges: [
      {
        id: name.toLowerCase(),
        name,
        role: "owner",
        last_seen_s: 0,
        last_telemetry: null,
      },
    ],
  };
}

test("private SWR caches reset across account switches and logout/remount", async () => {
  const next = deferred<Response>();
  let account = "A";
  let calls = 0;
  globalThis.fetch = Object.assign(
    async () => {
      calls++;
      return account === "A" ? json(fridge("Alice")) : next.promise;
    },
    { preconnect: originalFetch.preconnect },
  );
  function Probe({ user }: { user: string }) {
    const state = useFridges(user);
    return <output>{state.data?.[0]?.name ?? "Loading"}</output>;
  }
  const view = render(
    <SessionCache key="A">
      <Probe user="A" />
    </SessionCache>,
  );
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toBe("Alice"),
  );
  account = "B";
  view.rerender(
    <SessionCache key="B">
      <Probe user="B" />
    </SessionCache>,
  );
  expect(screen.getByRole("status").textContent).toBe("Loading");
  await act(async () => {
    next.resolve(json(fridge("Bob")));
  });
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toBe("Bob"),
  );
  view.unmount();
  account = "A";
  render(
    <SessionCache key="A">
      <Probe user="A" />
    </SessionCache>,
  );
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toBe("Alice"),
  );
  expect(calls).toBe(3);
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

test("the four-item fridge navigation groups charts and history while keeping old filter links", async () => {
  globalThis.WebSocket = Socket as unknown as typeof WebSocket;
  globalThis.fetch = Object.assign(
    async () =>
      json({ items: [], samples: [], status: null, events: [], rows: [] }),
    { preconnect: originalFetch.preconnect },
  );
  function CurrentPage() {
    const { pathname, search, hash } = useLocation();
    return <output aria-label="Current URL">{pathname + search + hash}</output>;
  }
  const fridge = {
    id: "test-fridge",
    name: "Test fridge",
    role: "owner",
    lastSeenS: 0,
    latest: null,
  } as const;
  render(
    <SessionCache>
      <MemoryRouter
        initialEntries={["/fridges/test-fridge/history?kind=door#log"]}
      >
        <CurrentPage />
        <Routes>
          <Route
            path="/fridges/:fridgeId/*"
            element={
              <FridgePage
                fridges={[fridge]}
                language="en"
                onFridgesChanged={() => {}}
              />
            }
          />
        </Routes>
      </MemoryRouter>
    </SessionCache>,
  );
  await screen.findByRole("heading", { name: "Activity history" });
  expect(screen.getByLabelText("Current URL").textContent).toBe(
    "/fridges/test-fridge/monitoring/history?kind=door#log",
  );
  expect(
    screen.getByRole<HTMLSelectElement>("combobox", { name: "Type" }).value,
  ).toBe("door");
  for (const nav of screen.getAllByRole("navigation", {
    name: "Test fridge",
  })) {
    const links = [...nav.querySelectorAll("a")];
    expect(links).toHaveLength(4);
    expect(nav.querySelector('[aria-current="page"]')?.textContent).toBe(
      "Monitor",
    );
  }
  expect(
    screen.getByRole("link", { name: "History" }).getAttribute("aria-current"),
  ).toBe("page");
  await import("@/Charts");
  fireEvent.click(screen.getByRole("link", { name: "Charts" }));
  await screen.findByRole(
    "heading",
    { name: "Sensor charts" },
    { timeout: 2500 },
  );
  expect(
    screen.getByRole("link", { name: "Charts" }).getAttribute("aria-current"),
  ).toBe("page");

  const bottomNav = screen
    .getAllByRole("navigation", { name: "Test fridge" })
    .find((nav) => nav.classList.contains("bnav"))!;
  const monitor = within(bottomNav).getByRole("link", { name: "Monitor" });
  const devices = within(bottomNav).getByRole("link", { name: "Devices" });
  const hitTest = spyOn(document, "elementFromPoint").mockReturnValue(devices);
  const capture = spyOn(bottomNav, "setPointerCapture").mockImplementation(
    () => {},
  );
  try {
    const start = {
      pointerId: 1,
      isPrimary: true,
      pointerType: "touch",
      clientX: 30,
      clientY: 140,
    };
    const destination = { ...start, clientX: 190 };
    fireEvent.pointerDown(monitor, start);
    fireEvent.pointerMove(bottomNav, destination);
    expect(devices.hasAttribute("data-preview")).toBe(true);
    expect(monitor.getAttribute("aria-current")).toBe("page");
    fireEvent.pointerCancel(bottomNav, destination);
    expect(devices.hasAttribute("data-preview")).toBe(false);
    expect(monitor.getAttribute("aria-current")).toBe("page");

    fireEvent.pointerDown(monitor, start);
    fireEvent.pointerMove(bottomNav, destination);
    fireEvent.pointerUp(bottomNav, destination);
    await waitFor(() =>
      expect(devices.getAttribute("aria-current")).toBe("page"),
    );
    expect(devices.hasAttribute("data-preview")).toBe(false);
  } finally {
    capture.mockRestore();
    hitTest.mockRestore();
  }
});

test("WebSocket updates SWR telemetry, refreshes inventory and stops after revocation", async () => {
  Socket.sockets = [];
  globalThis.WebSocket = Socket as unknown as typeof WebSocket;
  let inventoryRequests = 0;
  globalThis.fetch = Object.assign(
    async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      if (url.endsWith("/inventory")) {
        inventoryRequests++;
        return json({ items: [] });
      }
      if (url.includes("/telemetry")) return json({ samples: [] });
      if (url.endsWith("/status")) return json({ status: null });
      return json({ events: [] });
    },
    { preconnect: originalFetch.preconnect },
  );
  let lost = "";
  const view = renderHook(
    () =>
      useFridgeRoom("test-fridge", null, (reason) => {
        lost = reason;
      }),
    { wrapper },
  );
  await waitFor(() => expect(view.result.current.history).toEqual([]));
  const socket = Socket.sockets[0]!;
  act(() => socket.open());
  expect(view.result.current.connectionState).toBe("live");
  const now = Math.floor(Date.now() / 1000);
  act(() =>
    socket.message({
      type: "telemetry",
      samples: [
        {
          node_id: "F0",
          timestamp_s: now,
          temp_celsius: 3,
          voc_index: 90,
          light_ldr: 0,
        },
      ],
      last_seen_s: now,
    }),
  );
  await waitFor(() => expect(view.result.current.latest?.temperature).toBe(3));
  act(() =>
    socket.message({
      type: "inventory_changed",
      itemId: "item-test",
      action: "created",
    }),
  );
  await waitFor(() => expect(inventoryRequests).toBe(2));
  act(() => socket.close(4003));
  expect(lost).toBe("revoked");
  expect(view.result.current.connectionState).toBe("closed");
  view.unmount();
  expect(socket.readyState).toBe(Socket.CLOSED);
});

test("authorization failures are terminal rather than automatic retry candidates", () => {
  for (const code of [401, 403, 404]) {
    const error = new ApiRequestError(code);
    expect(isAccessError(error)).toBe(true);
    const retry = swrOptions.shouldRetryOnError;
    expect(typeof retry === "function" ? retry(error) : retry).toBe(false);
  }
  expect(isAccessError(new ApiRequestError(503))).toBe(false);
});
