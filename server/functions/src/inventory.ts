import { createHash } from "node:crypto";
import { getAuth } from "firebase-admin/auth";
import { Filter } from "firebase-admin/firestore";
import type { DocumentReference, Firestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

const MAX_JPEG_BYTES = 1_500_000;
const MAX_BASE64_CHARS = 4 * Math.ceil(MAX_JPEG_BYTES / 3);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CATEGORIES = [
  "Dairy", "Produce", "Meat", "Seafood", "Beverage", "Condiments",
  "Leftovers", "Bakery", "Snacks", "Other",
] as const;
type Category = (typeof CATEGORIES)[number];

interface ManualFood {
  itemId: string;
  name: string;
  expiry: string;
  category: Category;
  photo: Buffer | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isFridgeMember(members: unknown, email: string): boolean {
  return isRecord(members) && Object.hasOwn(members, email) &&
    (members[email] === "owner" || members[email] === "member");
}

export async function verifiedEmail(token: string): Promise<string | null> {
  try {
    const { email, email_verified } = await getAuth().verifyIdToken(token, true);
    return email_verified && email ? email : null;
  } catch (error) {
    const code = isRecord(error) ? error.code : null;
    if (typeof code === "string" && [
      "auth/argument-error", "auth/invalid-id-token", "auth/id-token-expired",
      "auth/id-token-revoked", "auth/user-disabled", "auth/user-not-found",
    ].includes(code)) return null;
    throw error;
  }
}

function isCategory(value: unknown): value is Category {
  return CATEGORIES.some((category) => category === value);
}

function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function parseManualFood(body: unknown): ManualFood | null {
  if (!isRecord(body)) return null;
  const { item_id, name, estimated_expiry_date, category, jpeg_base64 } = body;
  if (typeof item_id !== "string" || !UUID.test(item_id) ||
      typeof name !== "string" || !name.trim() || name.trim().length > 100 ||
      !isCalendarDate(estimated_expiry_date) || !isCategory(category)) return null;

  let photo: Buffer | null = null;
  if (jpeg_base64 !== undefined && jpeg_base64 !== null) {
    if (typeof jpeg_base64 !== "string" || jpeg_base64.length > MAX_BASE64_CHARS) return null;
    photo = Buffer.from(jpeg_base64, "base64");
    if (photo.length < 5 || photo.length > MAX_JPEG_BYTES ||
        photo.toString("base64") !== jpeg_base64 ||
        photo[0] !== 255 || photo[1] !== 216 || photo[2] !== 255 ||
        photo[photo.length - 2] !== 255 || photo[photo.length - 1] !== 217) return null;
  }
  return { itemId: item_id, name: name.trim(), expiry: estimated_expiry_date, category, photo };
}

function storage() {
  return getStorage().bucket(process.env.FIREBASE_STORAGE_BUCKET || undefined);
}

export async function addManualFood(
  firestore: Firestore,
  fridge: DocumentReference,
  email: string,
  food: ManualFood,
): Promise<"created" | "duplicate" | "conflict" | "forbidden"> {
  const photoHash = food.photo && createHash("sha256").update(food.photo).digest("hex");
  const fingerprint = createHash("sha256")
    .update(JSON.stringify([food.name, food.expiry, food.category, photoHash]))
    .digest("hex");
  const item = fridge.collection("inventory").doc(food.itemId);
  const existing = await item.get();
  if (existing.exists) return existing.get("manual_request_hash") === fingerprint ? "duplicate" : "conflict";

  const photoPath = photoHash ? "food_crops/" + fridge.id + "/" + item.id + "-" + photoHash + ".jpg" : null;
  const file = photoPath ? storage().file(photoPath) : null;
  if (file && food.photo) {
    try {
      await file.save(food.photo, {
        resumable: false,
        preconditionOpts: { ifGenerationMatch: 0 },
        metadata: { contentType: "image/jpeg", cacheControl: "private, no-store" },
      });
    } catch (error) {
      if (!isRecord(error) || error.code !== 412) throw error;
      // A retry with identical bytes can reuse this immutable object.
    }
  }

  const result = await firestore.runTransaction(async (transaction) => {
    const [fridgeDoc, itemDoc] = await transaction.getAll(fridge, item);
    if (!isFridgeMember(fridgeDoc?.get("members"), email)) return "forbidden";
    if (itemDoc?.exists) {
      return itemDoc.get("manual_request_hash") === fingerprint ? "duplicate" : "conflict";
    }

    const matches = await transaction.get(fridge.collection("inventory").where(Filter.or(
      Filter.where("name_th", "==", food.name), Filter.where("name_en", "==", food.name),
    )).limit(20));
    const bilingualNames = new Map<string, { name_th: string; name_en: string }>();
    for (const doc of matches.docs) {
      const th: unknown = doc.get("name_th");
      const en: unknown = doc.get("name_en");
      if (typeof th === "string" && typeof en === "string" && th && en && th !== en) {
        bilingualNames.set(JSON.stringify([th, en]), { name_th: th, name_en: en });
      }
    }
    const uniqueName = bilingualNames.size === 1 ? bilingualNames.values().next().value : undefined;

    transaction.create(item, {
      ...uniqueName ?? { name_th: food.name, name_en: food.name },
      storage_recommendation_th: "",
      storage_recommendation_en: "",
      category: food.category,
      estimated_expiry_date: food.expiry,
      check_in_timestamp_s: Math.floor(Date.now() / 1000),
      image_storage_path: photoPath ? "/storage/" + photoPath : null,
      confidence: 1,
      check_in_source: "WEB_MANUAL",
      manual_request_hash: fingerprint,
    });
    return "created";
  });

  // Preserve the immutable object if a concurrent or retried request may use it.
  return result;
}

export function inventoryPhotoPath(value: unknown, fridgeId: string): string | null {
  if (typeof value !== "string") return null;
  const path = value.replace(/^\/storage\//, "");
  const prefix = "food_crops/" + fridgeId + "/";
  if (!path.startsWith(prefix) || !/^[a-z0-9_.-]+\.jpe?g$/i.test(path.slice(prefix.length))) return null;
  return path;
}

export async function readInventoryPhoto(path: string): Promise<Buffer | null> {
  try {
    const [bytes] = await storage().file(path).download();
    return bytes;
  } catch (error) {
    if (isRecord(error) && error.code === 404) return null;
    throw error;
  }
}
