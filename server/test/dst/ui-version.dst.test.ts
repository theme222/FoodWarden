import { expect, test } from "bun:test";
import { resolveUiVersion, type UiVersionConfig } from "../../src/ui-version";
import { formatReplayHint, resolveDstSeeds, SeededRng } from "./prng";

const SEEDS = resolveDstSeeds(40);

test("DST: production UI version flag preserves invariants under chaotic overrides and locks", () => {
  const queries = [
    "",
    "?ui=v1",
    "?ui=v2",
    "?ui=reset",
    "?ui=V1&foo=bar",
    "?ui=v99",
    "?ui=%ZZ",
  ] as const;
  const storedValues = [null, "v1", "v2", "V1", "broken", ""] as const;
  const serverConfigs: ReadonlyArray<UiVersionConfig | null> = [
    null,
    { defaultVersion: "v2", locked: false },
    { defaultVersion: "v1", locked: false },
    { defaultVersion: "v1", locked: true },
    { defaultVersion: "v2", locked: true },
  ];
  const buildDefaults = [null, "v1", "v2", "invalid"] as const;

  for (const seed of SEEDS) {
    const rng = new SeededRng(seed);
    let stored: string | null = null;
    let serverConfig: UiVersionConfig | null = {
      defaultVersion: "v2",
      locked: false,
    };

    for (let step = 0; step < 150; step++) {
      const search = rng.pick(queries);
      if (rng.chance(0.25)) stored = rng.pick(storedValues);
      if (rng.chance(0.2)) serverConfig = rng.pick(serverConfigs);
      const buildDefault = rng.pick(buildDefaults);

      const res = resolveUiVersion({
        search,
        stored,
        serverConfig,
        buildDefault,
      });

      try {
        expect(res.version === "v1" || res.version === "v2").toBe(true);

        // Emergency server lock must override query and storage immediately.
        if (serverConfig?.locked) {
          expect(res.locked).toBe(true);
          expect(res.source).toBe("server_lock");
          expect(res.version).toBe(serverConfig.defaultVersion);
          expect(res.nextStorage).toBe("unchanged");
        } else {
          expect(res.locked).toBe(false);
        }

        // "?ui=reset" must clear stored preference when unlocked.
        if (!serverConfig?.locked && search === "?ui=reset") {
          expect(res.nextStorage).toBeNull();
          expect(res.source).not.toBe("storage");
          expect(res.source).not.toBe("query");
        }

        // Clean baseline (no server/build/storage/query) must default to v2.
        if (
          serverConfig === null &&
          search === "" &&
          stored === null &&
          (buildDefault === null || buildDefault === "invalid")
        ) {
          expect(res.version).toBe("v2");
          expect(res.source).toBe("fallback");
        }

        if (res.nextStorage === null) stored = null;
        else if (res.nextStorage !== "unchanged") stored = res.nextStorage;
      } catch (err) {
        throw new Error(
          `ui-version DST failed (step=${step}; replay: ${formatReplayHint(seed, "ui-version")}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }
});

test("DST: ui-version resolver is deterministic for equal inputs", () => {
  const input = {
    search: "?ui=v1",
    stored: "v2",
    serverConfig: { defaultVersion: "v2" as const, locked: false },
    buildDefault: "v2",
  };
  expect(resolveUiVersion(input)).toEqual(resolveUiVersion(input));
});
