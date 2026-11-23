import { useEffect, useEffectEvent, useState, useCallback } from "react";
import useSWR, { useSWRConfig } from "swr";
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
import type { DoorEvent, Food, Heartbeat, Sample } from "./model";
import { getJson, swrOptions, isAccessError } from "./lib/api";

export function useFridges(userId: string) {
  const state = useSWR(
    userId ? "/api/fridges" : null,
    (url) => getJson(url, readFridgeList),
    swrOptions,
  );
  return {
    data: state.data ?? null,
    error: Boolean(state.error),
    reload: () => {
      void state.mutate().catch(() => {});
    },
  };
}
export type SocketConnectionState =
  "connecting" | "live" | "reconnecting" | "closed";
export interface FridgeRoomState {
  inventory: Food[] | null;
  history: Sample[] | null;
  latest: Sample | null;
  heartbeat: Heartbeat | null | undefined;
  doorEvents: DoorEvent[] | null;
  error: boolean;
  connectionState: SocketConnectionState;
  reloadInventory: () => void;
  reloadAll: () => void;
}

export function useFridgeRoom(
  fridgeId: string,
  initialLatest: Sample | null,
  onAccessLost?: (reason: "revoked" | "deleted") => void,
): FridgeRoomState {
  const base = `/api/fridges/${encodeURIComponent(fridgeId)}`;
  const { mutate: mutateCache } = useSWRConfig();
  const inventory = useSWR(
    `${base}/inventory`,
    (url) => getJson(url, readInventoryList),
    swrOptions,
  );
  const history = useSWR(
    `${base}/telemetry?range=1h`,
    (url) => getJson(url, readBucket),
    swrOptions,
  );
  const status = useSWR(
    `${base}/status`,
    (url) => getJson(url, readStatusResponse),
    swrOptions,
  );
  const doors = useSWR(
    `${base}/door_events?limit=25`,
    (url) => getJson(url, readDoorEventList),
    swrOptions,
  );
  const [connectionState, setConnectionState] =
    useState<SocketConnectionState>("connecting");

  const { mutate: mutateInventory } = inventory;
  const { mutate: mutateHistory } = history;
  const { mutate: mutateStatus } = status;
  const { mutate: mutateDoors } = doors;

  const reloadAll = useCallback(() => {
    void Promise.allSettled([
      mutateInventory(),
      mutateHistory(),
      mutateStatus(),
      mutateDoors(),
    ]);
  }, [mutateInventory, mutateHistory, mutateStatus, mutateDoors]);

  const notifyAccessLost = useEffectEvent((reason: "revoked" | "deleted") =>
    onAccessLost?.(reason),
  );
  const revalidate = useEffectEvent(() => reloadAll());

  const applyEvent = useEffectEvent(
    (event: ReturnType<typeof parseFridgeRoomEvent>) => {
      if (!event) return;
      switch (event.type) {
        case "line_settings_changed":
          void mutateCache(`${base}/line`);
          void mutateCache(`${base}/settings`);
          break;
        case "telemetry":
          // Revalidate while the first snapshot is loading so a streamed sample cannot discard history.
          if (history.data === undefined) {
            void mutateHistory().catch(() => {});
            break;
          }
          void mutateHistory(
            (previous) =>
              mergeTelemetrySamples(
                previous ?? [],
                event.samples,
                Math.floor(Date.now() / 1000),
              ),
            { revalidate: false },
          );
          break;
        case "status":
          void mutateStatus(
            (previous) =>
              previous && previous.gatewaySeenS >= event.status.gatewaySeenS
                ? previous
                : event.status,
            { revalidate: false },
          );
          break;
        case "door_events":
          if (doors.data === undefined) {
            void mutateDoors().catch(() => {});
            break;
          }
          void mutateDoors(
            (previous) => mergeDoorEvents(previous ?? [], event.events),
            { revalidate: false },
          );
          break;
        case "inventory_changed":
          void mutateCache(`${base}/favorites`);
          void mutateInventory().catch(() => {});
          break;
        case "member_revoked":
          setConnectionState("closed");
          notifyAccessLost("revoked");
          break;
        case "fridge_deleted":
          setConnectionState("closed");
          notifyAccessLost("deleted");
          break;
      }
    },
  );
  const terminalError = [
    inventory.error,
    history.error,
    status.error,
    doors.error,
  ].find(isAccessError);
  useEffect(() => {
    if (terminalError)
      notifyAccessLost(terminalError.status === 404 ? "deleted" : "revoked");
  }, [terminalError]);

  useEffect(() => {
    let disposed = false;
    let revoked = false;
    let socket: WebSocket | null = null;
    let pingTimer: number | undefined;
    let reconnectTimer: number | undefined;
    let attempt = 0;
    function connect(reconnect: boolean) {
      if (disposed || revoked) return;
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(
        `${protocol}//${window.location.host}${base}/ws`,
      );
      socket = ws;
      ws.addEventListener("open", () => {
        if (disposed || revoked) {
          ws.close(1000, "Disposed");
          return;
        }
        attempt = 0;
        setConnectionState("live");
        if (reconnect) revalidate();
        pingTimer = window.setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send("ping");
        }, 25000);
      });
      ws.addEventListener("message", (event) => {
        if (
          disposed ||
          revoked ||
          typeof event.data !== "string" ||
          event.data === "pong"
        )
          return;
        const parsed = parseFridgeRoomEvent(event.data);
        if (
          parsed?.type === "member_revoked" ||
          parsed?.type === "fridge_deleted"
        )
          revoked = true;
        applyEvent(parsed);
      });
      ws.addEventListener("close", (event) => {
        window.clearInterval(pingTimer);
        if (disposed || revoked) return;
        if (event.code === 4003 || event.code === 4004) {
          revoked = true;
          setConnectionState("closed");
          notifyAccessLost(event.code === 4003 ? "revoked" : "deleted");
          return;
        }
        setConnectionState("reconnecting");
        reconnectTimer = window.setTimeout(
          () => connect(true),
          Math.min(15000, 1000 * 2 ** attempt++),
        );
      });
    }
    connect(false);
    return () => {
      disposed = true;
      window.clearInterval(pingTimer);
      window.clearTimeout(reconnectTimer);
      socket?.close(1000, "Cleanup");
    };
  }, [base]);

  const reloadInventory = useCallback(() => {
    void mutateInventory().catch(() => {});
    void mutateCache(`${base}/favorites`).catch(() => {});
  }, [mutateInventory, mutateCache, base]);

  const latest = (history.data ?? []).reduce<Sample | null>(
    (best, sample) => (!best || sample.timeS > best.timeS ? sample : best),
    initialLatest,
  );
  return {
    inventory: terminalError ? null : (inventory.data ?? null),
    history: terminalError ? null : (history.data ?? null),
    latest: terminalError ? null : latest,
    heartbeat: terminalError ? null : status.data,
    doorEvents: terminalError ? null : (doors.data ?? null),
    error: Boolean(
      inventory.error || history.error || status.error || doors.error,
    ),
    connectionState,
    reloadInventory,
    reloadAll,
  };
}
export function useNow() {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const timer = window.setInterval(
      () => setNow(Math.floor(Date.now() / 1000)),
      15000,
    );
    return () => window.clearInterval(timer);
  }, []);
  return now;
}
