import { afterEach, test, expect } from "bun:test";
import {
  cleanup,
  render,
  renderHook,
  screen,
  waitFor,
  act,
} from "@testing-library/react";
import { useFridges, useFridgeRoom } from "@/data";
import { SessionCache } from "@/components/session-cache";
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
