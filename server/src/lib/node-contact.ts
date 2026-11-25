export type ContactState =
  | "recent"
  | "stale"
  | "unreported"
  | "notIncluded"
  | "waiting"
  | "gatewayMissing";

export const GATEWAY_STALE_S = 180;
export const FRIDGE_SENSOR_STALE_S = 600;

export function nodeFreshnessSeconds(nodeId: string): number {
  return nodeId.startsWith("F") ? FRIDGE_SENSOR_STALE_S : GATEWAY_STALE_S;
}

export function contactState(
  node: { id: string; reported: boolean; reportedS: number | null },
  heartbeat: { receivedS: number; gatewaySeenS: number } | null,
  nowS: number,
): ContactState {
  if (!heartbeat) return "waiting";
  const gatewayStale =
    nowS - Math.min(heartbeat.receivedS, heartbeat.gatewaySeenS) >
    GATEWAY_STALE_S;
  if (node.id !== "C0" && gatewayStale) return "gatewayMissing";
  if (!node.reported) return "notIncluded";
  if (node.reportedS === null) return "unreported";
  return nowS - node.reportedS <= nodeFreshnessSeconds(node.id) &&
    (node.id !== "C0" || !gatewayStale)
    ? "recent"
    : "stale";
}
