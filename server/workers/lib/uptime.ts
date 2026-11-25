import {
  contactState,
  GATEWAY_STALE_S,
  nodeFreshnessSeconds,
} from "../../src/lib/node-contact";

type Report = {
  gateway_seen_s: number;
  received_s: number;
  nodes_json: string;
};
type NodeReport = { node_id: string; last_seen_s: number | null };
type Duration = { online: number; offline: number; unknown: number };

function addDuration(
  buckets: Duration[],
  from: number,
  to: number,
  startS: number,
  bucketS: number,
  state: keyof Duration,
) {
  for (let cursor = from; cursor < to;) {
    const index = Math.floor((cursor - startS) / bucketS);
    const end = Math.min(to, startS + (index + 1) * bucketS);
    const bucket = buckets[index]!;
    bucket.unknown -= end - cursor;
    bucket[state] += end - cursor;
    cursor = end;
  }
}

export function summarizeUptime(
  reports: Report[],
  startS: number,
  endS: number,
  bucketS: number,
) {
  const parsed = reports.map((report) => ({
    receivedS: report.received_s,
    gatewaySeenS: report.gateway_seen_s,
    nodes: new Map(
      (JSON.parse(report.nodes_json) as NodeReport[]).map((node) => [
        node.node_id,
        node.last_seen_s,
      ]),
    ),
  }));
  const ids = new Set(["C0", "F0", "D0"]);
  for (const report of parsed)
    for (const id of report.nodes.keys()) ids.add(id);

  return [...ids].map((id) => {
    const buckets = Array.from({ length: (endS - startS) / bucketS }, () => ({
      online: 0,
      offline: 0,
      unknown: bucketS,
    }));
    const firstObservation =
      parsed.find((report) => id === "C0" || report.nodes.get(id) != null)
        ?.receivedS ?? null;
    if (firstObservation === null) return { id, buckets };
    for (const [index, report] of parsed.entries()) {
      const from = Math.max(startS, report.receivedS, firstObservation);
      const to = Math.min(endS, parsed[index + 1]?.receivedS ?? endS);
      if (to <= from) continue;
      const reportedS = report.nodes.get(id) ?? null;
      const node = { id, reported: report.nodes.has(id), reportedS };
      const gatewayExpiry =
        Math.min(report.receivedS, report.gatewaySeenS) + GATEWAY_STALE_S + 1;
      const nodeExpiry = (reportedS ?? from) + nodeFreshnessSeconds(id) + 1;
      const boundaries = [
        from,
        ...[gatewayExpiry, nodeExpiry]
          .filter((time) => time > from && time < to)
          .sort((a, b) => a - b),
        to,
      ];
      for (let offset = 0; offset < boundaries.length - 1; offset++) {
        const left = boundaries[offset]!;
        const right = boundaries[offset + 1]!;
        const state = contactState(node, report, left);
        if (state === "gatewayMissing") continue;
        addDuration(
          buckets,
          left,
          right,
          startS,
          bucketS,
          state === "recent" ? "online" : "offline",
        );
      }
    }
    return { id, buckets };
  });
}

export async function queryUptime(
  db: D1Database,
  fridgeId: string,
  range: "24h" | "72h",
  nowS: number,
) {
  const bucketS = range === "72h" ? 10_800 : 3_600;
  const startS = nowS - 24 * bucketS;
  const [anchor, ...days] = await db.batch<Report>([
    db
      .prepare(
        "SELECT * FROM fridge_status_history WHERE fridge_id=? AND received_s<? ORDER BY received_s DESC, gateway_seen_s DESC LIMIT 1",
      )
      .bind(fridgeId, startS),
    ...Array.from({ length: range === "72h" ? 3 : 1 }, (_, day) =>
      db
        .prepare(
          "SELECT * FROM fridge_status_history WHERE fridge_id=? AND received_s>=? AND received_s<? ORDER BY received_s, gateway_seen_s",
        )
        .bind(fridgeId, startS + day * 86400, startS + (day + 1) * 86400),
    ),
  ]);
  return {
    startS,
    endS: nowS,
    bucketS,
    nodes: summarizeUptime(
      [...(anchor?.results ?? []), ...days.flatMap((day) => day.results)],
      startS,
      nowS,
      bucketS,
    ),
  };
}
