import type { AppBindings } from "../types";
import { CATEGORIES, isCategory, type Category } from "./inventory";

const DEFAULT_PRIMARY_MODEL = "gemini-3.5-flash-lite";
const DEFAULT_FALLBACK_MODEL = "gemini-2.5-flash-lite";
const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com";
const DEFAULT_RETRY_DELAYS_MS = [1000, 2000, 4000] as const;

export interface GeminiCallOptions {
  retryDelaysMs?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
}

export interface GeminiCheckInResponse {
  is_food: boolean;
  name_th: string;
  name_en: string;
  category: Category;
  estimated_shelf_life_days: number;
  confidence: number;
  storage_recommendation_th: string;
  storage_recommendation_en: string;
}

export interface InventoryCandidate {
  item_id: string;
  name_th: string;
  name_en: string;
  category: string;
  check_in_date: string;
  estimated_expiry_date: string;
}

export type CheckOutMatchType =
  "EXACT_MATCH" | "AMBIGUOUS_MULTIPLE" | "NO_MATCH";

export interface GeminiCheckOutResponse {
  match_type: CheckOutMatchType;
  matched_item_id: string | null;
  candidate_matches: string[];
  identified_name_th: string;
  identified_name_en: string;
  confidence: number;
  reasoning: string;
}

export class GeminiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeminiUnavailableError";
  }
}

const CHECK_IN_SCHEMA = {
  type: "OBJECT",
  properties: {
    is_food: { type: "BOOLEAN" },
    name_th: { type: "STRING" },
    name_en: { type: "STRING" },
    category: { type: "STRING", enum: [...CATEGORIES] },
    estimated_shelf_life_days: { type: "INTEGER" },
    confidence: { type: "NUMBER" },
    storage_recommendation_th: { type: "STRING" },
    storage_recommendation_en: { type: "STRING" },
  },
  required: [
    "is_food",
    "name_th",
    "name_en",
    "category",
    "estimated_shelf_life_days",
    "confidence",
    "storage_recommendation_th",
    "storage_recommendation_en",
  ],
};

const CHECK_OUT_SCHEMA = {
  type: "OBJECT",
  properties: {
    match_type: {
      type: "STRING",
      enum: ["EXACT_MATCH", "AMBIGUOUS_MULTIPLE", "NO_MATCH"],
    },
    matched_item_id: { type: "STRING", nullable: true },
    candidate_matches: {
      type: "ARRAY",
      items: { type: "STRING" },
    },
    identified_name_th: { type: "STRING" },
    identified_name_en: { type: "STRING" },
    confidence: { type: "NUMBER" },
    reasoning: { type: "STRING" },
  },
  required: [
    "match_type",
    "candidate_matches",
    "identified_name_th",
    "identified_name_en",
    "confidence",
    "reasoning",
  ],
};

export function bangkokIsoDate(epochS: number): string {
  return new Date((epochS + 7 * 3600) * 1000).toISOString().slice(0, 10);
}

export function addDaysToIsoDate(isoDate: string, days: number): string {
  const safeDays = Math.max(0, Math.min(3650, Math.round(days)));
  const ms = Date.parse(`${isoDate}T00:00:00Z`);
  return new Date(ms + safeDays * 86_400_000).toISOString().slice(0, 10);
}

export async function resolveFridgeGeminiKey(
  db: D1Database,
  fridgeId: string,
  env: AppBindings,
): Promise<string | null> {
  const row = await db
    .prepare("SELECT gemini_api_key FROM fridge_secrets WHERE fridge_id = ?")
    .bind(fridgeId)
    .first<{ gemini_api_key: string | null }>();
  const key = row?.gemini_api_key?.trim() || env.GEMINI_API_KEY?.trim() || "";
  return key || null;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractGeminiJsonText(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const candidates = (payload as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const first = candidates[0] as {
    content?: { parts?: Array<{ text?: unknown }> };
  };
  const parts = first?.content?.parts;
  if (!Array.isArray(parts)) return null;
  for (const part of parts) {
    if (typeof part?.text === "string" && part.text.trim()) {
      return part.text.trim();
    }
  }
  return null;
}

async function callModelWithRetries(
  baseUrl: string,
  model: string,
  apiKey: string,
  body: Record<string, unknown>,
  options: GeminiCallOptions | undefined,
): Promise<
  | { ok: true; data: unknown }
  | { ok: false; status: number; retriable: boolean }
> {
  const delays = options?.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const sleep = options?.sleep ?? defaultSleep;
  const endpoint = `${baseUrl.replace(/\/+$/, "")}/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });

      if (response.ok) {
        const json = (await response.json()) as unknown;
        const text = extractGeminiJsonText(json);
        if (!text) {
          return { ok: false, status: 502, retriable: false };
        }
        return { ok: true, data: JSON.parse(text) as unknown };
      }

      const retriable = response.status === 429 || response.status === 503;
      await response.body?.cancel();

      if (retriable && attempt < delays.length) {
        await sleep(delays[attempt]!);
        continue;
      }

      return { ok: false, status: response.status, retriable };
    } catch {
      if (attempt < delays.length) {
        await sleep(delays[attempt]!);
        continue;
      }
      return { ok: false, status: 503, retriable: true };
    }
  }

  return { ok: false, status: 503, retriable: true };
}

async function generateStructuredJson(
  env: AppBindings,
  apiKey: string,
  prompt: string,
  jpegBytes: Uint8Array,
  schema: Record<string, unknown>,
  options?: GeminiCallOptions,
): Promise<unknown> {
  const baseUrl = env.GEMINI_API_BASE_URL?.trim() || DEFAULT_BASE_URL;
  const primaryModel = env.GEMINI_MODEL?.trim() || DEFAULT_PRIMARY_MODEL;
  const fallbackModel =
    env.GEMINI_FALLBACK_MODEL?.trim() || DEFAULT_FALLBACK_MODEL;
  const imageBase64 = Buffer.from(jpegBytes).toString("base64");

  const body = {
    contents: [
      {
        role: "user",
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType: "image/jpeg",
              data: imageBase64,
            },
          },
        ],
      },
    ],
    generationConfig: {
      maxOutputTokens: 4096,
      temperature: 0.1,
      topP: 0.95,
      responseMimeType: "application/json",
      responseSchema: schema,
    },
  };

  const primary = await callModelWithRetries(
    baseUrl,
    primaryModel,
    apiKey,
    body,
    options,
  );
  if (primary.ok) return primary.data;

  if (
    fallbackModel &&
    fallbackModel !== primaryModel &&
    (primary.retriable || primary.status === 404)
  ) {
    const fallback = await callModelWithRetries(
      baseUrl,
      fallbackModel,
      apiKey,
      body,
      options,
    );
    if (fallback.ok) return fallback.data;
  }

  throw new GeminiUnavailableError(
    `Gemini inference failed (status ${primary.status}).`,
  );
}

export async function classifyCheckInImage(
  env: AppBindings,
  apiKey: string,
  jpegBytes: Uint8Array,
  nowS: number,
  options?: GeminiCallOptions,
): Promise<GeminiCheckInResponse | null> {
  const currentDate = bangkokIsoDate(nowS);
  const prompt = [
    "You are an expert grocery inventory classification engine for a smart refrigerator system.",
    "Analyze the provided image of a grocery/food item.",
    "",
    `Current Reference Date: ${currentDate} (Unix Epoch: ${nowS} seconds)`,
    "",
    "Your task:",
    "1. Determine if the image contains a food or beverage item (is_food).",
    '2. Identify the specific item name in both Thai (name_th) and English (name_en), e.g. name_th="นมสดพาสเจอร์ไรส์", name_en="Pasteurized Whole Milk".',
    `3. Classify the item into one of the canonical categories: ${CATEGORIES.join(", ")}.`,
    "4. Estimate standard refrigerated shelf life in days (estimated_shelf_life_days). Note: Server 'S' deterministically calculates estimated_expiry_date = CURRENT_DATE + estimated_shelf_life_days.",
    "5. Provide a confidence score between 0.0 and 1.0.",
    '6. Return brief storage recommendations in both Thai (storage_recommendation_th) and English (storage_recommendation_en), e.g. storage_recommendation_th="เก็บในช่องแช่เย็นหลัก 2-4°C", storage_recommendation_en="Keep sealed on main shelf 2-4°C".',
  ].join("\n");

  const raw = await generateStructuredJson(
    env,
    apiKey,
    prompt,
    jpegBytes,
    CHECK_IN_SCHEMA,
    options,
  );

  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const isFood = r.is_food === true;
  const confidence =
    typeof r.confidence === "number" && Number.isFinite(r.confidence)
      ? Math.max(0, Math.min(1, r.confidence))
      : 0;
  const nameTh = typeof r.name_th === "string" ? r.name_th.trim() : "";
  const nameEn = typeof r.name_en === "string" ? r.name_en.trim() : "";
  const category: Category = isCategory(r.category) ? r.category : "Other";
  const shelfLife =
    typeof r.estimated_shelf_life_days === "number" &&
    Number.isFinite(r.estimated_shelf_life_days)
      ? Math.max(0, Math.min(3650, Math.round(r.estimated_shelf_life_days)))
      : 7;
  const storageTh =
    typeof r.storage_recommendation_th === "string"
      ? r.storage_recommendation_th.trim()
      : "";
  const storageEn =
    typeof r.storage_recommendation_en === "string"
      ? r.storage_recommendation_en.trim()
      : "";

  return {
    is_food: isFood,
    name_th: nameTh || nameEn || "อาหาร",
    name_en: nameEn || nameTh || "Food item",
    category,
    estimated_shelf_life_days: shelfLife,
    confidence,
    storage_recommendation_th: storageTh,
    storage_recommendation_en: storageEn,
  };
}

export async function matchCheckOutImage(
  env: AppBindings,
  apiKey: string,
  jpegBytes: Uint8Array,
  candidates: InventoryCandidate[],
  options?: GeminiCallOptions,
): Promise<GeminiCheckOutResponse | null> {
  const prompt = [
    "You are an expert grocery inventory checkout engine for a smart refrigerator system.",
    "A user has removed a food item from the refrigerator. Match the removed item in the provided image against the active inventory candidate items listed below.",
    "",
    "Current Active Refrigerator Inventory Candidates:",
    JSON.stringify(candidates),
    "",
    "Your task:",
    "1. Visually identify the item presented in the image.",
    "2. Search the Candidate Items list for matching items.",
    "3. Determine match resolution:",
    "   - EXACT_MATCH: Exactly one candidate item clearly corresponds to the image.",
    "   - AMBIGUOUS_MULTIPLE: Multiple candidate items could match (e.g., multiple milks). Return all matching candidate item_ids in candidate_matches (Server 'S' deterministically sorts them by FEFO).",
    "   - NO_MATCH: No candidate items in inventory match the presented item (flag for manual check-out).",
    "4. Return the matched item ID (matched_item_id) if EXACT_MATCH, or candidate IDs if AMBIGUOUS_MULTIPLE.",
    "5. Provide identified names in both Thai (identified_name_th) and English (identified_name_en), confidence score (0.0 to 1.0), and brief reasoning string.",
  ].join("\n");

  const raw = await generateStructuredJson(
    env,
    apiKey,
    prompt,
    jpegBytes,
    CHECK_OUT_SCHEMA,
    options,
  );

  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const matchType: CheckOutMatchType =
    r.match_type === "EXACT_MATCH" ||
    r.match_type === "AMBIGUOUS_MULTIPLE" ||
    r.match_type === "NO_MATCH"
      ? r.match_type
      : "NO_MATCH";
  const matchedItemId =
    typeof r.matched_item_id === "string" && r.matched_item_id.trim()
      ? r.matched_item_id.trim()
      : null;
  const candidateMatches = Array.isArray(r.candidate_matches)
    ? (r.candidate_matches as unknown[]).filter(
        (id): id is string => typeof id === "string" && id.trim().length > 0,
      )
    : [];
  const confidence =
    typeof r.confidence === "number" && Number.isFinite(r.confidence)
      ? Math.max(0, Math.min(1, r.confidence))
      : 0;

  return {
    match_type: matchType,
    matched_item_id: matchedItemId,
    candidate_matches: candidateMatches,
    identified_name_th:
      typeof r.identified_name_th === "string"
        ? r.identified_name_th.trim()
        : "",
    identified_name_en:
      typeof r.identified_name_en === "string"
        ? r.identified_name_en.trim()
        : "",
    confidence,
    reasoning: typeof r.reasoning === "string" ? r.reasoning.trim() : "",
  };
}
