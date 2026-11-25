import type { DoorEvent, Food, Fridge, Sample } from "../../src/model";
import {
  initialDashboardState,
  reduceDashboardEvent,
} from "../../src/state/dashboard-machine";
import type {
  AppRoute,
  ChartRange,
  ColorTheme,
  DashboardEvent,
  DashboardMachineState,
  InventoryFilter,
  InventorySort,
  SeriesKey,
} from "../../src/state/dashboard-machine";
import { SeededRng } from "./prng";

export const SIM_BASE_TIME_S = Math.floor(
  Date.parse("2026-11-22T00:00:00Z") / 1000,
);

const CATEGORIES = [
  "Dairy",
  "Produce",
  "Meat",
  "Seafood",
  "Beverage",
  "Condiments",
  "Leftovers",
  "Bakery",
  "Snacks",
  "Other",
] as const;

const DOOR_STATUSES: DoorEvent["status"][] = [
  "SUCCESS",
  "CLOSING",
  "OBSTRUCTION_ERROR",
  "ABORTED",
  "TIMEOUT_ERROR",
  "FAULT_LOCKOUT",
  "CONTRADICTION_ERROR",
];

const ROUTES: AppRoute[] = [
  "hub",
  "food",
  "charts",
  "devices",
  "me",
  "settings",
];

const THEMES: ColorTheme[] = ["green", "blue", "pink"];
const RANGES: ChartRange[] = ["1h", "24h", "7d", "30d"];
const FILTERS: InventoryFilter[] = ["all", "expired", "soon", "fresh"];
const SORTS: InventorySort[] = ["expiry", "fresh", "name"];
const SERIES: SeriesKey[] = ["temperature", "voc", "light"];

function makeSample(rng: SeededRng, timeS: number, nodeId: string): Sample {
  return {
    nodeId,
    timeS,
    temperature: rng.chance(0.1)
      ? null
      : rng.chance(0.2)
        ? 9.5 + rng.next() * 4
        : 2 + rng.next() * 5.5,
    voc: rng.chance(0.1)
      ? null
      : rng.chance(0.2)
        ? 260 + rng.int(0, 120)
        : rng.int(40, 180),
    light: rng.chance(0.1)
      ? null
      : rng.chance(0.15)
        ? rng.int(220, 1600)
        : rng.int(5, 80),
  };
}

function makeFood(rng: SeededRng, idCounter: number, nowS: number): Food {
  const offsetDays = rng.int(-5, 25);
  const expiry = new Date((nowS + offsetDays * 86_400 + 7 * 3600) * 1000)
    .toISOString()
    .slice(0, 10);
  const cat = rng.pick(CATEGORIES);
  const names = [
    ["นมสด", "Fresh Milk"],
    ["แอปเปิล", "Apple"],
    ["อกไก่", "Chicken Breast"],
    ["ข้าวผัด", "Fried Rice"],
    ["ขนมปัง", "Whole Wheat Bread"],
  ] as const;
  const pair = rng.pick(names);
  return {
    id: `item-${idCounter}`,
    nameTh: pair[0],
    nameEn: pair[1],
    expiry,
    category: cat,
    adviceEn: "Keep chilled at 2-4°C",
    adviceTh: "แช่ช่องเย็น 2-4°C",
    hasPhoto: rng.bool(0.5),
    checkInTimestampS: nowS - rng.int(0, 3600),
    confidence: rng.bool(0.7) ? 0.94 : null,
    checkInSource: rng.bool(0.6) ? "CAMERA" : "WEB_MANUAL",
  };
}

function makeFridges(rng: SeededRng, nowS: number): Fridge[] {
  return [
    {
      id: "fridge-kitchen",
      name: "Home kitchen",
      role: "owner",
      lastSeenS: nowS,
      latest: makeSample(rng, nowS, "F0"),
    },
    {
      id: "fridge-dorm",
      name: "Dorm 412",
      role: rng.bool(0.5) ? "owner" : "member",
      lastSeenS: nowS - 60,
      latest: makeSample(rng, nowS - 60, "F0"),
    },
  ];
}

export class SimulatedEnvironment {
  readonly rng: SeededRng;
  private itemSeq = 1;
  private maxGatewaySeenS = 0;

  constructor(seed: number) {
    this.rng = new SeededRng(seed);
  }

  nextEvent(state: DashboardMachineState): DashboardEvent {
    if (!state.signedIn) {
      return {
        type: "SIGN_IN",
        fridges: makeFridges(this.rng, state.nowS),
      };
    }

    if (
      !state.activeFridgeId &&
      state.fridges.length > 0 &&
      this.rng.chance(0.7)
    ) {
      return {
        type: "NAVIGATE",
        route: "food",
        fridgeId: state.fridges[0]!.id,
      };
    }

    const roll = this.rng.int(1, 100);

    // 15%: Clock advance (10s to 7d — simulates long-running fridge behavior)
    if (roll <= 15) {
      const deltas = [10, 60, 180, 900, 21_600, 86_400, 604_800] as const;
      return { type: "TICK_CLOCK", deltaS: this.rng.pick(deltas) };
    }

    // 18%: Telemetry burst (including out-of-order timestamps & extreme readings)
    if (roll <= 33) {
      const node = this.rng.bool(0.8) ? "F0" : "F1";
      const jitter = this.rng.int(-120, 60);
      return {
        type: "WS_EVENT",
        event: {
          type: "telemetry",
          lastSeenS: state.nowS,
          samples: [
            makeSample(this.rng, Math.max(0, state.nowS + jitter), node),
            makeSample(this.rng, Math.max(0, state.nowS + jitter + 15), node),
          ],
        },
      };
    }

    // 12%: Status heartbeat (including delayed out-of-order WS frames!)
    if (roll <= 45) {
      const delayed = this.rng.chance(0.35) && this.maxGatewaySeenS > 500;
      const gatewaySeen = delayed
        ? this.maxGatewaySeenS - this.rng.int(50, 400)
        : state.nowS;
      this.maxGatewaySeenS = Math.max(this.maxGatewaySeenS, gatewaySeen);
      return {
        type: "WS_EVENT",
        event: {
          type: "status",
          status: {
            gatewaySeenS: gatewaySeen,
            receivedS: state.nowS,
            nodes: [
              {
                id: "C0",
                reported: true,
                reportedS: gatewaySeen,
                lastKnownS: gatewaySeen,
              },
              {
                id: "F0",
                reported: true,
                reportedS: this.rng.chance(0.2)
                  ? gatewaySeen - 900
                  : gatewaySeen,
                lastKnownS: gatewaySeen - 60,
              },
              {
                id: "D0",
                reported: !this.rng.chance(0.15),
                reportedS: this.rng.chance(0.25) ? null : gatewaySeen - 30,
                lastKnownS: gatewaySeen - 30,
              },
            ],
          },
        },
      };
    }

    // 8%: Door events
    if (roll <= 53) {
      return {
        type: "WS_EVENT",
        event: {
          type: "door_events",
          events: [
            {
              nodeId: "D0",
              timestampS: Math.max(0, state.nowS - this.rng.int(0, 700_000)),
              status: this.rng.pick(DOOR_STATUSES),
            },
          ],
        },
      };
    }

    // 8%: Fault injection (WS disconnect, load error, revocation, deletion, recovery)
    if (roll <= 61) {
      const fault = this.rng.int(1, 6);
      if (fault === 1) return { type: "WS_DISCONNECTED" };
      if (fault === 2) return { type: "WS_CONNECTED" };
      if (fault === 3) return { type: "LOAD_ERROR" };
      if (fault === 4) return { type: "RETRY_LOAD" };
      if (fault === 5 && state.activeFridgeId) {
        return {
          type: "WS_EVENT",
          event: { type: "member_revoked", email: "user@example.com" },
        };
      }
      return {
        type: "SET_FRIDGES",
        fridges: makeFridges(this.rng, state.nowS),
      };
    }

    // 22%: Inventory user actions (add, take out, undo, filter, select, bulk mutate)
    if (roll <= 83) {
      const action = this.rng.int(1, 10);
      if (action <= 2 || state.room.inventory.length === 0) {
        return {
          type: "ADD_FOOD_ITEM",
          item: makeFood(this.rng, this.itemSeq++, state.nowS),
        };
      }
      if (action === 3) {
        const item = this.rng.pick(state.room.inventory);
        return { type: "TAKE_OUT_ITEM", itemId: item.id };
      }
      if (action === 4) {
        return { type: "UNDO_TAKE_OUT" };
      }
      if (action === 5) {
        return {
          type: "SET_SEARCH",
          search: this.rng.pick(["", "milk", "แอป", "zzz-nonexistent"]),
        };
      }
      if (action === 6) {
        return { type: "SET_FILTER", filter: this.rng.pick(FILTERS) };
      }
      if (action === 7) {
        return { type: "SET_SORT", sort: this.rng.pick(SORTS) };
      }
      if (action === 8) {
        return this.rng.bool(0.5)
          ? { type: "TOGGLE_FAVORITES_ONLY" }
          : { type: "RESET_FILTERS" };
      }
      if (action === 9) {
        if (!state.inventoryUi.selecting) {
          return {
            type: "SELECT_ALL_VISIBLE",
            itemIds: state.room.inventory.slice(0, 4).map((i) => i.id),
          };
        }
        return { type: "TOGGLE_SELECTING", enabled: false };
      }
      const chosen = state.inventoryUi.selectedIds;
      if (chosen.length > 0) {
        const split = this.rng.int(0, chosen.length);
        return {
          type: "BULK_MUTATION_RESULT",
          succeededIds: chosen.slice(0, split),
          failedIds: chosen.slice(split),
        };
      }
      return {
        type: "SET_CATEGORY",
        category: this.rng.bool(0.5) ? "" : this.rng.pick(CATEGORIES),
      };
    }

    // 17%: Navigation, theme, language, charts, devices, editing draft isolation
    const ui = this.rng.int(1, 8);
    if (ui === 1) {
      return {
        type: "NAVIGATE",
        route: this.rng.pick(ROUTES),
        fridgeId: state.fridges[0]?.id,
      };
    }
    if (ui === 2)
      return { type: "SET_THEME", colorTheme: this.rng.pick(THEMES) };
    if (ui === 3) {
      return {
        type: "SET_LANGUAGE",
        language: this.rng.bool(0.5) ? "th" : "en",
      };
    }
    if (ui === 4)
      return { type: "SET_CHART_RANGE", range: this.rng.pick(RANGES) };
    if (ui === 5) {
      return { type: "TOGGLE_CHART_SERIES", series: this.rng.pick(SERIES) };
    }
    if (ui === 6) {
      return {
        type: "SET_SCRUBBER",
        index: this.rng.int(-5, state.room.history.length + 5),
      };
    }
    if (ui === 7) {
      const target = state.room.inventory[0]?.id ?? "item-1";
      return this.rng.bool(0.5)
        ? { type: "SWITCH_EDIT_ITEM", itemId: target }
        : { type: "UPDATE_EDIT_DRAFT", nameEn: "Pending edit" };
    }
    return {
      type: "EXPAND_DEVICE",
      nodeId: this.rng.pick(["C0", "F0", "D0", null]),
    };
  }
}

export function runSeededSimulation(
  seed: number,
  steps = 250,
  onStep?: (
    step: number,
    prev: DashboardMachineState,
    next: DashboardMachineState,
    event: DashboardEvent,
  ) => void,
): { finalState: DashboardMachineState; trace: string[] } {
  const env = new SimulatedEnvironment(seed);
  let state = initialDashboardState(SIM_BASE_TIME_S);
  const trace: string[] = [];

  for (let step = 0; step < steps; step++) {
    const event = env.nextEvent(state);
    const next = reduceDashboardEvent(state, event);
    trace.push(`${step}:${event.type}`);
    onStep?.(step, state, next, event);
    state = next;
  }

  return { finalState: state, trace };
}
