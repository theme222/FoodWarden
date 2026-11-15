export type Language = "th" | "en";
export type MemberRole = "owner" | "member";

type DoorEventStatus =
  | "CLOSING"
  | "SUCCESS"
  | "OBSTRUCTION_ERROR"
  | "ABORTED"
  | "TIMEOUT_ERROR"
  | "FAULT_LOCKOUT"
  | "CONTRADICTION_ERROR";

export interface Fridge {
  id: string;
  name: string;
  role: MemberRole;
  lastSeenS: number;
  latest: Sample | null;
}

export interface Sample {
  nodeId: string;
  timeS: number;
  temperature: number | null;
  voc: number | null;
  light: number | null;
}

export interface StatusNode {
  id: string;
  reported: boolean;
  reportedS: number | null;
  lastKnownS: number | null;
}

export interface Heartbeat {
  gatewaySeenS: number;
  receivedS: number;
  nodes: StatusNode[];
}

export interface DoorEvent {
  nodeId: string;
  timestampS: number;
  status: DoorEventStatus;
}

export interface Food {
  id: string;
  nameEn: string;
  nameTh: string;
  expiry: string;
  category: string;
  adviceEn: string;
  adviceTh: string;
  hasPhoto: boolean;
}

interface FridgeMember {
  email: string;
  role: MemberRole;
  addedAtS: number;
}

export interface FridgeSettings {
  id: string;
  name: string;
  lineTargetId: string | null;
  gatewayToken: string;
  hasGeminiApiKey: boolean;
  members: FridgeMember[];
}

export type FridgeRoomEvent =
  | { type: "line_settings_changed" }
  | { type: "connected"; fridgeId: string }
  | { type: "telemetry"; samples: Sample[]; lastSeenS: number }
  | { type: "status"; status: Heartbeat }
  | { type: "door_events"; events: DoorEvent[] }
  | {
      type: "inventory_changed";
      action: "created" | "updated" | "deleted";
      itemId: string;
    }
  | { type: "member_revoked"; email: string }
  | { type: "fridge_deleted" };

const DOOR_STATUSES = new Set<DoorEventStatus>([
  "CLOSING",
  "SUCCESS",
  "OBSTRUCTION_ERROR",
  "ABORTED",
  "TIMEOUT_ERROR",
  "FAULT_LOCKOUT",
  "CONTRADICTION_ERROR",
]);

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function epoch(value: unknown): number | null {
  const time = number(value);
  return time !== null &&
    Number.isSafeInteger(time) &&
    time >= 0 &&
    time <= 253402300799
    ? time
    : null;
}

export function readSample(value: unknown): Sample | null {
  const data = record(value);
  const timeS = epoch(data.timestamp_s);
  const nodeId = text(data.node_id);
  if (timeS === null || !nodeId) return null;
  const temperature = number(data.temp_celsius);
  const voc = number(data.voc_index);
  const light = number(data.light_ldr);
  return {
    nodeId,
    timeS,
    temperature:
      temperature !== null && temperature !== -32768 ? temperature : null,
    voc: voc !== null && voc >= 1 && voc <= 500 ? voc : null,
    light: light !== null && light >= 0 && light <= 4095 ? light : null,
  };
}

function readFridge(id: string, value: unknown): Fridge {
  const data = record(value);
  return {
    id,
    name: text(data.name).trim() || id,
    role: data.role === "owner" ? "owner" : "member",
    lastSeenS: epoch(data.last_seen_s) ?? 0,
    latest: readSample(data.last_telemetry),
  };
}

export function readFridgeList(value: unknown): Fridge[] {
  const fridges = record(value).fridges;
  if (!Array.isArray(fridges)) throw new Error("Invalid fridge list");
  return (fridges as unknown[]).flatMap((entry) => {
    const fridge = record(entry);
    return typeof fridge.id === "string" ? [readFridge(fridge.id, fridge)] : [];
  });
}

export function readBucket(value: unknown): Sample[] {
  const samples = record(value).samples;
  if (!Array.isArray(samples)) return [];
  return (samples as unknown[])
    .map(readSample)
    .filter((sample): sample is Sample => sample !== null);
}

function readHeartbeat(value: unknown): Heartbeat | null {
  const data = record(value);
  const receivedS = epoch(data.received_s);
  const gatewaySeenS = epoch(data.gateway_seen_s);
  if (
    receivedS === null ||
    gatewaySeenS === null ||
    !Array.isArray(data.nodes)
  ) {
    return null;
  }
  const nodes = (data.nodes as unknown[])
    .map((entry) => {
      const node = record(entry);
      return {
        id: text(node.node_id),
        reported: true,
        reportedS: epoch(node.last_seen_s),
        lastKnownS: epoch(node.last_known_seen_s),
      };
    })
    .filter((node) => node.id !== "");
  return { gatewaySeenS, receivedS, nodes };
}

export function readStatusResponse(value: unknown): Heartbeat | null {
  const status = record(value).status;
  if (status === null || status === undefined) return null;
  return readHeartbeat(status);
}

export function readFood(id: string, value: unknown): Food {
  const data = record(value);
  return {
    id,
    nameEn: text(data.name_en),
    nameTh: text(data.name_th),
    expiry: text(data.estimated_expiry_date),
    category: text(data.category),
    adviceEn: text(data.storage_recommendation_en),
    adviceTh: text(data.storage_recommendation_th),
    hasPhoto: text(data.image_storage_path) !== "",
  };
}

export function readInventoryList(value: unknown): Food[] {
  const items = record(value).items;
  if (!Array.isArray(items)) throw new Error("Invalid inventory response");
  return (items as unknown[]).flatMap((entry) => {
    const row = record(entry);
    const id = text(row.id);
    return id ? [readFood(id, row)] : [];
  });
}

function readDoorEvent(value: unknown): DoorEvent | null {
  const data = record(value);
  const nodeId = text(data.node_id);
  const timestampS = epoch(data.timestamp_s);
  const status = text(data.status) as DoorEventStatus;
  if (!nodeId || timestampS === null || !DOOR_STATUSES.has(status)) {
    return null;
  }
  return { nodeId, timestampS, status };
}

export function readDoorEventList(value: unknown): DoorEvent[] {
  const events = record(value).events;
  if (!Array.isArray(events)) return [];
  return (events as unknown[])
    .map(readDoorEvent)
    .filter((event): event is DoorEvent => event !== null);
}

export function readFridgeSettings(value: unknown): FridgeSettings {
  const data = record(value);
  const id = text(data.id);
  const name = text(data.name);
  const gatewayToken = text(data.gateway_token);
  if (!id || !name || !gatewayToken || !Array.isArray(data.members)) {
    throw new Error("Invalid fridge settings");
  }
  const members: FridgeMember[] = (data.members as unknown[]).flatMap(
    (entry) => {
      const m = record(entry);
      const email = text(m.email);
      if (!email) return [];
      return [
        {
          email,
          role: m.role === "owner" ? "owner" : "member",
          addedAtS: epoch(m.added_at_s) ?? 0,
        },
      ];
    },
  );
  return {
    id,
    name,
    lineTargetId:
      typeof data.line_target_id === "string" && data.line_target_id.trim()
        ? data.line_target_id
        : null,
    gatewayToken,
    hasGeminiApiKey: data.has_gemini_api_key === true,
    members,
  };
}

export function mergeTelemetrySamples(
  existing: Sample[],
  incoming: Sample[],
  nowS: number,
): Sample[] {
  const minTimeS = Math.max(0, nowS - 3600);
  const deduped = new Map<string, Sample>();
  for (const sample of existing) {
    if (sample.timeS >= minTimeS) {
      deduped.set(`${sample.nodeId}\0${sample.timeS}`, sample);
    }
  }
  for (const sample of incoming) {
    if (sample.timeS >= minTimeS) {
      deduped.set(`${sample.nodeId}\0${sample.timeS}`, sample);
    }
  }
  return [...deduped.values()]
    .sort((a, b) => a.timeS - b.timeS || a.nodeId.localeCompare(b.nodeId))
    .slice(-2000);
}

export function mergeDoorEvents(
  existing: DoorEvent[],
  incoming: DoorEvent[],
): DoorEvent[] {
  const deduped = new Map<string, DoorEvent>();
  for (const event of [...incoming, ...existing]) {
    const key = `${event.nodeId}\0${event.timestampS}\0${event.status}`;
    if (!deduped.has(key)) deduped.set(key, event);
  }
  return [...deduped.values()]
    .sort(
      (a, b) => b.timestampS - a.timestampS || a.nodeId.localeCompare(b.nodeId),
    )
    .slice(0, 50);
}

export function parseFridgeRoomEvent(raw: string): FridgeRoomEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const data = record(parsed);
  switch (data.type) {
    case "line_settings_changed":
      return { type: "line_settings_changed" };
    case "connected": {
      const fridgeId = text(data.fridgeId);
      return fridgeId ? { type: "connected", fridgeId } : null;
    }
    case "telemetry": {
      const samples = Array.isArray(data.samples)
        ? (data.samples as unknown[])
            .map(readSample)
            .filter((s): s is Sample => s !== null)
        : [];
      const lastSeenS = epoch(data.last_seen_s) ?? 0;
      return { type: "telemetry", samples, lastSeenS };
    }
    case "status": {
      const status = readHeartbeat(data.status);
      return status ? { type: "status", status } : null;
    }
    case "door_events": {
      const events = Array.isArray(data.events)
        ? (data.events as unknown[])
            .map(readDoorEvent)
            .filter((e): e is DoorEvent => e !== null)
        : [];
      return { type: "door_events", events };
    }
    case "inventory_changed": {
      const action = data.action;
      const itemId = text(data.itemId);
      if (
        (action === "created" ||
          action === "updated" ||
          action === "deleted") &&
        itemId
      ) {
        return { type: "inventory_changed", action, itemId };
      }
      return null;
    }
    case "member_revoked": {
      const email = text(data.email);
      return email ? { type: "member_revoked", email } : null;
    }
    case "fridge_deleted":
      return { type: "fridge_deleted" };
    default:
      return null;
  }
}

function normalizeFoodName(name: string): string {
  return name.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

export function foodGroups(items: Food[]): Food[][] {
  const thaiAliases = new Map<string, Set<string>>();
  for (const item of items) {
    const nameEn = normalizeFoodName(item.nameEn);
    const nameTh = normalizeFoodName(item.nameTh);
    if (!nameTh || !nameEn || nameTh === nameEn) continue;
    const key = JSON.stringify([nameTh, item.expiry]);
    const matches = thaiAliases.get(key) ?? new Set<string>();
    matches.add(nameEn);
    thaiAliases.set(key, matches);
  }

  const groups = new Map<string, Food[]>();
  for (const item of items) {
    const englishName = normalizeFoodName(item.nameEn);
    const thaiName = normalizeFoodName(item.nameTh);
    const aliases = thaiAliases.get(JSON.stringify([thaiName, item.expiry]));
    const matchedName =
      (!englishName || englishName === thaiName) && aliases?.size === 1
        ? aliases.values().next().value
        : undefined;
    const name = matchedName ?? (englishName || thaiName);
    const key = JSON.stringify([name || item.id, item.expiry]);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return [...groups.values()].sort((a, b) =>
    (a[0]?.expiry || "9999-99-99").localeCompare(b[0]?.expiry || "9999-99-99"),
  );
}

export type ContactState =
  | "recent"
  | "stale"
  | "unreported"
  | "notIncluded"
  | "waiting"
  | "gatewayMissing";

export function contactState(
  node: StatusNode,
  heartbeat: Heartbeat | null,
  nowS: number,
): ContactState {
  if (!heartbeat) return "waiting";
  const gatewayStale =
    nowS - heartbeat.receivedS > 180 || nowS - heartbeat.gatewaySeenS > 180;
  if (node.id !== "C0" && gatewayStale) return "gatewayMissing";
  if (!node.reported) return "notIncluded";
  if (node.reportedS === null) return "unreported";
  // A sleeping fridge sensor can normally go five minutes between reports.
  const maxAge = node.id.startsWith("F") ? 600 : 180;
  return nowS - node.reportedS <= maxAge && (node.id !== "C0" || !gatewayStale)
    ? "recent"
    : "stale";
}

export function statusTree(heartbeat: Heartbeat | null): StatusNode[] {
  const nodes = new Map<string, StatusNode>(
    ["C0", "F0", "D0"].map(
      (id) =>
        [
          id,
          {
            id,
            reported: false,
            reportedS: null,
            lastKnownS: null,
          } satisfies StatusNode,
        ] as const,
    ),
  );
  for (const node of heartbeat?.nodes ?? []) nodes.set(node.id, node);
  return [...nodes.values()];
}

function locale(language: Language): string {
  return language === "th" ? "th-TH-u-ca-buddhist" : "en-GB";
}

export function expiryLabel(value: string, language: Language): string {
  const date = new Date(value + "T00:00:00Z");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    return "—";
  }
  return new Intl.DateTimeFormat(locale(language), {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(date);
}

export function localTimestamp(timeS: number, language: Language): string {
  return new Intl.DateTimeFormat(locale(language), {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "Asia/Bangkok",
  }).format(new Date(timeS * 1000));
}
