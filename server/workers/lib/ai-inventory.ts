import { sha256Hex } from "./gateway";
import { commitInventoryOperation } from "./operations";
import { isValidFridgeId } from "./fridges";
import type {
  CheckOutMatchType,
  ExistingProduct,
  GeminiCheckOutResponse,
  InventoryCandidate,
} from "./gemini";
import { bangkokIsoDate } from "./gemini";
import {
  CATEGORY_TH_MAP,
  isCalendarDate,
  isCategory,
  type Category,
} from "./inventory";
import {
  inventoryPhotoKey,
  isValidJpegBytes,
  MAX_CHECKIN_JPEG_BYTES,
  toStoragePath,
} from "./storage";

export interface CheckInCommitPayload {
  name_th: string;
  name_en: string;
  category: Category;
  category_th: string;
  estimated_shelf_life_days: number;
  estimated_expiry_date: string;
  storage_recommendation_th: string;
  storage_recommendation_en: string;
  image_storage_path: string;
  confidence: number;
}

export interface CheckOutCandidateRow {
  id: string;
  name_th: string;
  name_en: string;
  category: string;
  category_th: string;
  estimated_expiry_date: string;
  check_in_timestamp_s: number;
}

interface CandidateItem {
  item_id: string;
  name_th: string;
  name_en: string;
  category: string;
  category_th: string;
  estimated_expiry_date: string;
}

export interface CheckOutDraftResult {
  match_type: CheckOutMatchType;
  candidate_matches: CandidateItem[];
  confidence: number;
  reasoning: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function parseMultipartJpeg(
  request: Request,
): Promise<
  | { kind: "ok"; bytes: Uint8Array }
  | { kind: "too_large" }
  | { kind: "invalid" }
> {
  let formData: FormData;
  try {
    const maxBodyBytes = MAX_CHECKIN_JPEG_BYTES + 64 * 1024;
    const reader = request.body?.getReader();
    if (!reader) return { kind: "invalid" };
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > maxBodyBytes) {
          await reader.cancel();
          return { kind: "too_large" };
        }
        chunks.push(part.value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    formData = await new Response(bytes, {
      headers: { "Content-Type": request.headers.get("Content-Type") ?? "" },
    }).formData();
  } catch {
    return { kind: "invalid" };
  }

  const field = formData.get("image");
  if (
    !field ||
    typeof field !== "object" ||
    typeof (field as Blob).arrayBuffer !== "function"
  ) {
    return { kind: "invalid" };
  }

  const blob = field as Blob;
  if (blob.size > MAX_CHECKIN_JPEG_BYTES) {
    return { kind: "too_large" };
  }

  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.byteLength > MAX_CHECKIN_JPEG_BYTES) {
    return { kind: "too_large" };
  }
  if (!isValidJpegBytes(bytes, MAX_CHECKIN_JPEG_BYTES)) {
    return { kind: "invalid" };
  }

  return { kind: "ok", bytes };
}

export function parseCheckInCommit(
  body: unknown,
  fridgeId: string,
): CheckInCommitPayload | null {
  if (!isRecord(body)) return null;

  const {
    name_th,
    name_en,
    category,
    category_th,
    estimated_shelf_life_days,
    estimated_expiry_date,
    storage_recommendation_th,
    storage_recommendation_en,
    image_storage_path,
    confidence,
  } = body;

  if (
    typeof name_th !== "string" ||
    !name_th.trim() ||
    name_th.trim().length > 120 ||
    typeof name_en !== "string" ||
    !name_en.trim() ||
    name_en.trim().length > 120 ||
    !isCategory(category) ||
    typeof category_th !== "string" ||
    !category_th.trim() ||
    category_th.trim().length > 120 ||
    typeof estimated_shelf_life_days !== "number" ||
    !Number.isSafeInteger(estimated_shelf_life_days) ||
    estimated_shelf_life_days < 0 ||
    estimated_shelf_life_days > 3650 ||
    !isCalendarDate(estimated_expiry_date) ||
    typeof storage_recommendation_th !== "string" ||
    storage_recommendation_th.trim().length > 300 ||
    typeof storage_recommendation_en !== "string" ||
    storage_recommendation_en.trim().length > 300 ||
    typeof confidence !== "number" ||
    !Number.isFinite(confidence) ||
    confidence < 0 ||
    confidence > 1
  ) {
    return null;
  }

  const key = inventoryPhotoKey(image_storage_path, fridgeId);
  if (!key) return null;

  return {
    name_th: name_th.trim(),
    name_en: name_en.trim(),
    category,
    category_th: category_th.trim() || CATEGORY_TH_MAP[category],
    estimated_shelf_life_days,
    estimated_expiry_date,
    storage_recommendation_th: storage_recommendation_th.trim(),
    storage_recommendation_en: storage_recommendation_en.trim(),
    image_storage_path: toStoragePath(key),
    confidence,
  };
}

export async function listExistingProducts(
  db: D1Database,
  fridgeId: string,
): Promise<ExistingProduct[]> {
  const { results } = await db
    .prepare(
      `SELECT name_th, name_en, category FROM inventory
     WHERE fridge_id=?
     GROUP BY name_th, name_en, category
     ORDER BY MAX(check_in_timestamp_s) DESC, name_th, name_en, category
     LIMIT 40`,
    )
    .bind(fridgeId)
    .all<ExistingProduct>();
  return results;
}

export async function commitCameraCheckIn(
  db: D1Database,
  fridgeId: string,
  payload: CheckInCommitPayload,
  nowS: number,
  operationId: string,
): Promise<string> {
  const pack = await db
    .prepare(
      "SELECT unit_count FROM camera_checkin_packs WHERE fridge_id=? AND photo_path=?",
    )
    .bind(fridgeId, payload.image_storage_path)
    .first<{ unit_count: number }>();
  const outcome = await commitInventoryOperation(
    db,
    fridgeId,
    "camera",
    operationId,
    await sha256Hex(JSON.stringify(payload)),
    {
      ...payload,
      id: `item_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
      check_in_timestamp_s: nowS,
      check_in_source: "CAMERA",
    },
    pack
      ? { count: pack.unit_count, photoPath: payload.image_storage_path }
      : undefined,
  );
  return outcome.itemId;
}

export async function listCheckOutCandidateRows(
  db: D1Database,
  fridgeId: string,
): Promise<CheckOutCandidateRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, name_th, name_en, category, category_th, estimated_expiry_date, check_in_timestamp_s
       FROM inventory
       WHERE fridge_id = ?
       ORDER BY estimated_expiry_date ASC, check_in_timestamp_s ASC`,
    )
    .bind(fridgeId)
    .all<CheckOutCandidateRow>();
  return results;
}

export function toPromptCandidates(
  rows: CheckOutCandidateRow[],
): InventoryCandidate[] {
  return rows.map((row) => ({
    item_id: row.id,
    name_th: row.name_th,
    name_en: row.name_en,
    category: row.category,
    check_in_date: bangkokIsoDate(row.check_in_timestamp_s),
    estimated_expiry_date: row.estimated_expiry_date,
  }));
}

export function resolveCheckOutDraft(
  rows: CheckOutCandidateRow[],
  gemini: GeminiCheckOutResponse,
): CheckOutDraftResult {
  const byId = new Map<string, CheckOutCandidateRow>();
  for (const row of rows) {
    byId.set(row.id, row);
  }

  const matchedRows = new Map<string, CheckOutCandidateRow>();
  if (gemini.matched_item_id) {
    const row = byId.get(gemini.matched_item_id);
    if (row) matchedRows.set(row.id, row);
  }
  for (const id of gemini.candidate_matches) {
    const row = byId.get(id);
    if (row) matchedRows.set(row.id, row);
  }

  const sorted = [...matchedRows.values()].sort(
    (a, b) =>
      a.estimated_expiry_date.localeCompare(b.estimated_expiry_date) ||
      a.check_in_timestamp_s - b.check_in_timestamp_s ||
      a.id.localeCompare(b.id),
  );

  const candidateMatches: CandidateItem[] = sorted.map((row) => ({
    item_id: row.id,
    name_th: row.name_th,
    name_en: row.name_en,
    category: row.category,
    category_th:
      row.category_th ||
      (isCategory(row.category)
        ? CATEGORY_TH_MAP[row.category]
        : CATEGORY_TH_MAP.Other),
    estimated_expiry_date: row.estimated_expiry_date,
  }));

  const matchType: CheckOutMatchType =
    candidateMatches.length === 0
      ? "NO_MATCH"
      : candidateMatches.length === 1
        ? "EXACT_MATCH"
        : "AMBIGUOUS_MULTIPLE";

  return {
    match_type: matchType,
    candidate_matches: candidateMatches,
    confidence: gemini.confidence,
    reasoning: gemini.reasoning,
  };
}

export function parseCheckOutCommit(body: unknown): { item_id: string } | null {
  if (!isRecord(body) || typeof body.item_id !== "string") return null;
  const itemId = body.item_id.trim();
  if (!isValidFridgeId(itemId)) return null;
  return { item_id: itemId };
}
