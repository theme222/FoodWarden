import { useCallback, useEffect, useRef, useState } from "react";
import {
  mergeDoorEvents,
  mergeTelemetrySamples,
  parseFridgeRoomEvent,
  readBucket,
  readDoorEventList,
  readFridgeList,
  readInventoryList,
  readStatusResponse,
} from "./model";
import type { DoorEvent, Food, Fridge, Heartbeat, Sample } from "./model";

export type SocketConnectionState =
  "connecting" | "live" | "reconnecting" | "closed";

interface Live<T> {
  key: string;
  data: T | null;
  error: boolean;
}

export function useFridges(userId: string) {
  const [live, setLive] = useState<Live<Fridge[]>>({
    key: userId,
    data: null,
    error: false,
  });
  const [version, setVersion] = useState(0);

  const reload = useCallback(() => {
    setVersion((prev) => prev + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/fridges", {
          signal: controller.signal,
          credentials: "same-origin",
        });
        if (!response.ok) throw new Error("Fridges unavailable");
        const data = readFridgeList(await response.json());
        if (!controller.signal.aborted) {
          setLive({ key: userId, data, error: false });
        }
      } catch {
        if (!controller.signal.aborted) {
          setLive({ key: userId, data: null, error: true });
        }
      }
    })();
    return () => controller.abort();
  }, [userId, version]);

  return {
    ...(live.key === userId ? live : { data: null, error: false }),
    reload,
  };
}

export interface FridgeRoomState {
  inventory: Food[] | null;
  history: Sample[] | null;
  latest: Sample | null;
  heartbeat: Heartbeat | null | undefined;
  doorEvents: DoorEvent[] | null;
  error: boolean;
  connectionState: SocketConnectionState;
  reloadInventory: () => void;
}

export function useFridgeRoom(
  fridgeId: string,
  initialLatest: Sample | null,
  onAccessLost?: (reason: "revoked" | "deleted") => void,
): FridgeRoomState {
  const [inventory, setInventory] = useState<Food[] | null>(null);
  const [history, setHistory] = useState<Sample[] | null>(null);
  const [latest, setLatest] = useState<Sample | null>(initialLatest);
  const [heartbeat, setHeartbeat] = useState<Heartbeat | null | undefined>(
    undefined,
  );
  const [doorEvents, setDoorEvents] = useState<DoorEvent[] | null>(null);
  const [error, setError] = useState(false);
  const [connectionState, setConnectionState] =
    useState<SocketConnectionState>("connecting");
  const [activeKey, setActiveKey] = useState(fridgeId);
  const [invVersion, setInvVersion] = useState(0);

  const accessLostRef = useRef(onAccessLost);
  accessLostRef.current = onAccessLost;

  useEffect(() => {
    setActiveKey(fridgeId);
    setInventory(null);
    setHistory(null);
    setLatest(initialLatest);
    setHeartbeat(undefined);
    setDoorEvents(null);
    setError(false);
    setConnectionState("connecting");
  }, [fridgeId, initialLatest]);

  const fetchInventory = useCallback(
    async (signal?: AbortSignal) => {
      const res = await fetch(
        `/api/fridges/${encodeURIComponent(fridgeId)}/inventory`,
        { signal, credentials: "same-origin" },
      );
      if (!res.ok) throw new Error("Inventory unavailable");
      return readInventoryList(await res.json());
    },
    [fridgeId],
  );

  const reloadInventory = useCallback(() => {
    setInvVersion((v) => v + 1);
  }, []);

  // Re-fetch inventory when locally mutated or signaled.
  useEffect(() => {
    if (invVersion === 0) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const items = await fetchInventory(controller.signal);
        if (!controller.signal.aborted) {
          setInventory(items);
        }
      } catch {
        // Keep current list on transient refresh failure.
      }
    })();
    return () => controller.abort();
  }, [fetchInventory, invVersion]);

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    let socket: WebSocket | null = null;
    let pingTimer: number | null = null;
    let reconnectTimer: number | null = null;
    let reconnectAttempt = 0;

    async function loadSnapshot(): Promise<void> {
      const encodedId = encodeURIComponent(fridgeId);
      try {
        const [invRes, telRes, statusRes, doorRes] = await Promise.all([
          fetch(`/api/fridges/${encodedId}/inventory`, {
            signal: controller.signal,
            credentials: "same-origin",
          }),
          fetch(`/api/fridges/${encodedId}/telemetry?range=1h`, {
            signal: controller.signal,
            credentials: "same-origin",
          }),
          fetch(`/api/fridges/${encodedId}/status`, {
            signal: controller.signal,
            credentials: "same-origin",
          }),
          fetch(`/api/fridges/${encodedId}/door_events?limit=25`, {
            signal: controller.signal,
            credentials: "same-origin",
          }),
        ]);

        if (
          invRes.status === 403 ||
          invRes.status === 404 ||
          telRes.status === 403 ||
          telRes.status === 404
        ) {
          if (!disposed) accessLostRef.current?.("deleted");
          return;
        }

        if (!invRes.ok || !telRes.ok || !statusRes.ok || !doorRes.ok) {
          throw new Error("Dashboard snapshot unavailable");
        }

        const [invJson, telJson, statusJson, doorJson] = await Promise.all([
          invRes.json(),
          telRes.json(),
          statusRes.json(),
          doorRes.json(),
        ]);

        if (disposed || controller.signal.aborted) return;
        const parsedInventory = readInventoryList(invJson);
        const parsedHistory = readBucket(telJson);
        const parsedStatus = readStatusResponse(statusJson);
        const parsedDoors = readDoorEventList(doorJson);

        setInventory(parsedInventory);
        setHistory(parsedHistory);
        const newestSample = parsedHistory.reduce<Sample | null>(
          (best, s) => (!best || s.timeS > best.timeS ? s : best),
          null,
        );
        if (newestSample) {
          setLatest((prev) =>
            !prev || newestSample.timeS >= prev.timeS ? newestSample : prev,
          );
        }
        setHeartbeat(parsedStatus);
        setDoorEvents(parsedDoors);
        setError(false);
      } catch {
        if (!disposed && !controller.signal.aborted) {
          setError(true);
        }
      }
    }

    function clearTimers() {
      if (pingTimer !== null) {
        window.clearInterval(pingTimer);
        pingTimer = null;
      }
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    }

    function connectWebSocket(isReconnect: boolean) {
      if (disposed) return;
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}/api/fridges/${encodeURIComponent(fridgeId)}/ws`;
      const ws = new WebSocket(wsUrl);
      socket = ws;

      ws.addEventListener("open", () => {
        if (disposed) {
          ws.close(1000, "Disposed");
          return;
        }
        reconnectAttempt = 0;
        setConnectionState("live");
        if (isReconnect) {
          void loadSnapshot();
        }
        pingTimer = window.setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send("ping");
          }
        }, 25_000);
      });

      ws.addEventListener("message", (event) => {
        if (disposed || typeof event.data !== "string") return;
        if (event.data === "pong") return;
        const parsed = parseFridgeRoomEvent(event.data);
        if (!parsed) return;

        switch (parsed.type) {
          case "telemetry": {
            const nowS = Math.floor(Date.now() / 1000);
            setHistory((prev) =>
              mergeTelemetrySamples(prev ?? [], parsed.samples, nowS),
            );
            const newest = parsed.samples.reduce<Sample | null>(
              (best, s) => (!best || s.timeS > best.timeS ? s : best),
              null,
            );
            if (newest) {
              setLatest((prev) =>
                !prev || newest.timeS >= prev.timeS ? newest : prev,
              );
            }
            break;
          }
          case "status":
            setHeartbeat(parsed.status);
            break;
          case "door_events":
            setDoorEvents((prev) => mergeDoorEvents(prev ?? [], parsed.events));
            break;
          case "inventory_changed":
            void fetchInventory(controller.signal)
              .then((items) => {
                if (!disposed && !controller.signal.aborted) {
                  setInventory(items);
                }
              })
              .catch(() => {});
            break;
          case "member_revoked":
            setConnectionState("closed");
            accessLostRef.current?.("revoked");
            break;
          case "fridge_deleted":
            setConnectionState("closed");
            accessLostRef.current?.("deleted");
            break;
        }
      });

      ws.addEventListener("close", (event) => {
        if (pingTimer !== null) {
          window.clearInterval(pingTimer);
          pingTimer = null;
        }
        if (disposed) return;
        if (event.code === 4003) {
          setConnectionState("closed");
          accessLostRef.current?.("revoked");
          return;
        }
        if (event.code === 4004) {
          setConnectionState("closed");
          accessLostRef.current?.("deleted");
          return;
        }
        setConnectionState("reconnecting");
        const delayMs = Math.min(15_000, 1000 * 2 ** reconnectAttempt);
        reconnectAttempt += 1;
        reconnectTimer = window.setTimeout(() => {
          connectWebSocket(true);
        }, delayMs);
      });
    }

    void loadSnapshot();
    connectWebSocket(false);

    return () => {
      disposed = true;
      controller.abort();
      clearTimers();
      if (socket && socket.readyState !== WebSocket.CLOSED) {
        socket.close(1000, "Cleanup");
      }
    };
  }, [fridgeId, fetchInventory]);

  if (activeKey !== fridgeId) {
    return {
      inventory: null,
      history: null,
      latest: initialLatest,
      heartbeat: undefined,
      doorEvents: null,
      error: false,
      connectionState: "connecting",
      reloadInventory,
    };
  }

  return {
    inventory,
    history,
    latest,
    heartbeat,
    doorEvents,
    error,
    connectionState,
    reloadInventory,
  };
}

export function useNow() {
  const [nowS, setNowS] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const timer = window.setInterval(
      () => setNowS(Math.floor(Date.now() / 1000)),
      15_000,
    );
    return () => window.clearInterval(timer);
  }, []);
  return nowS;
}
