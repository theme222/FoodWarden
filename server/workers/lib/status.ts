const MAX_NODES = 200;
const MAX_CLOCK_SKEW_S = 300;

interface NodeStatus {
  node_id: string;
  last_seen_s: number | null;
}

export interface StatusReport {
  nodes: NodeStatus[];
  gatewaySeenS: number;
}

interface StoredNodeStatus extends NodeStatus {
  last_known_seen_s: number | null;
}

export interface FridgeStatusSnapshot {
  gateway_seen_s: number;
  received_s: number;
  nodes: StoredNodeStatus[];
}

export interface IngestStatusResult {
  updatedCount: number;
  status: FridgeStatusSnapshot | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseStatus(body: unknown, nowS: number): StatusReport | null {
  if (
    !isRecord(body) ||
    !Array.isArray(body.nodes) ||
    body.nodes.length > MAX_NODES
  ) {
    return null;
  }

  const nodes = new Map<string, NodeStatus>();
  for (const rawNode of body.nodes as unknown[]) {
    if (!isRecord(rawNode)) return null;
    const { node_id, last_seen_s } = rawNode;
    if (
      typeof node_id !== "string" ||
      !node_id.trim() ||
      node_id !== node_id.trim() ||
      node_id.length > 128 ||
      nodes.has(node_id) ||
      (last_seen_s !== null &&
        (typeof last_seen_s !== "number" ||
          !Number.isSafeInteger(last_seen_s) ||
          last_seen_s < 0 ||
          last_seen_s > nowS + MAX_CLOCK_SKEW_S))
    ) {
      return null;
    }
    nodes.set(node_id, { node_id, last_seen_s });
  }

  const gatewaySeenS = nodes.get("C0")?.last_seen_s;
  if (gatewaySeenS == null) return null;
  return { nodes: [...nodes.values()], gatewaySeenS };
}

function readLastKnown(
  nodesJson: string | null | undefined,
): Map<string, number> {
  const seen = new Map<string, number>();
  if (!nodesJson) return seen;
  try {
    const parsed: unknown = JSON.parse(nodesJson);
    if (!Array.isArray(parsed)) return seen;
    for (const node of parsed as unknown[]) {
      if (
        isRecord(node) &&
        typeof node.node_id === "string" &&
        typeof node.last_known_seen_s === "number" &&
        Number.isFinite(node.last_known_seen_s)
      ) {
        seen.set(node.node_id, node.last_known_seen_s);
      }
    }
  } catch {
    return seen;
  }
  return seen;
}

export async function ingestStatus(
  db: D1Database,
  fridgeId: string,
  report: StatusReport,
  receivedS: number,
): Promise<IngestStatusResult> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const existing = await db
      .prepare(
        "SELECT gateway_seen_s, nodes_json FROM system_status WHERE fridge_id = ?",
      )
      .bind(fridgeId)
      .first<{ gateway_seen_s: number; nodes_json: string }>();

    if (existing && existing.gateway_seen_s >= report.gatewaySeenS) {
      return { updatedCount: 0, status: null };
    }

    const previous = readLastKnown(existing?.nodes_json);
    const storedNodes: StoredNodeStatus[] = report.nodes.map((node) => {
      const lastKnown = previous.get(node.node_id);
      return {
        ...node,
        last_known_seen_s:
          node.last_seen_s === null
            ? (lastKnown ?? null)
            : Math.max(node.last_seen_s, lastKnown ?? node.last_seen_s),
      };
    });

    const nodesJson = JSON.stringify(storedNodes);
    const [upsertResult] = await db.batch([
      db
        .prepare(
          `INSERT INTO system_status (fridge_id, gateway_seen_s, received_s, nodes_json)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(fridge_id) DO UPDATE SET
           gateway_seen_s = excluded.gateway_seen_s,
           received_s = excluded.received_s,
           nodes_json = excluded.nodes_json
         WHERE excluded.gateway_seen_s > system_status.gateway_seen_s
           AND system_status.gateway_seen_s IS ? AND system_status.nodes_json IS ?`,
        )
        .bind(
          fridgeId,
          report.gatewaySeenS,
          receivedS,
          nodesJson,
          existing?.gateway_seen_s ?? null,
          existing?.nodes_json ?? null,
        ),
      db
        .prepare(
          "UPDATE fridges SET last_seen_s = MAX(last_seen_s, ?) WHERE id = ?",
        )
        .bind(receivedS, fridgeId),
    ]);

    const changes = upsertResult?.meta.changes ?? 0;
    if (changes <= 0) continue;

    return {
      updatedCount: storedNodes.length,
      status: {
        gateway_seen_s: report.gatewaySeenS,
        received_s: receivedS,
        nodes: storedNodes,
      },
    };
  }
  throw new Error("Concurrent status update; retry the report.");
}
