import { describe, expect, it } from "vitest";
import { summarizeUptime } from "./lib/uptime";

function report(receivedS: number, gatewayS: number, sensorS: number | null) {
  return {
    received_s: receivedS,
    gateway_seen_s: gatewayS,
    nodes_json: JSON.stringify([
      { node_id: "C0", last_seen_s: gatewayS },
      { node_id: "F0", last_seen_s: sensorS },
    ]),
  };
}

describe("uptime history", () => {
  it("counts report time and distinguishes a known gateway outage from missing downstream evidence", () => {
    const nodes = summarizeUptime(
      [report(50, 50, 50), report(100, 100, 50)],
      0,
      600,
      300,
    );
    expect(nodes.find((node) => node.id === "C0")?.buckets).toEqual([
      { online: 231, offline: 19, unknown: 50 },
      { online: 0, offline: 300, unknown: 0 },
    ]);
    expect(nodes.find((node) => node.id === "F0")?.buckets).toEqual([
      { online: 231, offline: 0, unknown: 69 },
      { online: 0, offline: 0, unknown: 300 },
    ]);
    expect(nodes.find((node) => node.id === "D0")?.buckets).toEqual([
      { online: 0, offline: 0, unknown: 300 },
      { online: 0, offline: 0, unknown: 300 },
    ]);
  });
  it("uses a longer freshness threshold for the sleeping fridge sensor and keeps distinct nodes", () => {
    const reports = [50, 200, 350, 500, 625, 700].map((time) =>
      report(time, time, 50),
    );
    const nodes = summarizeUptime(reports, 0, 900, 300);
    expect(nodes.find((node) => node.id === "F0")?.buckets[2]).toEqual({
      online: 51,
      offline: 230,
      unknown: 19,
    });
  });
});
