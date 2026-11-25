import { expect, test } from "bun:test";
import { runFullStackSimulation } from "./fullstack-sim";
import { formatReplayHint, resolveDstSeeds } from "./prng";

const SEEDS = resolveDstSeeds(30);

test("DST Full-Stack: multi-actor chaos preserves idempotency, RBAC, cooldowns, photo GC, and monotonicity", () => {
  for (const seed of SEEDS) {
    try {
      const { sim } = runFullStackSimulation(seed, 200);
      expect(sim.metrics.stepsExecuted).toBe(200);
      expect(sim.metrics.cooldownViolations).toBe(0);
      expect(sim.metrics.prematurePhotoDeletes).toBe(0);
    } catch (err) {
      throw new Error(
        `Full-stack DST failed (replay: ${formatReplayHint(seed, "fullstack")}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
});

test("DST Full-Stack: exact seed replay produces bit-for-bit identical trace and state", () => {
  const runA = runFullStackSimulation(1337, 180);
  const runB = runFullStackSimulation(1337, 180);

  expect(runA.trace).toEqual(runB.trace);
  expect(runA.sim.metrics).toEqual(runB.sim.metrics);
  expect(runA.sim.outbox).toEqual(runB.sim.outbox);
  expect([...runA.sim.inventory.keys()]).toEqual([
    ...runB.sim.inventory.keys(),
  ]);
  expect(runA.sim.clients).toEqual(runB.sim.clients);
});
