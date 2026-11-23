import { expect, test } from "bun:test";
import { summarizeInventory } from "../../src/state/dashboard-machine";
import { eventTimeIsValid } from "../../workers/lib/event-time";
import { simAddDaysIso, simBangkokIsoDate } from "./fullstack-sim";
import { SeededRng } from "./prng";

function runYearSoak(startIsoUtc: string, seed: number) {
  const rng = new SeededRng(seed);
  let nowS = Math.floor(Date.parse(startIsoUtc) / 1000);
  const foods: Array<{
    id: string;
    nameEn: string;
    nameTh: string;
    expiry: string;
    category: string;
    adviceEn: string;
    adviceTh: string;
    hasPhoto: boolean;
  }> = [];
  let telemetryCount = 0;

  for (let day = 0; day < 365; day++) {
    const todayBkk = simBangkokIsoDate(nowS);

    const adds = rng.int(0, 2);
    for (let a = 0; a < adds; a++) {
      const shelfLife = rng.int(1, 21);
      foods.push({
        id: `d${day}-${a}`,
        nameEn: "Daily Item",
        nameTh: "อาหารประจำวัน",
        expiry: simAddDaysIso(todayBkk, shelfLife),
        category: rng.pick(["Dairy", "Produce", "Meat", "Bakery", "Other"]),
        adviceEn: "",
        adviceTh: "",
        hasPhoto: false,
      });
    }

    foods.sort((x, y) => x.expiry.localeCompare(y.expiry));
    const consumeCount = rng.int(0, Math.min(2, foods.length));
    foods.splice(0, consumeCount);

    for (let h = 0; h < 12; h++) {
      const ts = nowS + h * 1800;
      expect(eventTimeIsValid(ts, nowS + 11 * 1800)).toBe(true);
      telemetryCount++;
    }

    const summary = summarizeInventory(foods, nowS);
    expect(
      summary.expired + summary.soon + summary.fresh + summary.unknown,
    ).toBe(foods.length);
    expect(summary.unknown).toBe(0);

    nowS += 86_400;
  }

  return { remainingFoods: foods.length, telemetryCount };
}

test("DST Soak: 365-day simulated execution across standard year preserves all invariants", () => {
  const result = runYearSoak("2026-11-22T00:00:00Z", 2026);
  expect(result.telemetryCount).toBe(365 * 12);
});

test("DST Soak: 365-day simulation spanning 2028 leap day handles all Bangkok dates cleanly", () => {
  const feb28 = simBangkokIsoDate(Math.floor(Date.parse("2028-02-28T10:00:00Z") / 1000));
  expect(feb28).toBe("2028-02-28");
  expect(simAddDaysIso(feb28, 1)).toBe("2028-02-29");
  expect(simAddDaysIso(feb28, 2)).toBe("2028-03-01");

  const leapRun = runYearSoak("2028-01-01T00:00:00Z", 2028);
  expect(leapRun.telemetryCount).toBe(365 * 12);
});
