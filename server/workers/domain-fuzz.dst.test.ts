import { describe, expect, it } from "vitest";
import { parseDoorEvents } from "./lib/door-events";
import { eventTimeIsValid, MAX_FUTURE_SKEW_S } from "./lib/event-time";
import { addDaysToIsoDate, bangkokIsoDate } from "./lib/gemini";
import {
  isCalendarDate,
  isCategory,
  parseInventoryPatch,
  parseManualFood,
} from "./lib/inventory";
import { parseStatus } from "./lib/status";
import { parseTelemetry } from "./lib/telemetry";
import { SeededRng } from "../test/dst/prng";

function seededUuidV4(rng: SeededRng): string {
  const hex = "0123456789abcdef";
  const seg = (len: number) =>
    Array.from({ length: len }, () => hex[rng.int(0, 15)]!).join("");
  const variant = ["8", "9", "a", "b"][rng.int(0, 3)]!;
  return `${seg(8)}-${seg(4)}-4${seg(3)}-${variant}${seg(3)}-${seg(12)}`;
}

describe("Worker Domain DST Fuzz", () => {
  it("never throws and rejects adversarial telemetry, door events, status, and inventory inputs", () => {
    const rng = new SeededRng(9001);
    const nowS = 1_795_305_600;

    const weirdInputs: unknown[] = [
      null,
      undefined,
      "",
      42,
      [],
      {},
      { samples: [] },
      { samples: "nope" },
      { events: [] },
      { nodes: [] },
      { nodes: [{ node_id: "F0", last_seen_s: nowS }] }, // Missing mandatory C0
      {
        samples: [
          {
            node_id: "F0",
            timestamp_s: nowS + MAX_FUTURE_SKEW_S + 1,
            temp_celsius: 4,
            voc_index: 50,
            light_ldr: 10,
          },
        ],
      },
      {
        samples: [
          {
            node_id: "F0",
            timestamp_s: nowS,
            temp_celsius: Number.NaN,
            voc_index: 50,
            light_ldr: 10,
          },
        ],
      },
      {
        events: [{ node_id: "D0", timestamp_s: -1, status: "SUCCESS" }],
      },
    ];

    for (const input of weirdInputs) {
      expect(() => parseTelemetry(input, nowS)).not.toThrow();
      expect(() => parseDoorEvents(input, nowS)).not.toThrow();
      expect(() => parseStatus(input, nowS)).not.toThrow();
      expect(() => parseManualFood(input)).not.toThrow();
      expect(() => parseInventoryPatch(input)).not.toThrow();
    }

    expect(
      parseStatus({ nodes: [{ node_id: "F0", last_seen_s: nowS }] }, nowS),
    ).toBeNull();
    expect(
      parseTelemetry(
        {
          samples: [
            {
              node_id: "F0",
              timestamp_s: nowS + MAX_FUTURE_SKEW_S + 10,
              temp_celsius: 4,
              voc_index: 10,
              light_ldr: 5,
            },
          ],
        },
        nowS,
      ),
    ).toBeNull();

    for (let i = 0; i < 400; i++) {
      const validTime = rng.bool(0.75)
        ? nowS - rng.int(0, 86_400)
        : rng.pick([-5, nowS + MAX_FUTURE_SKEW_S + 50, 99999999999999]);
      const isValidT = eventTimeIsValid(validTime, nowS);
      const tRes = parseTelemetry(
        {
          samples: [
            {
              node_id: rng.pick(["F0", "F1", ""]),
              timestamp_s: validTime,
              temp_celsius: rng.bool(0.9) ? 4.2 : Number.POSITIVE_INFINITY,
              voc_index: 100,
              light_ldr: null,
            },
          ],
        },
        nowS,
      );
      if (!isValidT) expect(tRes).toBeNull();

      const dateCandidate = rng.pick([
        "2026-11-22",
        "2028-02-29",
        "2026-02-29",
        "2026-04-31",
        "not-a-date",
      ]);
      const dateValid = isCalendarDate(dateCandidate);
      expect(dateValid).toBe(
        dateCandidate === "2026-11-22" || dateCandidate === "2028-02-29",
      );

      const manual = parseManualFood({
        item_id: seededUuidV4(rng),
        name: rng.pick(["นมสด", "Apple", "   "]),
        estimated_expiry_date: dateCandidate,
        category: rng.pick(["Dairy", "Produce", "BadCategory"]),
        jpeg_base64: null,
      });
      if (manual !== null) {
        expect(isCategory(manual.category)).toBe(true);
        expect(isCalendarDate(manual.expiry)).toBe(true);
        expect(manual.name.length).toBeGreaterThan(0);
      }

      const baseIso = bangkokIsoDate(nowS + i * 86_400);
      const stepDays = rng.int(0, 400);
      const shifted = addDaysToIsoDate(baseIso, stepDays);
      expect(isCalendarDate(shifted)).toBe(true);
      expect(
        Math.round(
          (Date.parse(`${shifted}T00:00:00Z`) -
            Date.parse(`${baseIso}T00:00:00Z`)) /
            86_400_000,
        ),
      ).toBe(stepDays);
    }
  });
});
