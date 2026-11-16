import type { AppBindings } from "../types";
import { CATEGORIES } from "./inventory";
import { sha256Hex } from "./gateway";

export interface LineProfile {
  user_id: string;
  line_user_id: string | null;
  morning_enabled: number;
  morning_time: string;
  inst_obstruct: number;
  inst_warm: number;
  inst_spoil: number;
}
export async function readLineProfile(
  db: D1Database,
  userId: string,
): Promise<LineProfile> {
  return (
    (await db
      .prepare("SELECT * FROM user_line_profiles WHERE user_id=?")
      .bind(userId)
      .first<LineProfile>()) ?? {
      user_id: userId,
      line_user_id: null,
      morning_enabled: 1,
      morning_time: "07:30",
      inst_obstruct: 1,
      inst_warm: 1,
      inst_spoil: 1,
    }
  );
}
async function favoriteKey(
  nameTh: string,
  nameEn: string,
  category: string,
): Promise<string> {
  return sha256Hex(
    JSON.stringify(
      [nameTh, nameEn, category].map((s) =>
        s.trim().normalize("NFKC").toLowerCase(),
      ),
    ),
  );
}
export async function readFavorites(
  db: D1Database,
  userId: string,
  fridgeId: string,
) {
  const [favorites, categories, inventory] = await Promise.all([
    db
      .prepare(
        "SELECT item_key, name_th, name_en, category FROM user_fridge_favorites WHERE user_id=? AND fridge_id=?",
      )
      .bind(userId, fridgeId)
      .all<{
        item_key: string;
        name_th: string;
        name_en: string;
        category: string;
      }>(),
    db
      .prepare(
        "SELECT category FROM user_fridge_fav_categories WHERE user_id=? AND fridge_id=?",
      )
      .bind(userId, fridgeId)
      .all<{ category: string }>(),
    db
      .prepare(
        "SELECT name_th,name_en,category FROM inventory WHERE fridge_id=?",
      )
      .bind(fridgeId)
      .all<{ name_th: string; name_en: string; category: string }>(),
  ]);
  const counts = new Map<string, number>();
  await Promise.all(
    inventory.results.map(async (item) => {
      const key = await favoriteKey(item.name_th, item.name_en, item.category);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }),
  );
  return {
    items: favorites.results.map((item) => ({
      ...item,
      count: counts.get(item.item_key) ?? 0,
    })),
    categories: categories.results.map((row) => row.category),
    category_counts: Object.fromEntries(
      CATEGORIES.map((category) => [
        category,
        inventory.results.filter((item) => item.category === category).length,
      ]),
    ),
  };
}
export function validCategories(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= CATEGORIES.length &&
    value.every(
      (v) => typeof v === "string" && CATEGORIES.some((c) => c === v),
    ) &&
    new Set(value).size === value.length
  );
}
export async function setFavorite(
  db: D1Database,
  userId: string,
  fridgeId: string,
  itemId: string,
): Promise<boolean> {
  const item = await db
    .prepare(
      "SELECT name_th,name_en,category FROM inventory WHERE fridge_id=? AND id=?",
    )
    .bind(fridgeId, itemId)
    .first<{ name_th: string; name_en: string; category: string }>();
  if (!item) return false;
  const key = await favoriteKey(item.name_th, item.name_en, item.category);
  const inserted = await db
    .prepare(
      `INSERT INTO user_fridge_favorites(fridge_id,user_id,item_key,name_th,name_en,category)
    SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM fridge_members fm JOIN user u ON fm.email=lower(trim(u.email)) WHERE fm.fridge_id=? AND u.id=?)
    ON CONFLICT(fridge_id,user_id,item_key) DO UPDATE SET name_th=excluded.name_th,name_en=excluded.name_en,category=excluded.category`,
    )
    .bind(
      fridgeId,
      userId,
      key,
      item.name_th,
      item.name_en,
      item.category,
      fridgeId,
      userId,
    )
    .run();
  return Boolean(inserted.meta.changes);
}
export async function updateLinePreferences(
  env: AppBindings,
  userId: string,
  input: Record<string, unknown>,
  nowS: number,
): Promise<boolean> {
  const fields: string[] = [];
  const values: (number | string)[] = [];
  for (const key of [
    "morning_enabled",
    "inst_obstruct",
    "inst_warm",
    "inst_spoil",
  ] as const) {
    if (input[key] !== undefined) {
      if (typeof input[key] !== "boolean") return false;
      fields.push(key + "=?");
      values.push(input[key] ? 1 : 0);
    }
  }
  if (input.morning_time !== undefined) {
    if (
      typeof input.morning_time !== "string" ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.morning_time)
    )
      return false;
    fields.push("morning_time=?");
    values.push(input.morning_time);
  }
  if (
    Object.keys(input).some(
      (key) =>
        ![
          "morning_enabled",
          "morning_time",
          "inst_obstruct",
          "inst_warm",
          "inst_spoil",
        ].includes(key),
    ) ||
    !fields.length
  )
    return false;
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO user_line_profiles(user_id,updated_at_s) VALUES(?,?) ON CONFLICT(user_id) DO NOTHING",
    ).bind(userId, nowS),
    env.DB.prepare(
      "UPDATE user_line_profiles SET " +
        fields.join(",") +
        ",updated_at_s=? WHERE user_id=?",
    ).bind(...values, nowS, userId),
    env.DB.prepare(
      `UPDATE user_line_outbox SET failed=1 WHERE user_id=? AND delivered_s IS NULL AND (
      (alert_type='morning' AND NOT (SELECT morning_enabled FROM user_line_profiles WHERE user_id=?)) OR
      (alert_type='warm' AND NOT (SELECT inst_warm FROM user_line_profiles WHERE user_id=?)) OR
      (alert_type='spoil' AND NOT (SELECT inst_spoil FROM user_line_profiles WHERE user_id=?)) OR
      (alert_type='obstruct' AND NOT (SELECT inst_obstruct FROM user_line_profiles WHERE user_id=?)))`,
    ).bind(userId, userId, userId, userId, userId),
  ]);
  return true;
}
