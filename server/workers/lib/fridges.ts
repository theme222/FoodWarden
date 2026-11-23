import { sha256Hex } from "./gateway";

export type MemberRole = "owner" | "member";

export interface FridgeSummary {
  id: string;
  name: string;
  role: MemberRole;
  last_seen_s: number;
  last_telemetry: unknown;
  inventory_count: number;
  expiring_soon_count: number;
}

interface FridgeMemberRow {
  email: string;
  role: MemberRole;
  added_at_s: number;
}

export interface FridgeSettings {
  id: string;
  name: string;
  line_target_id: string | null;
  gateway_token: string;
  has_gemini_api_key: boolean;
  members: FridgeMemberRow[];
}

const FRIDGE_ID_PATTERN = /^[a-z0-9_-]{1,128}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidFridgeId(id: string): boolean {
  return FRIDGE_ID_PATTERN.test(id);
}

export function normalizeEmail(email: string): string | null {
  const trimmed = email.trim().toLowerCase();
  if (!trimmed || trimmed.length > 254 || !EMAIL_PATTERN.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function generateGatewayToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return (
    "fw_gw_" +
    Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
  );
}

function generateFridgeId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const suffix = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  return (slug || "fridge") + "-" + suffix;
}

function parseJsonOrNull(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

export async function getMemberRole(
  db: D1Database,
  fridgeId: string,
  email: string,
): Promise<MemberRole | null> {
  const row = await db
    .prepare(
      "SELECT role FROM fridge_members WHERE fridge_id = ? AND email = ?",
    )
    .bind(fridgeId, email)
    .first<{ role: MemberRole }>();
  return row?.role ?? null;
}

export async function listUserFridges(
  db: D1Database,
  email: string,
): Promise<FridgeSummary[]> {
  const { results } = await db
    .prepare(
      `SELECT f.id, f.name, fm.role, f.last_seen_s, f.last_telemetry_json,
              (SELECT COUNT(*) FROM inventory i WHERE i.fridge_id = f.id) AS inventory_count,
              (SELECT COUNT(*) FROM inventory i
               WHERE i.fridge_id = f.id
                 AND i.estimated_expiry_date BETWEEN date('now', '+7 hours')
                                                 AND date('now', '+7 hours', '+3 days')) AS expiring_soon_count
       FROM fridges f
       INNER JOIN fridge_members fm ON fm.fridge_id = f.id
       WHERE fm.email = ?
       ORDER BY f.created_at_s ASC, f.name ASC`,
    )
    .bind(email)
    .all<{
      id: string;
      name: string;
      role: MemberRole;
      last_seen_s: number;
      last_telemetry_json: string | null;
      inventory_count: number;
      expiring_soon_count: number;
    }>();

  return results.map((row) => ({
    id: row.id,
    name: row.name,
    role: row.role,
    last_seen_s: row.last_seen_s,
    last_telemetry: parseJsonOrNull(row.last_telemetry_json),
    inventory_count: row.inventory_count,
    expiring_soon_count: row.expiring_soon_count,
  }));
}

export async function createFridge(
  db: D1Database,
  ownerEmail: string,
  name: string,
  nowS: number,
  budgetOwnerId?: string,
): Promise<{ id: string; name: string; role: MemberRole }> {
  const id = generateFridgeId(name);
  const gatewayToken = generateGatewayToken();
  const gatewayTokenHash = await sha256Hex(gatewayToken);

  await db.batch([
    db
      .prepare(
        "INSERT INTO fridges (id, name, created_at_s, ai_budget_owner) VALUES (?, ?, ?, ?)",
      )
      .bind(id, name, nowS, budgetOwnerId ?? ownerEmail),
    db
      .prepare(
        "INSERT INTO fridge_members (fridge_id, email, role, added_at_s) VALUES (?, ?, 'owner', ?)",
      )
      .bind(id, ownerEmail, nowS),
    db
      .prepare(
        "INSERT INTO fridge_secrets (fridge_id, gateway_token, gateway_token_hash, updated_at_s) VALUES (?, ?, ?, ?)",
      )
      .bind(id, gatewayToken, gatewayTokenHash, nowS),
  ]);

  return { id, name, role: "owner" };
}

export async function getFridgeSettings(
  db: D1Database,
  fridgeId: string,
  actorEmail: string,
): Promise<FridgeSettings | null> {
  const fridge = await db
    .prepare(
      `SELECT f.id, f.name, f.line_target_id, fs.gateway_token, fs.gemini_api_key
       FROM fridges f
       INNER JOIN fridge_secrets fs ON fs.fridge_id = f.id
       WHERE f.id = ? AND EXISTS (SELECT 1 FROM fridge_members WHERE fridge_id=f.id AND email=? AND role='owner')`,
    )
    .bind(fridgeId, actorEmail)
    .first<{
      id: string;
      name: string;
      line_target_id: string | null;
      gateway_token: string;
      gemini_api_key: string | null;
    }>();

  if (!fridge) return null;

  const { results: members } = await db
    .prepare(
      `SELECT email, role, added_at_s
       FROM fridge_members
       WHERE fridge_id = ?
       ORDER BY CASE WHEN role = 'owner' THEN 0 ELSE 1 END, added_at_s ASC, email ASC`,
    )
    .bind(fridgeId)
    .all<FridgeMemberRow>();

  return {
    id: fridge.id,
    name: fridge.name,
    line_target_id: fridge.line_target_id,
    gateway_token: fridge.gateway_token,
    has_gemini_api_key: Boolean(fridge.gemini_api_key),
    members,
  };
}

export async function updateFridgeSettings(
  db: D1Database,
  fridgeId: string,
  patch: { name?: string; gemini_api_key?: string | null },
  nowS: number,
  actorEmail: string,
): Promise<boolean> {
  const statements: D1PreparedStatement[] = [];
  const owner =
    "EXISTS (SELECT 1 FROM fridge_members WHERE fridge_id=? AND email=? AND role='owner')";
  if (patch.name !== undefined)
    statements.push(
      db
        .prepare("UPDATE fridges SET name=? WHERE id=? AND " + owner)
        .bind(patch.name, fridgeId, fridgeId, actorEmail),
    );
  if (patch.gemini_api_key !== undefined)
    statements.push(
      db
        .prepare(
          "UPDATE fridge_secrets SET gemini_api_key=?, updated_at_s=? WHERE fridge_id=? AND " +
            owner,
        )
        .bind(patch.gemini_api_key, nowS, fridgeId, fridgeId, actorEmail),
    );
  if (!statements.length) return false;
  const results = await db.batch(statements);
  return results.every((result) => (result.meta.changes ?? 0) > 0);
}

export async function rotateGatewayToken(
  db: D1Database,
  fridgeId: string,
  nowS: number,
  actorEmail: string,
): Promise<string | null> {
  const token = generateGatewayToken();
  const hash = await sha256Hex(token);
  const result = await db
    .prepare(
      "UPDATE fridge_secrets SET gateway_token=?,gateway_token_hash=?,updated_at_s=? WHERE fridge_id=? AND EXISTS (SELECT 1 FROM fridge_members WHERE fridge_id=? AND email=? AND role='owner')",
    )
    .bind(token, hash, nowS, fridgeId, fridgeId, actorEmail)
    .run();
  return result.meta.changes ? token : null;
}

export async function upsertFridgeMember(
  db: D1Database,
  fridgeId: string,
  email: string,
  role: MemberRole,
  nowS: number,
  actorEmail: string,
): Promise<"ok" | "last_owner" | "forbidden"> {
  const result = await db
    .prepare(
      `INSERT INTO fridge_members (fridge_id, email, role, added_at_s)
    SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM fridge_members WHERE fridge_id = ? AND email = ? AND role = 'owner')
    AND (? = 'owner' OR NOT EXISTS (SELECT 1 FROM fridge_members WHERE fridge_id = ? AND email = ? AND role = 'owner')
      OR EXISTS (SELECT 1 FROM fridge_members WHERE fridge_id = ? AND email != ? AND role = 'owner'))
    ON CONFLICT(fridge_id, email) DO UPDATE SET role = excluded.role`,
    )
    .bind(
      fridgeId,
      email,
      role,
      nowS,
      fridgeId,
      actorEmail,
      role,
      fridgeId,
      email,
      fridgeId,
      email,
    )
    .run();
  if (result.meta.changes) return "ok";
  return (await getMemberRole(db, fridgeId, actorEmail)) === "owner"
    ? "last_owner"
    : "forbidden";
}

export async function removeFridgeMember(
  db: D1Database,
  fridgeId: string,
  email: string,
  actorEmail: string,
): Promise<"deleted" | "not_found" | "last_owner" | "forbidden"> {
  const result = await db
    .prepare(
      `DELETE FROM fridge_members WHERE fridge_id = ? AND email = ?
    AND EXISTS (SELECT 1 FROM fridge_members WHERE fridge_id = ? AND email = ? AND role = 'owner')
    AND (role != 'owner' OR EXISTS (SELECT 1 FROM fridge_members WHERE fridge_id = ? AND email != ? AND role = 'owner'))`,
    )
    .bind(fridgeId, email, fridgeId, actorEmail, fridgeId, email)
    .run();
  if (result.meta.changes) return "deleted";
  if ((await getMemberRole(db, fridgeId, actorEmail)) !== "owner")
    return "forbidden";
  return (await getMemberRole(db, fridgeId, email))
    ? "last_owner"
    : "not_found";
}

export async function deleteFridge(
  db: D1Database,
  photos: R2Bucket,
  fridgeId: string,
  actorEmail: string,
): Promise<boolean> {
  const removed = await db
    .prepare(
      "DELETE FROM fridges WHERE id=? AND EXISTS (SELECT 1 FROM fridge_members WHERE fridge_id=? AND email=? AND role='owner')",
    )
    .bind(fridgeId, fridgeId, actorEmail)
    .run();
  if (!removed.meta.changes) return false;
  let cursor: string | undefined;
  const prefix = `food_crops/${fridgeId}/`;
  do {
    const listed = await photos.list({ prefix, cursor });
    if (listed.objects.length > 0) {
      await photos.delete(listed.objects.map((obj) => obj.key));
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  return true;
}
