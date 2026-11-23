import {
  contactState,
  expiryLabel,
  foodGroups,
  mergeDoorEvents,
  mergeTelemetrySamples,
  statusTree,
} from "../model";
import type {
  ContactState,
  DoorEvent,
  Food,
  Fridge,
  FridgeRoomEvent,
  Heartbeat,
  Language,
  Sample,
  StatusNode,
} from "../model";
import type { Favorite } from "../line-data";

export type ColorTheme = "green" | "blue" | "pink";
export type FoodStatus = "expired" | "soon" | "fresh" | "unknown";
export type InventoryFilter = "all" | "expired" | "soon" | "fresh";
export type InventorySort = "expiry" | "fresh" | "name";
export type ChartRange = "1h" | "24h" | "7d" | "30d";
export type SeriesKey = "temperature" | "voc" | "light";
type KpiTone = "dark" | "limey" | "soft" | "mint" | "bad" | "idle";
export type DeviceHealthTier = "ok" | "late" | "off" | "unknown";

export const TEMP_DANGER_C = 8;
export const VOC_DANGER = 250;
export const LIGHT_OPEN_LDR = 200;

export const CHART_SERIES = [
  {
    key: "temperature",
    th: "อุณหภูมิ",
    en: "Temperature",
    unit: "°C",
    limit: TEMP_DANGER_C,
    max: 12,
    color: "#D9531E",
    textColor: "#A63A0E",
  },
  {
    key: "voc",
    th: "คุณภาพอากาศ (VOC)",
    en: "VOC",
    unit: "VOC",
    limit: VOC_DANGER,
    max: 350,
    color: "#1971C2",
    textColor: "#14599B",
  },
  {
    key: "light",
    th: "แสงในตู้",
    en: "Light",
    unit: "LDR",
    limit: LIGHT_OPEN_LDR,
    max: 1600,
    color: "#B57F00",
    textColor: "#785300",
  },
] as const;

export function parseColorTheme(raw: string | null): ColorTheme {
  return raw === "blue" || raw === "pink" ? raw : "green";
}

function bangkokDateIso(timeS: number): string {
  const safeS = Number.isFinite(timeS) ? Math.max(0, timeS) : 0;
  return new Date((safeS + 7 * 3600) * 1000).toISOString().slice(0, 10);
}

/** Compute whole calendar days until expiry in Asia/Bangkok (UTC+7). */
function daysLeft(expiry: string, nowS: number): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry)) return Number.NaN;
  const target = new Date(`${expiry}T00:00:00Z`);
  if (!Number.isFinite(target.getTime()) || target.toISOString().slice(0, 10) !== expiry) {
    return Number.NaN;
  }
  const today = bangkokDateIso(nowS);
  return Math.round((target.getTime() - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

export function foodStatus(
  food: Pick<Food, "expiry">,
  nowS: number,
): FoodStatus {
  const days = daysLeft(food.expiry, nowS);
  if (!Number.isFinite(days)) return "unknown";
  if (days < 0) return "expired";
  if (days <= 2) return "soon";
  return "fresh";
}

/** Human-friendly relative expiry countdown suitable for cards and compact tiles. */
export function relativeExpiryText(
  food: Pick<Food, "expiry">,
  nowS: number,
  language: Language,
): string {
  const th = language === "th";
  const days = daysLeft(food.expiry, nowS);
  if (!Number.isFinite(days)) return th ? "ไม่ทราบวันหมดอายุ" : "Expiry unknown";
  if (days < -1) {
    return th ? `หมดอายุ ${Math.abs(days)} วัน` : `Expired ${Math.abs(days)}d ago`;
  }
  if (days === -1) return th ? "หมดอายุเมื่อวาน" : "Expired yesterday";
  if (days === 0) return th ? "หมดอายุวันนี้" : "Expires today";
  if (days === 1) return th ? "พรุ่งนี้" : "Tomorrow";
  if (days <= 14) return th ? `อีก ${days} วัน` : `${days} days left`;
  return th
    ? `หมดอายุ ${expiryLabel(food.expiry, language)}`
    : `Exp ${expiryLabel(food.expiry, language)}`;
}

export function foodIdentityKey(
  nameTh: string,
  nameEn: string,
  category: string,
): string {
  return JSON.stringify(
    [nameTh, nameEn, category].map((part) =>
      part.trim().normalize("NFKC").toLowerCase(),
    ),
  );
}

export interface InventorySummaryCounts {
  total: number;
  expired: number;
  soon: number;
  fresh: number;
  unknown: number;
}

export function summarizeInventory(
  items: readonly Food[],
  nowS: number,
): InventorySummaryCounts {
  let expired = 0;
  let soon = 0;
  let fresh = 0;
  let unknown = 0;
  for (const item of items) {
    const st = foodStatus(item, nowS);
    if (st === "expired") expired++;
    else if (st === "soon") soon++;
    else if (st === "fresh") fresh++;
    else unknown++;
  }
  return {
    total: items.length,
    expired,
    soon,
    fresh,
    unknown,
  };
}

export function filterAndSortInventory(
  items: readonly Food[],
  params: {
    search: string;
    category: string;
    filter: InventoryFilter;
    sort: InventorySort;
    favoritesOnly: boolean;
    favoriteCategories: ReadonlySet<string>;
    favoriteFoodKeys: ReadonlySet<string>;
    nowS: number;
    language: Language;
  },
): { visible: Food[]; groups: Food[][] } {
  const term = params.search.trim().normalize("NFKC").toLowerCase();
  const visible = items.filter((food) => {
    const matchesTerm =
      !term ||
      `${food.nameTh} ${food.nameEn}`
        .normalize("NFKC")
        .toLowerCase()
        .includes(term);
    const matchesCategory =
      !params.category || food.category === params.category;
    const matchesStatus =
      params.filter === "all" ||
      foodStatus(food, params.nowS) === params.filter;
    const matchesFavorite =
      !params.favoritesOnly ||
      params.favoriteCategories.has(food.category) ||
      params.favoriteFoodKeys.has(
        foodIdentityKey(food.nameTh, food.nameEn, food.category),
      );
    return matchesTerm && matchesCategory && matchesStatus && matchesFavorite;
  });

  const groups = foodGroups(visible).sort((a, b) => {
    const firstA = a[0]!;
    const firstB = b[0]!;
    if (params.sort === "name") {
      const labelA =
        (params.language === "th"
          ? firstA.nameTh || firstA.nameEn
          : firstA.nameEn || firstA.nameTh) || "";
      const labelB =
        (params.language === "th"
          ? firstB.nameTh || firstB.nameEn
          : firstB.nameEn || firstB.nameTh) || "";
      return labelA.localeCompare(labelB, params.language);
    }
    if (params.sort === "fresh") {
      return (firstB.expiry || "0000-00-00").localeCompare(
        firstA.expiry || "0000-00-00",
      );
    }
    return (firstA.expiry || "9999-99-99").localeCompare(
      firstB.expiry || "9999-99-99",
    );
  });

  return { visible, groups };
}

interface FavoriteShelfEntry {
  key: string;
  food: Food | null;
  favorite: Favorite | null;
  count: number;
  inStock: boolean;
  status: FoodStatus;
}

export interface FavoriteShelfGroup {
  category: string;
  categoryStarred: boolean;
  entries: FavoriteShelfEntry[];
}

export function buildFavoriteShelves(
  items: readonly Food[],
  favorites: { items: Favorite[]; categories: string[] } | undefined,
  nowS: number,
): FavoriteShelfGroup[] {
  if (!favorites) return [];
  const favCategories = new Set(favorites.categories);
  const favByKey = new Map<string, Favorite>();
  for (const fav of favorites.items) {
    favByKey.set(foodIdentityKey(fav.name_th, fav.name_en, fav.category), fav);
  }

  const byCategory = new Map<string, Map<string, FavoriteShelfEntry>>();
  const ensureCat = (cat: string) => {
    const key = cat || "Other";
    let bucket = byCategory.get(key);
    if (!bucket) {
      bucket = new Map();
      byCategory.set(key, bucket);
    }
    return bucket;
  };

  for (const group of foodGroups([...items])) {
    const head = group[0]!;
    const idKey = foodIdentityKey(head.nameTh, head.nameEn, head.category);
    const fav = favByKey.get(idKey) ?? null;
    if (!fav && !favCategories.has(head.category)) continue;
    const bucket = ensureCat(head.category);
    const existing = bucket.get(idKey);
    const st = foodStatus(head, nowS);
    if (!existing) {
      bucket.set(idKey, {
        key: idKey,
        food: head,
        favorite: fav,
        count: group.length,
        inStock: true,
        status: st,
      });
    } else {
      existing.count += group.length;
    }
  }

  for (const fav of favorites.items) {
    const idKey = foodIdentityKey(fav.name_th, fav.name_en, fav.category);
    const bucket = ensureCat(fav.category);
    if (!bucket.has(idKey)) {
      bucket.set(idKey, {
        key: idKey,
        food: null,
        favorite: fav,
        count: 0,
        inStock: false,
        status: "unknown",
      });
    }
  }

  return [...byCategory.entries()].map(([category, bucket]) => ({
    category,
    categoryStarred: favCategories.has(category),
    entries: [...bucket.values()],
  }));
}

export function deriveTelemetryAlerts(
  latest: Sample | null,
): Array<"warm" | "spoil"> {
  if (!latest) return [];
  const alerts: Array<"warm" | "spoil"> = [];
  if (latest.temperature !== null && latest.temperature > TEMP_DANGER_C) {
    alerts.push("warm");
  }
  if (latest.voc !== null && latest.voc > VOC_DANGER) {
    alerts.push("spoil");
  }
  return alerts;
}

export interface KpiTileSummary {
  id: "temperature" | "voc" | "light" | "door";
  tone: KpiTone;
  reading: string;
  unit: string;
  verdict: string;
  alert: boolean;
}

export function deriveKpiSummary(
  latest: Sample | null,
  doorEvents: readonly DoorEvent[],
  nowS: number,
  language: Language,
): KpiTileSummary[] {
  const th = language === "th";
  const temp = latest?.temperature ?? null;
  const voc = latest?.voc ?? null;
  const light = latest?.light ?? null;
  const latestDoor = doorEvents[0] ?? null;

  const tempAlert = temp !== null && temp > TEMP_DANGER_C;
  const vocAlert = voc !== null && voc > VOC_DANGER;
  const lightOpen = light !== null && light > LIGHT_OPEN_LDR;
  const doorProblem =
    latestDoor !== null &&
    latestDoor.status !== "SUCCESS" &&
    latestDoor.status !== "CLOSING";

  const doorAgeMin = latestDoor
    ? Math.max(0, Math.round((nowS - latestDoor.timestampS) / 60))
    : null;
  const doorAgeLabel =
    doorAgeMin === null
      ? ""
      : doorAgeMin < 60
        ? th
          ? `${doorAgeMin} นาที`
          : `${doorAgeMin}m ago`
        : doorAgeMin < 1440
          ? th
            ? `${Math.round(doorAgeMin / 60)} ชม.`
            : `${Math.round(doorAgeMin / 60)}h ago`
          : th
            ? `${Math.round(doorAgeMin / 1440)} วัน`
            : `${Math.round(doorAgeMin / 1440)}d ago`;

  return [
    {
      id: "temperature",
      tone: temp === null ? "idle" : tempAlert ? "bad" : "dark",
      reading: temp === null ? "—" : temp.toFixed(1),
      unit: "°C",
      verdict:
        temp === null
          ? th
            ? "รอข้อมูล"
            : "Waiting"
          : tempAlert
            ? th
              ? "ร้อนเกินไป"
              : "Too warm"
            : th
              ? "เย็นพอดี"
              : "Cold enough",
      alert: tempAlert,
    },
    {
      id: "voc",
      tone: voc === null ? "idle" : vocAlert ? "bad" : "limey",
      reading: voc === null ? "—" : String(Math.round(voc)),
      unit: "VOC",
      verdict:
        voc === null
          ? th
            ? "รอข้อมูล"
            : "Waiting"
          : vocAlert
            ? th
              ? "กลิ่นผิดปกติ"
              : "Possible spoilage"
            : th
              ? "อากาศปกติ"
              : "Smells fine",
      alert: vocAlert,
    },
    {
      id: "light",
      tone: light === null ? "idle" : "soft",
      reading: light === null ? "—" : String(Math.round(light)),
      unit: "LDR",
      verdict:
        light === null
          ? th
            ? "รอข้อมูล"
            : "Waiting"
          : lightOpen
            ? th
              ? "เปิดประตูอยู่"
              : "Door open"
            : th
              ? "ปิดสนิท"
              : "Dark inside",
      alert: false,
    },
    {
      id: "door",
      tone: doorProblem ? "bad" : latestDoor || light !== null ? "mint" : "idle",
      reading: doorProblem
        ? th
          ? "ติดขัด"
          : "Alert"
        : latestDoor?.status === "CLOSING"
          ? th
            ? "กำลังปิด"
            : "Closing"
          : lightOpen
            ? th
              ? "แง้มอยู่"
              : "Ajar"
            : th
              ? "ปิดสนิท"
              : "Shut",
      unit: doorAgeLabel,
      verdict: doorProblem
        ? th
          ? "ตรวจสิ่งกีดขวาง"
          : "Check door arm"
        : latestDoor?.status === "SUCCESS"
          ? th
            ? "ปิดอัตโนมัติแล้ว"
            : "Auto-closed"
          : th
            ? "พร้อมทำงาน"
            : "Ready",
      alert: doorProblem,
    },
  ];
}

/**
 * Piecewise chart Y coordinate pinning each series threshold `limit` at 70% height
 * (bottom 70% = normal zone, top 30% = danger band above threshold).
 */
export function piecewiseNormalizedY(
  value: number,
  limit: number,
  max: number,
  top: number,
  bottom: number,
): number {
  const safeTop = Number.isFinite(top) ? top : 0;
  const safeBottom = Number.isFinite(bottom) && bottom > safeTop ? bottom : safeTop + 100;
  const ih = safeBottom - safeTop;
  const yl = safeBottom - 0.7 * ih;
  if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(limit) || limit <= 0) {
    return safeBottom;
  }
  if (value <= limit) {
    return safeBottom - (value / limit) * 0.7 * ih;
  }
  const safeMax = Number.isFinite(max) && max > limit ? max : limit * 1.5;
  const clampedRatio = Math.min(1, (value - limit) / (safeMax - limit));
  return yl - clampedRatio * 0.3 * ih;
}

export function toggleSeriesSafely(
  enabled: readonly SeriesKey[],
  key: SeriesKey,
): SeriesKey[] {
  if (enabled.includes(key)) {
    if (enabled.length <= 1) return [...enabled];
    return enabled.filter((entry) => entry !== key);
  }
  return [...enabled, key];
}

export function clampScrubberIndex(
  index: number | null,
  length: number,
): number | null {
  if (length <= 0) return null;
  if (index === null || !Number.isFinite(index)) return length - 1;
  return Math.max(0, Math.min(length - 1, Math.trunc(index)));
}

export interface SeriesSummaryStats {
  key: SeriesKey;
  count: number;
  avg: number | null;
  max: number | null;
  aboveLimitCount: number;
}

export function computeSeriesStats(
  points: readonly Sample[],
  key: SeriesKey,
  limit: number,
): SeriesSummaryStats {
  let sum = 0;
  let count = 0;
  let maxVal: number | null = null;
  let aboveLimitCount = 0;
  for (const point of points) {
    const v = point[key];
    if (v === null || !Number.isFinite(v)) continue;
    sum += v;
    count++;
    if (maxVal === null || v > maxVal) maxVal = v;
    if (v > limit) aboveLimitCount++;
  }
  return {
    key,
    count,
    avg: count > 0 ? sum / count : null,
    max: maxVal,
    aboveLimitCount,
  };
}

export interface DailyDoorBucket {
  dateIso: string;
  labelEn: string;
  labelTh: string;
  count: number;
  isToday: boolean;
}

const WEEKDAY_FMT_EN = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  timeZone: "UTC",
});
const WEEKDAY_FMT_TH = new Intl.DateTimeFormat("th-TH", {
  weekday: "short",
  timeZone: "UTC",
});

export function computeDailyDoorCounts(
  doorEvents: readonly DoorEvent[],
  nowS: number,
  days = 7,
): DailyDoorBucket[] {
  const safeDays = Math.max(1, Math.min(30, Math.trunc(days)));
  const todayIso = bangkokDateIso(nowS);
  const todayMs = Date.parse(`${todayIso}T00:00:00Z`);
  const counts = new Map<string, number>();

  for (let offset = safeDays - 1; offset >= 0; offset--) {
    const iso = new Date(todayMs - offset * 86_400_000)
      .toISOString()
      .slice(0, 10);
    counts.set(iso, 0);
  }
  for (const event of doorEvents) {
    const iso = bangkokDateIso(event.timestampS);
    const prev = counts.get(iso);
    if (prev !== undefined) counts.set(iso, prev + 1);
  }

  return [...counts.entries()].map(([dateIso, count]) => {
    const d = new Date(`${dateIso}T00:00:00Z`);
    return {
      dateIso,
      labelEn: WEEKDAY_FMT_EN.format(d),
      labelTh: WEEKDAY_FMT_TH.format(d),
      count,
      isToday: dateIso === todayIso,
    };
  });
}

function contactStateToTier(state: ContactState): DeviceHealthTier {
  if (state === "recent") return "ok";
  if (state === "stale") return "late";
  if (state === "waiting") return "unknown";
  return "off";
}

export interface DeviceHealthSummary {
  nodes: Array<{
    node: StatusNode;
    state: ContactState;
    tier: DeviceHealthTier;
  }>;
  allOk: boolean;
  healthyCount: number;
  degradedNodeIds: string[];
  firstDegradedId: string | null;
}

export function summarizeDeviceHealth(
  heartbeat: Heartbeat | null,
  nowS: number,
): DeviceHealthSummary {
  const nodes = statusTree(heartbeat).map((node) => {
    const state = contactState(node, heartbeat, nowS);
    return {
      node,
      state,
      tier: contactStateToTier(state),
    };
  });
  const healthyCount = nodes.filter((entry) => entry.tier === "ok").length;
  const degradedNodeIds = nodes
    .filter((entry) => entry.tier === "late" || entry.tier === "off")
    .map((entry) => entry.node.id);
  return {
    nodes,
    allOk: heartbeat !== null && healthyCount === nodes.length,
    healthyCount,
    degradedNodeIds,
    firstDegradedId: degradedNodeIds[0] ?? null,
  };
}

export function deviceHelpTip(
  nodeId: string,
  state: ContactState,
  language: Language,
): string | null {
  if (state === "recent" || state === "waiting") return null;
  const th = language === "th";
  if (state === "gatewayMissing") {
    return th
      ? "กล้องเกตเวย์ (C0) ยังไม่ส่งรายงานล่าสุด ตรวจสอบปลั๊กไฟและ Wi-Fi ของเกตเวย์"
      : "Gateway C0 has stopped checking in. Check the Pi-top power cable and Wi-Fi connection.";
  }
  if (nodeId.startsWith("C")) {
    return th
      ? "รีสตาร์ท Raspberry Pi Gateway หรือตรวจสอบ Gateway Token ในหน้าตั้งค่า"
      : "Check Gateway Wi-Fi and verify the Gateway Bearer Token in Settings.";
  }
  if (nodeId.startsWith("F")) {
    return th
      ? "เซนเซอร์ในตู้เย็น (F0) ส่งข้อมูลผ่าน Bluetooth ทุก 5 นาที หากหายนานให้ตรวจแบตเตอรี่ภายในตู้"
      : "Fridge sensor F0 sleeps ~5 min between BLE updates. Check battery charge if missing over 10 min.";
  }
  return th
    ? "ตัวปิดประตู (D0) ใช้ไฟบ้าน 12V และ Wi-Fi MQTT ตรวจปลั๊กไฟและระยะแขนกลปิดประตู"
    : "Door closer D0 requires 12V power and local Wi-Fi MQTT. Check power adapter and arm alignment.";
}

export interface SetupProgressSummary {
  completed: number;
  total: number;
  percent: number;
  steps: {
    fridgeCreated: boolean;
    lineLinked: boolean;
    hasDevices: boolean;
    hasFamilyOrKey: boolean;
  };
}

/**
 * Endowed Progress (Psychology Ch. 19): Step 1 (fridgeCreated) starts pre-filled
 * so owners always begin partway into setup rather than staring at 0%.
 */
export function computeSetupProgress(input: {
  lineLinked: boolean;
  hasDevices: boolean;
  memberCount: number;
  hasGeminiKey: boolean;
}): SetupProgressSummary {
  const steps = {
    fridgeCreated: true,
    lineLinked: input.lineLinked,
    hasDevices: input.hasDevices,
    hasFamilyOrKey: input.memberCount > 1 || input.hasGeminiKey,
  };
  const completed =
    1 +
    (steps.lineLinked ? 1 : 0) +
    (steps.hasDevices ? 1 : 0) +
    (steps.hasFamilyOrKey ? 1 : 0);
  return {
    completed,
    total: 4,
    percent: Math.round((completed / 4) * 100),
    steps,
  };
}

export type AppRoute =
  | "login"
  | "hub"
  | "food"
  | "charts"
  | "devices"
  | "me"
  | "settings";

export interface DashboardMachineState {
  nowS: number;
  signedIn: boolean;
  route: AppRoute;
  colorTheme: ColorTheme;
  language: Language;
  fridges: Fridge[];
  activeFridgeId: string | null;
  room: {
    inventory: Food[];
    history: Sample[];
    latest: Sample | null;
    heartbeat: Heartbeat | null;
    doorEvents: DoorEvent[];
    connectionState: "connecting" | "live" | "reconnecting" | "closed";
    loadError: boolean;
  };
  inventoryUi: {
    search: string;
    category: string;
    filter: InventoryFilter;
    sort: InventorySort;
    favoritesOnly: boolean;
    favoriteCategories: string[];
    favoriteFoodKeys: string[];
    selecting: boolean;
    selectedIds: string[];
    bulkFailedIds: string[];
    undoItem: Food | null;
    undoExpiresAtS: number | null;
  };
  chartsUi: {
    range: ChartRange;
    activeNode: string;
    enabledSeries: SeriesKey[];
    scrubberIndex: number | null;
    selectedDoor: DoorEvent | null;
  };
  devicesUi: {
    expandedNodeId: string | null;
  };
  editingDraft: {
    itemId: string | null;
    dirtyNameEn: string;
  };
}

export type DashboardEvent =
  | { type: "SIGN_IN"; fridges: Fridge[] }
  | { type: "SIGN_OUT" }
  | { type: "NAVIGATE"; route: AppRoute; fridgeId?: string }
  | { type: "SET_THEME"; colorTheme: ColorTheme }
  | { type: "SET_LANGUAGE"; language: Language }
  | { type: "SET_FRIDGES"; fridges: Fridge[] }
  | { type: "WS_CONNECTED" }
  | { type: "WS_DISCONNECTED" }
  | { type: "WS_EVENT"; event: FridgeRoomEvent }
  | { type: "LOAD_ERROR" }
  | { type: "RETRY_LOAD" }
  | { type: "SET_SEARCH"; search: string }
  | { type: "SET_CATEGORY"; category: string }
  | { type: "SET_FILTER"; filter: InventoryFilter }
  | { type: "SET_SORT"; sort: InventorySort }
  | { type: "TOGGLE_FAVORITES_ONLY" }
  | { type: "RESET_FILTERS" }
  | { type: "TOGGLE_SELECTING"; enabled?: boolean }
  | { type: "TOGGLE_SELECT_GROUP"; itemIds: string[] }
  | { type: "SELECT_ALL_VISIBLE"; itemIds: string[] }
  | { type: "BULK_MUTATION_RESULT"; succeededIds: string[]; failedIds: string[] }
  | { type: "ADD_FOOD_ITEM"; item: Food }
  | { type: "TAKE_OUT_ITEM"; itemId: string }
  | { type: "UNDO_TAKE_OUT" }
  | { type: "TICK_CLOCK"; deltaS: number }
  | { type: "SET_CHART_RANGE"; range: ChartRange }
  | { type: "SET_CHART_NODE"; nodeId: string }
  | { type: "TOGGLE_CHART_SERIES"; series: SeriesKey }
  | { type: "SET_SCRUBBER"; index: number | null }
  | { type: "SELECT_DOOR_EVENT"; door: DoorEvent | null }
  | { type: "EXPAND_DEVICE"; nodeId: string | null }
  | { type: "SWITCH_EDIT_ITEM"; itemId: string | null }
  | { type: "UPDATE_EDIT_DRAFT"; nameEn: string };

export function initialDashboardState(nowS: number): DashboardMachineState {
  return {
    nowS,
    signedIn: false,
    route: "login",
    colorTheme: "green",
    language: "th",
    fridges: [],
    activeFridgeId: null,
    room: {
      inventory: [],
      history: [],
      latest: null,
      heartbeat: null,
      doorEvents: [],
      connectionState: "connecting",
      loadError: false,
    },
    inventoryUi: {
      search: "",
      category: "",
      filter: "all",
      sort: "expiry",
      favoritesOnly: false,
      favoriteCategories: [],
      favoriteFoodKeys: [],
      selecting: false,
      selectedIds: [],
      bulkFailedIds: [],
      undoItem: null,
      undoExpiresAtS: null,
    },
    chartsUi: {
      range: "24h",
      activeNode: "F0",
      enabledSeries: ["temperature", "voc", "light"],
      scrubberIndex: null,
      selectedDoor: null,
    },
    devicesUi: {
      expandedNodeId: null,
    },
    editingDraft: {
      itemId: null,
      dirtyNameEn: "",
    },
  };
}

function activeChartNodePoints(state: DashboardMachineState): Sample[] {
  const nodes = [...new Set(state.room.history.map((s) => s.nodeId))].sort();
  const nodeId = nodes.includes(state.chartsUi.activeNode)
    ? state.chartsUi.activeNode
    : (nodes[0] ?? state.chartsUi.activeNode);
  return state.room.history.filter((s) => s.nodeId === nodeId);
}

export function reduceDashboardEvent(
  state: DashboardMachineState,
  event: DashboardEvent,
): DashboardMachineState {
  switch (event.type) {
    case "SIGN_IN": {
      const firstId = event.fridges[0]?.id ?? null;
      return {
        ...state,
        signedIn: true,
        fridges: event.fridges,
        activeFridgeId: firstId,
        route: "hub",
      };
    }
    case "SIGN_OUT":
      return {
        ...initialDashboardState(state.nowS),
        colorTheme: state.colorTheme,
        language: state.language,
      };
    case "NAVIGATE": {
      const targetId = event.fridgeId ?? state.activeFridgeId;
      const health = summarizeDeviceHealth(state.room.heartbeat, state.nowS);
      return {
        ...state,
        route: state.signedIn ? event.route : "login",
        activeFridgeId: targetId,
        devicesUi:
          event.route === "devices"
            ? { expandedNodeId: health.firstDegradedId }
            : state.devicesUi,
      };
    }
    case "SET_THEME":
      return { ...state, colorTheme: event.colorTheme };
    case "SET_LANGUAGE":
      return { ...state, language: event.language };
    case "SET_FRIDGES": {
      const stillHasActive =
        state.activeFridgeId !== null &&
        event.fridges.some((f) => f.id === state.activeFridgeId);
      return {
        ...state,
        fridges: event.fridges,
        activeFridgeId: stillHasActive ? state.activeFridgeId : null,
        route:
          !stillHasActive &&
          state.route !== "login" &&
          state.route !== "me" &&
          state.route !== "hub"
            ? "hub"
            : state.route,
      };
    }
    case "WS_CONNECTED":
      return {
        ...state,
        room: { ...state.room, connectionState: "live", loadError: false },
      };
    case "WS_DISCONNECTED":
      return {
        ...state,
        room: { ...state.room, connectionState: "reconnecting" },
      };
    case "LOAD_ERROR":
      return {
        ...state,
        room: { ...state.room, loadError: true },
      };
    case "RETRY_LOAD":
      return {
        ...state,
        room: {
          ...state.room,
          loadError: false,
          connectionState:
            state.room.connectionState === "closed"
              ? "connecting"
              : state.room.connectionState,
        },
      };
    case "WS_EVENT": {
      const ev = event.event;
      if (ev.type === "telemetry") {
        const merged = mergeTelemetrySamples(
          state.room.history,
          ev.samples,
          state.nowS,
        );
        const latest = merged.reduce<Sample | null>(
          (best, s) => (!best || s.timeS > best.timeS ? s : best),
          state.room.latest,
        );
        const nextState: DashboardMachineState = {
          ...state,
          room: { ...state.room, history: merged, latest },
        };
        const len = activeChartNodePoints(nextState).length;
        return {
          ...nextState,
          chartsUi: {
            ...nextState.chartsUi,
            scrubberIndex: clampScrubberIndex(
              nextState.chartsUi.scrubberIndex,
              len,
            ),
          },
        };
      }
      if (ev.type === "status") {
        const prev = state.room.heartbeat;
        const nextHeartbeat =
          prev && prev.gatewaySeenS >= ev.status.gatewaySeenS ? prev : ev.status;
        return {
          ...state,
          room: { ...state.room, heartbeat: nextHeartbeat },
        };
      }
      if (ev.type === "door_events") {
        return {
          ...state,
          room: {
            ...state.room,
            doorEvents: mergeDoorEvents(state.room.doorEvents, ev.events),
          },
        };
      }
      if (ev.type === "member_revoked" || ev.type === "fridge_deleted") {
        const remainingFridges =
          ev.type === "fridge_deleted" && state.activeFridgeId
            ? state.fridges.filter((f) => f.id !== state.activeFridgeId)
            : state.fridges;
        return {
          ...state,
          fridges: remainingFridges,
          activeFridgeId: null,
          route: state.signedIn ? "hub" : "login",
          room: { ...state.room, connectionState: "closed" },
        };
      }
      return state;
    }
    case "SET_SEARCH":
      return {
        ...state,
        inventoryUi: { ...state.inventoryUi, search: event.search },
      };
    case "SET_CATEGORY":
      return {
        ...state,
        inventoryUi: { ...state.inventoryUi, category: event.category },
      };
    case "SET_FILTER":
      return {
        ...state,
        inventoryUi: { ...state.inventoryUi, filter: event.filter },
      };
    case "SET_SORT":
      return {
        ...state,
        inventoryUi: { ...state.inventoryUi, sort: event.sort },
      };
    case "TOGGLE_FAVORITES_ONLY":
      return {
        ...state,
        inventoryUi: {
          ...state.inventoryUi,
          favoritesOnly: !state.inventoryUi.favoritesOnly,
        },
      };
    case "RESET_FILTERS":
      return {
        ...state,
        inventoryUi: {
          ...state.inventoryUi,
          search: "",
          category: "",
          filter: "all",
          favoritesOnly: false,
        },
      };
    case "TOGGLE_SELECTING": {
      const nextSelecting =
        event.enabled ?? !state.inventoryUi.selecting;
      return {
        ...state,
        inventoryUi: {
          ...state.inventoryUi,
          selecting: nextSelecting,
          selectedIds: nextSelecting ? state.inventoryUi.selectedIds : [],
          bulkFailedIds: nextSelecting ? state.inventoryUi.bulkFailedIds : [],
        },
      };
    }
    case "TOGGLE_SELECT_GROUP": {
      const set = new Set(state.inventoryUi.selectedIds);
      const allSelected = event.itemIds.every((id) => set.has(id));
      for (const id of event.itemIds) {
        if (allSelected) set.delete(id);
        else set.add(id);
      }
      return {
        ...state,
        inventoryUi: { ...state.inventoryUi, selectedIds: [...set] },
      };
    }
    case "SELECT_ALL_VISIBLE":
      return {
        ...state,
        inventoryUi: {
          ...state.inventoryUi,
          selecting: true,
          selectedIds: [...new Set(event.itemIds)],
        },
      };
    case "BULK_MUTATION_RESULT": {
      const succeeded = new Set(event.succeededIds);
      const validIds = new Set(state.room.inventory.map((i) => i.id));
      const remaining = state.inventoryUi.selectedIds.filter(
        (id) => !succeeded.has(id) && validIds.has(id),
      );
      return {
        ...state,
        inventoryUi: {
          ...state.inventoryUi,
          selectedIds: remaining,
          bulkFailedIds: event.failedIds.filter((id) => validIds.has(id)),
        },
      };
    }
    case "ADD_FOOD_ITEM": {
      const exists = state.room.inventory.some((i) => i.id === event.item.id);
      if (exists) return state;
      return {
        ...state,
        room: {
          ...state.room,
          inventory: [...state.room.inventory, event.item],
        },
      };
    }
    case "TAKE_OUT_ITEM": {
      const target =
        state.room.inventory.find((i) => i.id === event.itemId) ?? null;
      if (!target) return state;
      const nextInventory = state.room.inventory.filter(
        (i) => i.id !== event.itemId,
      );
      const nextSelected = state.inventoryUi.selectedIds.filter(
        (id) => id !== event.itemId,
      );
      return {
        ...state,
        room: { ...state.room, inventory: nextInventory },
        inventoryUi: {
          ...state.inventoryUi,
          selectedIds: nextSelected,
          undoItem: target,
          undoExpiresAtS: state.nowS + 6,
        },
      };
    }
    case "UNDO_TAKE_OUT": {
      const undo = state.inventoryUi.undoItem;
      const expires = state.inventoryUi.undoExpiresAtS;
      if (!undo || expires === null || state.nowS > expires) {
        return {
          ...state,
          inventoryUi: {
            ...state.inventoryUi,
            undoItem: null,
            undoExpiresAtS: null,
          },
        };
      }
      const alreadyThere = state.room.inventory.some((i) => i.id === undo.id);
      return {
        ...state,
        room: {
          ...state.room,
          inventory: alreadyThere
            ? state.room.inventory
            : [...state.room.inventory, undo],
        },
        inventoryUi: {
          ...state.inventoryUi,
          undoItem: null,
          undoExpiresAtS: null,
        },
      };
    }
    case "TICK_CLOCK": {
      const nextNow = state.nowS + Math.max(0, Math.trunc(event.deltaS));
      const undoExpired =
        state.inventoryUi.undoExpiresAtS !== null &&
        nextNow > state.inventoryUi.undoExpiresAtS;
      const prunedHistory = mergeTelemetrySamples(state.room.history, [], nextNow);
      const nextState: DashboardMachineState = {
        ...state,
        nowS: nextNow,
        room: { ...state.room, history: prunedHistory },
        inventoryUi: undoExpired
          ? { ...state.inventoryUi, undoItem: null, undoExpiresAtS: null }
          : state.inventoryUi,
      };
      const len = activeChartNodePoints(nextState).length;
      return {
        ...nextState,
        chartsUi: {
          ...nextState.chartsUi,
          scrubberIndex: clampScrubberIndex(nextState.chartsUi.scrubberIndex, len),
        },
      };
    }
    case "SET_CHART_RANGE":
      return {
        ...state,
        chartsUi: {
          ...state.chartsUi,
          range: event.range,
          scrubberIndex: null,
          selectedDoor: null,
        },
      };
    case "SET_CHART_NODE":
      return {
        ...state,
        chartsUi: {
          ...state.chartsUi,
          activeNode: event.nodeId,
          scrubberIndex: null,
        },
      };
    case "TOGGLE_CHART_SERIES":
      return {
        ...state,
        chartsUi: {
          ...state.chartsUi,
          enabledSeries: toggleSeriesSafely(
            state.chartsUi.enabledSeries,
            event.series,
          ),
        },
      };
    case "SET_SCRUBBER": {
      const len = activeChartNodePoints(state).length;
      return {
        ...state,
        chartsUi: {
          ...state.chartsUi,
          scrubberIndex: clampScrubberIndex(event.index, len),
        },
      };
    }
    case "SELECT_DOOR_EVENT":
      return {
        ...state,
        chartsUi: { ...state.chartsUi, selectedDoor: event.door },
      };
    case "EXPAND_DEVICE":
      return {
        ...state,
        devicesUi: { expandedNodeId: event.nodeId },
      };
    case "SWITCH_EDIT_ITEM":
      return {
        ...state,
        editingDraft: { itemId: event.itemId, dirtyNameEn: "" },
      };
    case "UPDATE_EDIT_DRAFT":
      return {
        ...state,
        editingDraft: { ...state.editingDraft, dirtyNameEn: event.nameEn },
      };
  }
}

export interface RecoveryAction {
  id:
    | "retry_load"
    | "reconnect_ws"
    | "clear_filters"
    | "add_food"
    | "retry_bulk"
    | "inspect_devices"
    | "back_to_hub";
  labelEn: string;
  labelTh: string;
}

/**
 * First Failure Test selector (Product Design Psychology Ch. 30):
 * Every error, disconnect, empty-filter, or degraded state must offer at least one
 * concrete next action so users never experience a dead end.
 */
export function deriveRecoveryActions(
  state: DashboardMachineState,
): RecoveryAction[] {
  const actions: RecoveryAction[] = [];

  if (state.room.loadError) {
    actions.push({
      id: "retry_load",
      labelEn: "Retry loading",
      labelTh: "ลองโหลดใหม่",
    });
  }
  if (
    state.signedIn &&
    state.activeFridgeId &&
    (state.room.connectionState === "reconnecting" ||
      state.room.connectionState === "closed")
  ) {
    actions.push({
      id: "reconnect_ws",
      labelEn: "Refresh live connection",
      labelTh: "เชื่อมต่อใหม่",
    });
  }
  if (state.signedIn && !state.activeFridgeId && state.route !== "hub") {
    actions.push({
      id: "back_to_hub",
      labelEn: "Back to my fridges",
      labelTh: "กลับไปหน้าตู้เย็นทั้งหมด",
    });
  }

  const filtered = filterAndSortInventory(state.room.inventory, {
    search: state.inventoryUi.search,
    category: state.inventoryUi.category,
    filter: state.inventoryUi.filter,
    sort: state.inventoryUi.sort,
    favoritesOnly: state.inventoryUi.favoritesOnly,
    favoriteCategories: new Set(state.inventoryUi.favoriteCategories),
    favoriteFoodKeys: new Set(state.inventoryUi.favoriteFoodKeys),
    nowS: state.nowS,
    language: state.language,
  });
  const hasFilters =
    Boolean(state.inventoryUi.search.trim()) ||
    Boolean(state.inventoryUi.category) ||
    state.inventoryUi.filter !== "all" ||
    state.inventoryUi.favoritesOnly;

  if (filtered.visible.length === 0) {
    if (state.room.inventory.length > 0 && hasFilters) {
      actions.push({
        id: "clear_filters",
        labelEn: "Reset filters",
        labelTh: "ล้างตัวกรอง",
      });
    } else if (state.room.inventory.length === 0) {
      actions.push({
        id: "add_food",
        labelEn: "Add food",
        labelTh: "เพิ่มอาหาร",
      });
    }
  }

  if (state.inventoryUi.bulkFailedIds.length > 0) {
    actions.push({
      id: "retry_bulk",
      labelEn: "Retry remaining items",
      labelTh: "ลองรายการที่เหลืออีกครั้ง",
    });
  }

  const health = summarizeDeviceHealth(state.room.heartbeat, state.nowS);
  if (health.degradedNodeIds.length > 0) {
    actions.push({
      id: "inspect_devices",
      labelEn: "Check device status",
      labelTh: "ตรวจสอบอุปกรณ์",
    });
  }

  return actions;
}
