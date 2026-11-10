export type Language = "th" | "en";

export interface Fridge {
  id: string;
  name: string;
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

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function epoch(value: unknown): number | null {
  const time = number(value);
  return time !== null && Number.isSafeInteger(time) && time >= 0 && time <= 253402300799 ? time : null;
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
    temperature: temperature !== null && temperature !== -32768 ? temperature : null,
    voc: voc !== null && voc >= 1 && voc <= 500 ? voc : null,
    light: light !== null && light >= 0 && light <= 4095 ? light : null,
  };
}

export function readFridge(id: string, value: unknown): Fridge {
  const data = record(value);
  return { id, name: text(data.name).trim() || id, latest: readSample(data.last_telemetry) };
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
  return (samples as unknown[]).map(readSample).filter((sample) => sample !== null);
}

export function readHeartbeat(value: unknown): Heartbeat | null {
  const data = record(value);
  const receivedS = epoch(data.received_s);
  const gatewaySeenS = epoch(data.gateway_seen_s);
  if (receivedS === null || gatewaySeenS === null || !Array.isArray(data.nodes)) return null;
  const nodes = (data.nodes as unknown[]).map((value) => {
    const node = record(value);
    return { id: text(node.node_id), reported: true, reportedS: epoch(node.last_seen_s), lastKnownS: epoch(node.last_known_seen_s) };
  }).filter((node) => node.id !== "");
  return { gatewaySeenS, receivedS, nodes };
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
    const matchedName = (!englishName || englishName === thaiName) && aliases?.size === 1
      ? aliases.values().next().value : undefined;
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

export type ContactState = "recent" | "stale" | "unreported" | "notIncluded" | "waiting" | "gatewayMissing";

export function contactState(node: StatusNode, heartbeat: Heartbeat | null, nowS: number): ContactState {
  if (!heartbeat) return "waiting";
  const gatewayStale = nowS - heartbeat.receivedS > 180 || nowS - heartbeat.gatewaySeenS > 180;
  if (node.id !== "C0" && gatewayStale) return "gatewayMissing";
  if (!node.reported) return "notIncluded";
  if (node.reportedS === null) return "unreported";
  // A sleeping fridge sensor can normally go five minutes between reports.
  const maxAge = node.id.startsWith("F") ? 600 : 180;
  return nowS - node.reportedS <= maxAge &&
    (node.id !== "C0" || !gatewayStale) ? "recent" : "stale";
}

export function statusTree(heartbeat: Heartbeat | null): StatusNode[] {
  const nodes = new Map<string, StatusNode>(["C0", "F0", "D0"].map((id) =>
    [id, { id, reported: false, reportedS: null, lastKnownS: null } satisfies StatusNode] as const),
  );
  for (const node of heartbeat?.nodes ?? []) nodes.set(node.id, node);
  return [...nodes.values()];
}

export function locale(language: Language): string {
  return language === "th" ? "th-TH-u-ca-buddhist" : "en-GB";
}

export function expiryLabel(value: string, language: Language): string {
  const date = new Date(value + "T00:00:00Z");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0, 10) !== value) return "—";
  return new Intl.DateTimeFormat(locale(language), { dateStyle: "medium", timeZone: "UTC" }).format(date);
}

export function localTimestamp(timeS: number, language: Language): string {
  return new Intl.DateTimeFormat(locale(language), {
    dateStyle: "medium", timeStyle: "medium", timeZone: "Asia/Bangkok",
  }).format(new Date(timeS * 1000));
}
