import { sha256Hex } from "./gateway";

export type MemberRole = "owner" | "member";

export interface FridgeSummary {
  id: string;
  name: string;
  role: MemberRole;
  last_seen_s: number;
  last_telemetry: unknown;
}

export interface FridgeMemberRow {
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

export function generateGatewayToken(): string {
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
      `SELECT f.id, f.name, fm.role, f.last_seen_s, f.last_telemetry_json
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
    }>();

  return results.map((row) => ({
    id: row.id,
    name: row.name,
    role: row.role,
    last_seen_s: row.last_seen_s,
    last_telemetry: parseJsonOrNull(row.last_telemetry_json),
  }));
}

export async function createFridge(
  db: D1Database,
  ownerEmail: string,
  name: string,
  nowS: number,
): Promise<{ id: string; name: string; role: MemberRole }> {
  const id = generateFridgeId(name);
  const gatewayToken = generateGatewayToken();
  const gatewayTokenHash = await sha256Hex(gatewayToken);

  await db.batch([
    db
      .prepare("INSERT INTO fridges (id, name, created_at_s) VALUES (?, ?, ?)")
      .bind(id, name, nowS),
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
): Promise<FridgeSettings | null> {
  const fridge = await db
    .prepare(
      `SELECT f.id, f.name, f.line_target_id, fs.gateway_token, fs.gemini_api_key
       FROM fridges f
       INNER JOIN fridge_secrets fs ON fs.fridge_id = f.id
       WHERE f.id = ?`,
    )
    .bind(fridgeId)
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
  patch: {
    name?: string;
    line_target_id?: string | null;
    gemini_api_key?: string | null;
  },
  nowS: number,
): Promise<void> {
  const statements: D1PreparedStatement[] = [];

  if (patch.name !== undefined || patch.line_target_id !== undefined) {
    if (patch.name !== undefined && patch.line_target_id !== undefined) {
      statements.push(
        db
          .prepare(
            "UPDATE fridges SET name = ?, line_target_id = ? WHERE id = ?",
          )
          .bind(patch.name, patch.line_target_id, fridgeId),
      );
    } else if (patch.name !== undefined) {
      statements.push(
        db
          .prepare("UPDATE fridges SET name = ? WHERE id = ?")
          .bind(patch.name, fridgeId),
      );
    } else if (patch.line_target_id !== undefined) {
      statements.push(
        db
          .prepare("UPDATE fridges SET line_target_id = ? WHERE id = ?")
          .bind(patch.line_target_id, fridgeId),
      );
    }
  }

  if (patch.gemini_api_key !== undefined) {
    statements.push(
      db
        .prepare(
          "UPDATE fridge_secrets SET gemini_api_key = ?, updated_at_s = ? WHERE fridge_id = ?",
        )
        .bind(patch.gemini_api_key, nowS, fridgeId),
    );
  }

  if (statements.length > 0) {
    await db.batch(statements);
  }
}

export async function rotateGatewayToken(
  db: D1Database,
  fridgeId: string,
  nowS: number,
): Promise<string> {
  const gatewayToken = generateGatewayToken();
  const gatewayTokenHash = await sha256Hex(gatewayToken);
  await db
    .prepare(
      "UPDATE fridge_secrets SET gateway_token = ?, gateway_token_hash = ?, updated_at_s = ? WHERE fridge_id = ?",
    )
    .bind(gatewayToken, gatewayTokenHash, nowS, fridgeId)
    .run();
  return gatewayToken;
}

export async function upsertFridgeMember(
  db: D1Database,
  fridgeId: string,
  email: string,
  role: MemberRole,
  nowS: number,
): Promise<"ok" | "last_owner"> {
  if (role === "member") {
    const owners = await db
      .prepare(
        "SELECT email FROM fridge_members WHERE fridge_id = ? AND role = 'owner'",
      )
      .bind(fridgeId)
      .all<{ email: string }>();
    if (owners.results.length === 1 && owners.results[0]?.email === email) {
      return "last_owner";
    }
  }

  await db
    .prepare(
      `INSERT INTO fridge_members (fridge_id, email, role, added_at_s)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(fridge_id, email) DO UPDATE SET role = excluded.role`,
    )
    .bind(fridgeId, email, role, nowS)
    .run();

  return "ok";
}

export async function removeFridgeMember(
  db: D1Database,
  fridgeId: string,
  email: string,
): Promise<"deleted" | "not_found" | "last_owner"> {
  const target = await getMemberRole(db, fridgeId, email);
  if (!target) return "not_found";

  if (target === "owner") {
    const owners = await db
      .prepare(
        "SELECT COUNT(*) AS count FROM fridge_members WHERE fridge_id = ? AND role = 'owner'",
      )
      .bind(fridgeId)
      .first<{ count: number }>();
    if ((owners?.count ?? 0) <= 1) {
      return "last_owner";
    }
  }

  await db
    .prepare("DELETE FROM fridge_members WHERE fridge_id = ? AND email = ?")
    .bind(fridgeId, email)
    .run();
  return "deleted";
}

export async function deleteFridge(
  db: D1Database,
  photos: R2Bucket,
  fridgeId: string,
): Promise<void> {
  let cursor: string | undefined;
  const prefix = `food_crops/${fridgeId}/`;
  do {
    const listed = await photos.list({ prefix, cursor });
    if (listed.objects.length > 0) {
      await photos.delete(listed.objects.map((obj) => obj.key));
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  await db.prepare("DELETE FROM fridges WHERE id = ?").bind(fridgeId).run();
}
