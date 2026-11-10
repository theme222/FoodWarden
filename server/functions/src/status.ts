import type { Firestore } from "firebase-admin/firestore";
import { findGatewayFridge } from "./gateway";

// Mirrors the heartbeat proposed in PR #5. Limits bound the stored report.
const MAX_NODES = 200;
const MAX_CLOCK_SKEW_S = 300;

export interface NodeStatus {
  node_id: string;
  last_seen_s: number | null;
}

interface StatusReport {
  nodes: NodeStatus[];
  gatewaySeenS: number;
}

interface StoredNode extends NodeStatus {
  last_known_seen_s: number | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseStatus(body: unknown, nowS: number): StatusReport | null {
  if (!isRecord(body) || !Array.isArray(body.nodes) || body.nodes.length > MAX_NODES) return null;
  const nodes = new Map<string, NodeStatus>();
  for (const node of body.nodes as unknown[]) {
    if (!isRecord(node)) return null;
    const { node_id, last_seen_s } = node;
    if (
      typeof node_id !== "string" || !node_id.trim() || node_id !== node_id.trim() ||
      node_id.length > 128 || nodes.has(node_id) ||
      (last_seen_s !== null && (typeof last_seen_s !== "number" ||
        !Number.isSafeInteger(last_seen_s) || last_seen_s < 0 ||
        last_seen_s > nowS + MAX_CLOCK_SKEW_S))
    ) return null;
    nodes.set(node_id, { node_id, last_seen_s });
  }

  const gatewaySeenS = nodes.get("C0")?.last_seen_s;
  if (gatewaySeenS == null) return null;
  return { nodes: [...nodes.values()], gatewaySeenS };
}

function readLastKnown(value: unknown): Map<string, number> {
  const seen = new Map<string, number>();
  if (!Array.isArray(value)) return seen;
  for (const node of value as unknown[]) {
    if (isRecord(node) && typeof node.node_id === "string" &&
        typeof node.last_known_seen_s === "number") {
      seen.set(node.node_id, node.last_known_seen_s);
    }
  }
  return seen;
}

export async function ingestStatus(
  firestore: Firestore,
  tokenHash: string,
  report: StatusReport,
  receivedS: number,
): Promise<number | null> {
  return firestore.runTransaction(async (transaction) => {
    const fridgeRef = await findGatewayFridge(firestore, transaction, tokenHash);
    if (!fridgeRef) return null;

    const statusRef = fridgeRef.collection("system_status").doc("latest");
    const [fridge, status] = await transaction.getAll(fridgeRef, statusRef);
    if (!fridge?.exists) return null;
    const previousGatewaySeen: unknown = status?.get("gateway_seen_s");
    if (typeof previousGatewaySeen === "number" && previousGatewaySeen >= report.gatewaySeenS) {
      return 0;
    }

    const previous = readLastKnown(status?.get("nodes"));
    const nodes: StoredNode[] = report.nodes.map((node) => {
      const lastKnown = previous.get(node.node_id);
      return {
        ...node,
        last_known_seen_s: node.last_seen_s === null
          ? lastKnown ?? null
          : Math.max(node.last_seen_s, lastKnown ?? node.last_seen_s),
      };
    });
    transaction.set(statusRef, {
      gateway_seen_s: report.gatewaySeenS,
      received_s: receivedS,
      nodes,
    });
    return nodes.length;
  });
}
