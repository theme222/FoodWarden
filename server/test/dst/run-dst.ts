import { resolveUiVersion, type UiVersionConfig } from "../../src/ui-version";
import { eventTimeIsValid } from "../../workers/lib/event-time";
import {
  runFullStackSimulation,
  simAddDaysIso,
  simBangkokIsoDate,
} from "./fullstack-sim";
import { formatReplayHint, parseCliIntArg, SeededRng } from "./prng";
import { runSeededSimulation } from "./sim-env";

type SuiteName = "all" | "dashboard" | "fullstack" | "ui-version" | "soak";

function parseSuiteArg(argv: readonly string[]): SuiteName {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    const raw = arg.startsWith("--suite=")
      ? arg.slice("--suite=".length)
      : arg === "--suite"
        ? argv[i + 1]
        : undefined;
    if (
      raw === "all" ||
      raw === "dashboard" ||
      raw === "fullstack" ||
      raw === "ui-version" ||
      raw === "soak"
    ) {
      return raw;
    }
  }
  return "all";
}

function runDashboardSuite(seeds: readonly number[], steps: number): void {
  for (const seed of seeds) {
    runSeededSimulation(seed, steps);
  }
}

function runFullStackSuite(seeds: readonly number[], steps: number): void {
  for (const seed of seeds) {
    runFullStackSimulation(seed, steps);
  }
}

function runUiVersionSuite(seeds: readonly number[], steps: number): void {
  const queries = ["", "?ui=v1", "?ui=v2", "?ui=reset"] as const;
  const cfgs: UiVersionConfig[] = [
    { defaultVersion: "v2", locked: false },
    { defaultVersion: "v1", locked: false },
    { defaultVersion: "v1", locked: true },
  ];
  for (const seed of seeds) {
    const rng = new SeededRng(seed);
    let stored: string | null = null;
    for (let i = 0; i < steps; i++) {
      const cfg = rng.pick(cfgs);
      const q = rng.pick(queries);
      const out = resolveUiVersion({
        search: q,
        stored,
        serverConfig: cfg,
        buildDefault: "v2",
      });
      if (cfg.locked && out.version !== cfg.defaultVersion) {
        throw new Error(
          `Locked config violated (${formatReplayHint(seed, "ui-version")})`,
        );
      }
      if (out.nextStorage === null) stored = null;
      else if (out.nextStorage !== "unchanged") stored = out.nextStorage;
    }
  }
}

function runSoakSuite(seeds: readonly number[]): void {
  for (const seed of seeds) {
    const rng = new SeededRng(seed);
    let nowS = Math.floor(Date.parse("2026-11-22T00:00:00Z") / 1000);
    for (let day = 0; day < 365; day++) {
      const today = simBangkokIsoDate(nowS);
      const exp = simAddDaysIso(today, 7 + rng.int(0, 14));
      if (!/^\d{4}-\d{2}-\d{2}$/.test(exp)) {
        throw new Error(
          `Invalid soak expiry (${formatReplayHint(seed, "soak")})`,
        );
      }
      if (!eventTimeIsValid(nowS, nowS + 60)) {
        throw new Error(
          `Event time check failed in soak (${formatReplayHint(seed, "soak")})`,
        );
      }
      nowS += 86_400;
    }
  }
}

function main() {
  const argv = process.argv.slice(2);
  const suite = parseSuiteArg(argv);
  const singleSeed = parseCliIntArg(argv, "seed", 0, 1);
  const seedCount = parseCliIntArg(argv, "seeds", 25, 1);
  const steps = parseCliIntArg(argv, "steps", 200, 1);
  const seeds =
    singleSeed > 0
      ? [singleSeed]
      : Array.from({ length: seedCount }, (_, idx) => idx + 1);

  const startedMs = performance.now();

  if (suite === "all" || suite === "dashboard") {
    runDashboardSuite(seeds, steps);
  }
  if (suite === "all" || suite === "fullstack") {
    runFullStackSuite(seeds, steps);
  }
  if (suite === "all" || suite === "ui-version") {
    runUiVersionSuite(seeds, steps);
  }
  if (suite === "all" || suite === "soak") {
    runSoakSuite(seeds.slice(0, Math.min(seeds.length, 5)));
  }

  const elapsedMs = Math.round(performance.now() - startedMs);
  console.log(
    `[FoodWarden DST CLI] suite=${suite} seeds=${seeds.length} steps=${steps} passed cleanly in ${elapsedMs}ms`,
  );
}

main();
