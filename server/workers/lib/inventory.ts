import { sha256Hex } from "./gateway";
import {
  buildFoodPhotoKey,
  deletePrivatePhoto,
  inventoryPhotoKey,
  isValidJpegBytes,
  MAX_MANUAL_JPEG_BYTES,
  putImmutablePhoto,
  toStoragePath,
} from "./storage";

export const CATEGORIES = [
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

export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_TH_MAP: Record<Category, string> = {
  Dairy: "นมและผลิตภัณฑ์นม",
  Produce: "ผักและผลไม้",
  Meat: "เนื้อสัตว์",
  Seafood: "อาหารทะเล",
  Beverage: "เครื่องดื่ม",
  Condiments: "เครื่องปรุงและซอส",
  Leftovers: "อาหารปรุงสุก / ของเหลือ",
  Bakery: "เบเกอรี่และขนมปัง",
  Snacks: "ขนมขบเคี้ยว",
  Other: "อื่นๆ",
};

const MAX_BASE64_CHARS = 4 * Math.ceil(MAX_MANUAL_JPEG_BYTES / 3);
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface ManualFoodInput {
  itemId: string;
  name: string;
  expiry: string;
  category: Category;
  photo: Uint8Array | null;
}

export interface InventoryItemRow {
  id: string;
  name_th: string;
  name_en: string;
  category: string;
  category_th: string;
  estimated_expiry_date: string;
  storage_recommendation_th: string;
  storage_recommendation_en: string;
  check_in_timestamp_s: number;
  image_storage_path: string | null;
  confidence: number;
  check_in_source: "CAMERA" | "WEB_MANUAL";
}

export interface InventoryItemPatch {
  name_th?: string;
  name_en?: string;
  estimated_expiry_date?: string;
  category?: Category;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isCategory(value: unknown): value is Category {
  return CATEGORIES.some((category) => category === value);
}

export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

export function parseManualFood(body: unknown): ManualFoodInput | null {
  if (!isRecord(body)) return null;
  const { item_id, name, estimated_expiry_date, category, jpeg_base64 } = body;
  if (
    typeof item_id !== "string" ||
    !UUID_V4.test(item_id) ||
    typeof name !== "string" ||
    !name.trim() ||
    name.trim().length > 100 ||
    !isCalendarDate(estimated_expiry_date) ||
    !isCategory(category)
  ) {
    return null;
  }

  let photo: Uint8Array | null = null;
  if (jpeg_base64 !== undefined && jpeg_base64 !== null) {
    if (
      typeof jpeg_base64 !== "string" ||
      jpeg_base64.length > MAX_BASE64_CHARS
    ) {
      return null;
    }
    const decoded = Buffer.from(jpeg_base64, "base64");
    if (decoded.toString("base64") !== jpeg_base64) {
      return null;
    }
    const bytes = new Uint8Array(decoded);
    if (!isValidJpegBytes(bytes, MAX_MANUAL_JPEG_BYTES)) {
      return null;
    }
    photo = bytes;
  }

  return {
    itemId: item_id,
    name: name.trim(),
    expiry: estimated_expiry_date,
    category,
    photo,
  };
}

export function parseInventoryPatch(body: unknown): InventoryItemPatch | null {
  if (!isRecord(body)) return null;
  const patch: InventoryItemPatch = {};

  if (body.name_th !== undefined) {
    if (
      typeof body.name_th !== "string" ||
      !body.name_th.trim() ||
      body.name_th.trim().length > 100
    ) {
      return null;
    }
    patch.name_th = body.name_th.trim();
  }
  if (body.name_en !== undefined) {
    if (
      typeof body.name_en !== "string" ||
      !body.name_en.trim() ||
      body.name_en.trim().length > 100
    ) {
      return null;
    }
    patch.name_en = body.name_en.trim();
  }
  if (body.estimated_expiry_date !== undefined) {
    if (!isCalendarDate(body.estimated_expiry_date)) return null;
    patch.estimated_expiry_date = body.estimated_expiry_date;
  }
  if (body.category !== undefined) {
    if (!isCategory(body.category)) return null;
    patch.category = body.category;
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

export async function listInventory(
  db: D1Database,
  fridgeId: string,
): Promise<InventoryItemRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, name_th, name_en, category, category_th, estimated_expiry_date,
              storage_recommendation_th, storage_recommendation_en, check_in_timestamp_s,
              image_storage_path, confidence, check_in_source
       FROM inventory
       WHERE fridge_id = ?
       ORDER BY estimated_expiry_date ASC, check_in_timestamp_s ASC`,
    )
    .bind(fridgeId)
    .all<InventoryItemRow>();
  return results;
}

export async function addManualFood(
  db: D1Database,
  photos: R2Bucket,
  fridgeId: string,
  food: ManualFoodInput,
  nowS: number,
): Promise<"created" | "duplicate" | "conflict"> {
  const photoHash = food.photo ? await sha256Hex(food.photo) : null;
  const fingerprint = await sha256Hex(
    JSON.stringify([food.name, food.expiry, food.category, photoHash]),
  );

  const existing = await db
    .prepare(
      "SELECT fridge_id, manual_request_hash FROM inventory WHERE id = ?",
    )
    .bind(food.itemId)
    .first<{ fridge_id: string; manual_request_hash: string | null }>();

  if (existing) {
    if (
      existing.fridge_id === fridgeId &&
      existing.manual_request_hash === fingerprint
    ) {
      return "duplicate";
    }
    return "conflict";
  }

  const photoKey = photoHash
    ? buildFoodPhotoKey(fridgeId, food.itemId, photoHash)
    : null;
  if (photoKey && food.photo) {
    await putImmutablePhoto(photos, photoKey, food.photo);
  }

  const matches = await db
    .prepare(
      `SELECT name_th, name_en
       FROM inventory
       WHERE fridge_id = ? AND (name_th = ? OR name_en = ?)
       LIMIT 20`,
    )
    .bind(fridgeId, food.name, food.name)
    .all<{ name_th: string; name_en: string }>();

  const bilingualNames = new Map<
    string,
    { name_th: string; name_en: string }
  >();
  for (const row of matches.results) {
    if (row.name_th && row.name_en && row.name_th !== row.name_en) {
      bilingualNames.set(JSON.stringify([row.name_th, row.name_en]), row);
    }
  }
  const uniqueName =
    bilingualNames.size === 1
      ? bilingualNames.values().next().value
      : undefined;
  const resolvedNames = uniqueName ?? {
    name_th: food.name,
    name_en: food.name,
  };

  try {
    await db
      .prepare(
        `INSERT INTO inventory (
           id, fridge_id, name_th, name_en, category, category_th,
           estimated_expiry_date, storage_recommendation_th, storage_recommendation_en,
           check_in_timestamp_s, image_storage_path, confidence, check_in_source, manual_request_hash
         ) VALUES (?, ?, ?, ?, ?, ?, ?, '', '', ?, ?, 1.0, 'WEB_MANUAL', ?)`,
      )
      .bind(
        food.itemId,
        fridgeId,
        resolvedNames.name_th,
        resolvedNames.name_en,
        food.category,
        CATEGORY_TH_MAP[food.category],
        food.expiry,
        nowS,
        photoKey ? toStoragePath(photoKey) : null,
        fingerprint,
      )
      .run();
    return "created";
  } catch {
    const raced = await db
      .prepare(
        "SELECT fridge_id, manual_request_hash FROM inventory WHERE id = ?",
      )
      .bind(food.itemId)
      .first<{ fridge_id: string; manual_request_hash: string | null }>();
    if (
      raced &&
      raced.fridge_id === fridgeId &&
      raced.manual_request_hash === fingerprint
    ) {
      return "duplicate";
    }
    return "conflict";
  }
}

export async function updateInventoryItem(
  db: D1Database,
  fridgeId: string,
  itemId: string,
  patch: InventoryItemPatch,
): Promise<boolean> {
  const existing = await db
    .prepare(
      "SELECT name_th, name_en, estimated_expiry_date, category, category_th FROM inventory WHERE id = ? AND fridge_id = ?",
    )
    .bind(itemId, fridgeId)
    .first<{
      name_th: string;
      name_en: string;
      estimated_expiry_date: string;
      category: Category;
      category_th: string;
    }>();

  if (!existing) return false;

  const nextCategory = patch.category ?? existing.category;
  const nextCategoryTh = patch.category
    ? CATEGORY_TH_MAP[patch.category]
    : existing.category_th;

  await db
    .prepare(
      `UPDATE inventory
       SET name_th = ?, name_en = ?, estimated_expiry_date = ?, category = ?, category_th = ?
       WHERE id = ? AND fridge_id = ?`,
    )
    .bind(
      patch.name_th ?? existing.name_th,
      patch.name_en ?? existing.name_en,
      patch.estimated_expiry_date ?? existing.estimated_expiry_date,
      nextCategory,
      nextCategoryTh,
      itemId,
      fridgeId,
    )
    .run();
  return true;
}

export async function deleteInventoryItem(
  db: D1Database,
  photos: R2Bucket,
  fridgeId: string,
  itemId: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      "DELETE FROM inventory WHERE id = ? AND fridge_id = ? RETURNING image_storage_path",
    )
    .bind(itemId, fridgeId)
    .first<{ image_storage_path: string | null }>();

  if (!row) return false;

  const key = inventoryPhotoKey(row.image_storage_path, fridgeId);
  if (key) {
    await deletePrivatePhoto(photos, key);
  }
  return true;
}

export async function readInventoryPhoto(
  db: D1Database,
  photos: R2Bucket,
  fridgeId: string,
  itemId: string,
): Promise<R2ObjectBody | null> {
  const row = await db
    .prepare(
      "SELECT image_storage_path FROM inventory WHERE id = ? AND fridge_id = ?",
    )
    .bind(itemId, fridgeId)
    .first<{ image_storage_path: string | null }>();

  const key = inventoryPhotoKey(row?.image_storage_path, fridgeId);
  if (!key) return null;
  return photos.get(key);
}

const TELEMETRY_WINDOWS_S: Record<string, number> = {
  "1h": 3600,
  "24h": 86_400,
  "7d": 604_800,
  "30d": 2_592_000,
};

export async function queryTelemetryHistory(
  db: D1Database,
  fridgeId: string,
  range: string | undefined,
  nowS: number,
) {
  const windowS =
    TELEMETRY_WINDOWS_S[range ?? "1h"] ?? TELEMETRY_WINDOWS_S["1h"]!;
  const sinceS = Math.max(0, nowS - windowS);
  const { results } = await db
    .prepare(
      `SELECT node_id, timestamp_s, temp_celsius, voc_index, light_ldr
       FROM telemetry_samples
       WHERE fridge_id = ? AND timestamp_s >= ?
       ORDER BY timestamp_s DESC
       LIMIT 2000`,
    )
    .bind(fridgeId, sinceS)
    .all<{
      node_id: string;
      timestamp_s: number;
      temp_celsius: number | null;
      voc_index: number | null;
      light_ldr: number | null;
    }>();

  return results.reverse();
}

export async function getLatestStatus(db: D1Database, fridgeId: string) {
  const row = await db
    .prepare(
      "SELECT gateway_seen_s, received_s, nodes_json FROM system_status WHERE fridge_id = ?",
    )
    .bind(fridgeId)
    .first<{
      gateway_seen_s: number;
      received_s: number;
      nodes_json: string;
    }>();

  if (!row) return null;
  try {
    return {
      gateway_seen_s: row.gateway_seen_s,
      received_s: row.received_s,
      nodes: JSON.parse(row.nodes_json) as unknown[],
    };
  } catch {
    return null;
  }
}

export async function listDoorEvents(
  db: D1Database,
  fridgeId: string,
  limitRaw: string | undefined,
) {
  const parsed = limitRaw ? Number.parseInt(limitRaw, 10) : 50;
  const limit =
    Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 200) : 50;
  const { results } = await db
    .prepare(
      `SELECT node_id, timestamp_s, status
       FROM door_events
       WHERE fridge_id = ?
       ORDER BY timestamp_s DESC
       LIMIT ?`,
    )
    .bind(fridgeId, limit)
    .all<{ node_id: string; timestamp_s: number; status: string }>();
  return results;
}
