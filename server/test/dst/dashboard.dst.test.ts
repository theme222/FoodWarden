import { expect, test } from "bun:test";
import {
  buildFavoriteShelves,
  CHART_SERIES,
  clampScrubberIndex,
  computeDailyDoorCounts,
  computeSeriesStats,
  computeSetupProgress,
  deriveKpiSummary,
  deriveRecoveryActions,
  deriveTelemetryAlerts,
  filterAndSortInventory,
  foodIdentityKey,
  parseColorTheme,
  piecewiseNormalizedY,
  relativeExpiryText,
  summarizeDeviceHealth,
  summarizeInventory,
} from "../../src/state/dashboard-machine";
import { resolveDstSeeds } from "./prng";
import { runSeededSimulation, SIM_BASE_TIME_S } from "./sim-env";

const SEEDS = resolveDstSeeds(50);

test("DST: multi-seed chaotic simulation preserves all dashboard invariants", () => {
  for (const seed of SEEDS) {
    let maxGatewaySeenS = 0;

    runSeededSimulation(seed, 250, (step, prev, next, event) => {
      const ctx = `seed=${seed} step=${step} event=${event.type}`;

      try {
        // 1. FEFO & Inventory Accounting Invariant
        const summary = summarizeInventory(next.room.inventory, next.nowS);
        expect(
          summary.expired + summary.soon + summary.fresh + summary.unknown,
        ).toBe(next.room.inventory.length);

        const filtered = filterAndSortInventory(next.room.inventory, {
          search: next.inventoryUi.search,
          category: next.inventoryUi.category,
          filter: next.inventoryUi.filter,
          sort: next.inventoryUi.sort,
          favoritesOnly: next.inventoryUi.favoritesOnly,
          favoriteCategories: new Set(next.inventoryUi.favoriteCategories),
          favoriteFoodKeys: new Set(next.inventoryUi.favoriteFoodKeys),
          nowS: next.nowS,
          language: next.language,
        });
        const groupedCount = filtered.groups.reduce(
          (acc, g) => acc + g.length,
          0,
        );
        expect(groupedCount).toBe(filtered.visible.length);

        if (next.inventoryUi.sort === "expiry") {
          for (let i = 1; i < filtered.groups.length; i++) {
            const prevExp = filtered.groups[i - 1]![0]!.expiry || "9999-99-99";
            const currExp = filtered.groups[i]![0]!.expiry || "9999-99-99";
            expect(prevExp.localeCompare(currExp)).toBeLessThanOrEqual(0);
          }
        }

        // 2. Monotonic Heartbeat & Bounded Telemetry Invariant
        if (next.room.heartbeat && next.signedIn && event.type !== "SIGN_OUT") {
          expect(next.room.heartbeat.gatewaySeenS).toBeGreaterThanOrEqual(
            maxGatewaySeenS,
          );
          maxGatewaySeenS = next.room.heartbeat.gatewaySeenS;
        }
        if (event.type === "SIGN_OUT") {
          maxGatewaySeenS = 0;
        }
        expect(next.room.history.length).toBeLessThanOrEqual(2000);
        for (let i = 1; i < next.room.history.length; i++) {
          expect(next.room.history[i]!.timeS).toBeGreaterThanOrEqual(
            next.room.history[i - 1]!.timeS,
          );
        }

        // 3. Charts Safety Invariant
        expect(next.chartsUi.enabledSeries.length).toBeGreaterThanOrEqual(1);
        const nodes = [
          ...new Set(next.room.history.map((s) => s.nodeId)),
        ].sort();
        const activeNode = nodes.includes(next.chartsUi.activeNode)
          ? next.chartsUi.activeNode
          : (nodes[0] ?? next.chartsUi.activeNode);
        const nodePoints = next.room.history.filter(
          (s) => s.nodeId === activeNode,
        );
        if (nodePoints.length === 0) {
          expect(next.chartsUi.scrubberIndex).toBeNull();
        } else if (next.chartsUi.scrubberIndex !== null) {
          expect(next.chartsUi.scrubberIndex).toBeGreaterThanOrEqual(0);
          expect(next.chartsUi.scrubberIndex).toBeLessThan(nodePoints.length);
        }

        for (const s of CHART_SERIES) {
          for (const v of [-50, 0, s.limit, s.max, 99999, Number.NaN]) {
            const py = piecewiseNormalizedY(v, s.limit, s.max, 34, 220);
            expect(Number.isFinite(py)).toBe(true);
            expect(py).toBeGreaterThanOrEqual(34);
            expect(py).toBeLessThanOrEqual(220);
          }
          const stats = computeSeriesStats(nodePoints, s.key, s.limit);
          expect(stats.aboveLimitCount).toBeLessThanOrEqual(stats.count);
        }

        const buckets = computeDailyDoorCounts(
          next.room.doorEvents,
          next.nowS,
          7,
        );
        expect(buckets).toHaveLength(7);
        const bucketIsoSet = new Set(buckets.map((b) => b.dateIso));
        const expectedWindowTotal = next.room.doorEvents.filter((e) =>
          bucketIsoSet.has(
            new Date((Math.max(0, e.timestampS) + 7 * 3600) * 1000)
              .toISOString()
              .slice(0, 10),
          ),
        ).length;
        expect(buckets.reduce((acc, b) => acc + b.count, 0)).toBe(
          expectedWindowTotal,
        );

        // 4. Access, Selection & Draft Isolation Invariant
        if (
          event.type === "WS_EVENT" &&
          (event.event.type === "member_revoked" ||
            event.event.type === "fridge_deleted")
        ) {
          expect(next.room.connectionState).toBe("closed");
          expect(next.activeFridgeId).toBeNull();
        }
        if (!next.inventoryUi.selecting) {
          expect(next.inventoryUi.selectedIds).toHaveLength(0);
        }
        if (event.type === "BULK_MUTATION_RESULT") {
          for (const okId of event.succeededIds) {
            expect(next.inventoryUi.selectedIds).not.toContain(okId);
          }
        }
        if (event.type === "SWITCH_EDIT_ITEM") {
          expect(next.editingDraft.dirtyNameEn).toBe("");
        }

        // 5. Undo Safety Invariant
        if (
          event.type === "TICK_CLOCK" &&
          prev.inventoryUi.undoExpiresAtS !== null &&
          next.nowS > prev.inventoryUi.undoExpiresAtS
        ) {
          expect(next.inventoryUi.undoItem).toBeNull();
          expect(next.inventoryUi.undoExpiresAtS).toBeNull();
        }
        if (event.type === "UNDO_TAKE_OUT") {
          expect(next.inventoryUi.undoItem).toBeNull();
        }

        // 6. First Failure Test Invariant (Product Design Psychology Ch. 30)
        const health = summarizeDeviceHealth(next.room.heartbeat, next.nowS);
        const needsRecovery =
          next.room.loadError ||
          (next.signedIn &&
            next.activeFridgeId !== null &&
            (next.room.connectionState === "reconnecting" ||
              next.room.connectionState === "closed")) ||
          (next.signedIn &&
            next.activeFridgeId === null &&
            next.route !== "hub") ||
          filtered.visible.length === 0 ||
          next.inventoryUi.bulkFailedIds.length > 0 ||
          health.degradedNodeIds.length > 0;
        if (needsRecovery) {
          expect(deriveRecoveryActions(next).length).toBeGreaterThanOrEqual(1);
        }

        // 7. Endowed Progress & Pure Utility Sanity (Ch. 19)
        const progress = computeSetupProgress({
          lineLinked: seed % 2 === 0,
          hasDevices: next.room.heartbeat !== null,
          memberCount: next.fridges.length + 1,
          hasGeminiKey: seed % 3 === 0,
        });
        expect(progress.completed).toBeGreaterThanOrEqual(1);
        expect(progress.completed).toBeLessThanOrEqual(4);
      } catch (err) {
        throw new Error(
          `DST invariant failed [${ctx}]: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    });
  }
});

test("DST: same seed produces identical final state and trace", () => {
  const runA = runSeededSimulation(42, 200);
  const runB = runSeededSimulation(42, 200);
  expect(runA.trace).toEqual(runB.trace);
  expect(runA.finalState).toEqual(runB.finalState);
});

test("DST helpers: theme parser, scrubber clamping, KPI verdicts, relative expiry, and favorite shelves", () => {
  expect(parseColorTheme("blue")).toBe("blue");
  expect(parseColorTheme("pink")).toBe("pink");
  expect(parseColorTheme("unknown")).toBe("green");

  expect(clampScrubberIndex(5, 0)).toBeNull();
  expect(clampScrubberIndex(99, 3)).toBe(2);
  expect(clampScrubberIndex(-4, 3)).toBe(0);

  const nowS = SIM_BASE_TIME_S;
  const boundarySample = {
    nodeId: "F0",
    timeS: nowS,
    temperature: 9.5,
    voc: 250,
    light: 25,
  };
  const kpi = deriveKpiSummary(
    boundarySample,
    [{ nodeId: "D0", timestampS: nowS - 120, status: "SUCCESS" }],
    nowS,
    "en",
  );
  expect(deriveTelemetryAlerts(boundarySample)).toEqual(["warm", "spoil"]);
  expect(kpi.find((t) => t.id === "temperature")?.tone).toBe("bad");
  expect(kpi.find((t) => t.id === "voc")?.tone).toBe("bad");
  expect(kpi.find((t) => t.id === "door")?.tone).toBe("mint");

  const todayFood = {
    id: "f1",
    nameEn: "Milk",
    nameTh: "นม",
    expiry: "2026-11-22",
    category: "Dairy",
    adviceEn: "",
    adviceTh: "",
    hasPhoto: false,
  };
  expect(relativeExpiryText(todayFood, nowS, "en")).toBe("Expires today");
  expect(relativeExpiryText(todayFood, nowS, "th")).toBe("หมดอายุวันนี้");

  const key = foodIdentityKey("นม", "Milk", "Dairy");
  expect(key).toBe(foodIdentityKey(" นม ", "milk", "dairy"));

  const shelves = buildFavoriteShelves(
    [todayFood],
    {
      categories: ["Produce"],
      items: [
        {
          item_key: "a".repeat(64),
          name_th: "นม",
          name_en: "Milk",
          category: "Dairy",
          count: 1,
        },
        {
          item_key: "b".repeat(64),
          name_th: "ไข่",
          name_en: "Eggs",
          category: "Other",
          count: 0,
        },
      ],
    },
    nowS,
  );
  expect(shelves.map((s) => s.category)).toEqual(["Dairy", "Other"]);
  expect(shelves[0]!.entries[0]!.inStock).toBe(true);
  expect(shelves[1]!.entries[0]!.inStock).toBe(false);
});
