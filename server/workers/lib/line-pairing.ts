import type { AppBindings } from "../types";
import type { AuthenticatedUser } from "./auth";
import { sha256Hex } from "./gateway";
import { notifyFridgeRoom } from "./room";

export class LinePairingError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 409 | 429 | 503,
  ) {
    super(message);
  }
}
export function lineReady(env: AppBindings): boolean {
  return Boolean(
    env.LINE_CHANNEL_SECRET?.trim() && env.LINE_CHANNEL_ACCESS_TOKEN?.trim(),
  );
}
export function lineFriendUrl(env: AppBindings): string | null {
  const id = env.LINE_BOT_BASIC_ID?.trim();
  return id && /^@[a-zA-Z0-9_.-]{2,64}$/.test(id)
    ? `https://line.me/R/ti/p/${encodeURIComponent(id)}`
    : null;
}
export async function readLimitedBody(
  request: Request,
  limit: number,
): Promise<Uint8Array | null> {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > limit) {
        await reader.cancel();
        return null;
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
export async function verifyLineSignature(
  body: Uint8Array,
  signature: string | null,
  secret: string,
): Promise<boolean> {
  if (!signature || !/^[A-Za-z0-9+/]{43}=$/.test(signature)) return false;
  try {
    const bytes = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0));
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify("HMAC", key, bytes, new Uint8Array(body));
  } catch {
    return false;
  }
}
const validIssuer = `EXISTS (SELECT 1 FROM session s JOIN user u ON u.id=s.userId
  WHERE s.id=line_pairing_codes.session_id AND u.id=line_pairing_codes.user_id AND u.emailVerified=1
  AND (CASE WHEN typeof(s.expiresAt) IN ('integer','real') THEN CASE WHEN s.expiresAt >= 1000000000000 THEN s.expiresAt/1000 ELSE s.expiresAt END ELSE unixepoch(s.expiresAt) END) > ?
  AND (scope='user' OR EXISTS (SELECT 1 FROM fridge_members fm WHERE fm.fridge_id=line_pairing_codes.fridge_id AND fm.email=lower(trim(u.email)) AND fm.role='owner')))`;

export async function createPairingCode(
  env: AppBindings,
  user: AuthenticatedUser,
  fridgeId: string | null,
  nowS: number,
) {
  if (!lineReady(env))
    throw new LinePairingError("LINE connection is not configured yet.", 503);
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const random = crypto.getRandomValues(new Uint8Array(8));
  const compact = Array.from(random, (n) => alphabet[n & 31]).join("");
  const code = `FW-${compact.slice(0, 4)}-${compact.slice(4)}`;
  const hash = await sha256Hex(code);
  const scope = fridgeId ? "fridge" : "user";
  const [insert] = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO line_pairing_codes(code_hash,scope,user_id,session_id,fridge_id,created_at_s,expires_at_s)
      SELECT ?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM line_pairing_codes WHERE user_id=? AND created_at_s>=?) < 5
      AND (? IS NULL OR EXISTS(SELECT 1 FROM fridge_members fm JOIN user u ON lower(trim(u.email))=fm.email WHERE u.id=? AND fm.fridge_id=? AND fm.role='owner'))`,
    ).bind(
      hash,
      scope,
      user.id,
      user.sessionId,
      fridgeId,
      nowS,
      nowS + 600,
      user.id,
      nowS - 600,
      fridgeId,
      user.id,
      fridgeId,
    ),
    env.DB.prepare(
      `UPDATE line_pairing_codes SET revoked=1 WHERE user_id=? AND scope=? AND fridge_id IS ? AND code_hash!=? AND EXISTS(SELECT 1 FROM line_pairing_codes WHERE code_hash=?)`,
    ).bind(user.id, scope, fridgeId, hash, hash),
  ]);
  if (!insert?.meta.changes)
    throw new LinePairingError(
      "Too many connection codes. Try again in ten minutes.",
      429,
    );
  return { code, expires_at_s: nowS + 600, friend_url: lineFriendUrl(env) };
}
interface LineEvent {
  type?: string;
  webhookEventId?: string;
  replyToken?: string;
  timestamp?: number;
  message?: { type?: string; text?: string; id?: string };
  source?: {
    type?: string;
    userId?: string;
    groupId?: string;
    roomId?: string;
  };
}
function targetFrom(event: LineEvent): string | null {
  const source = event.source;
  const value =
    source?.type === "user"
      ? source.userId
      : source?.type === "group"
        ? source.groupId
        : source?.type === "room"
          ? source.roomId
          : null;
  return typeof value === "string" && /^[UCR][a-f0-9]{32}$/i.test(value)
    ? value
    : null;
}
async function reply(env: AppBindings, event: LineEvent, message: string) {
  if (!event.replyToken || event.replyToken.length > 256) return;
  try {
    const response = await fetch(
      `${env.LINE_API_BASE_URL?.replace(/\/+$/, "") || "https://api.line.me"}/v2/bot/message/reply`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN?.trim()}`,
        },
        signal: AbortSignal.timeout(10_000),
        body: JSON.stringify({
          replyToken: event.replyToken,
          messages: [{ type: "text", text: message }],
        }),
      },
    );
    await response.body?.cancel();
  } catch {
    /* Pairing is committed; the browser's status remains authoritative. */
  }
}
export async function processLineWebhook(
  env: AppBindings,
  payload: unknown,
  nowS: number,
): Promise<void> {
  if (
    !payload ||
    typeof payload !== "object" ||
    !Array.isArray((payload as { events?: unknown }).events)
  )
    throw new LinePairingError("Invalid webhook payload.", 400);
  for (const value of (payload as { events: unknown[] }).events) {
    if (!value || typeof value !== "object") continue;
    const event = value as LineEvent;
    const eventAt = event.timestamp;
    if (
      typeof eventAt !== "number" ||
      !Number.isSafeInteger(eventAt) ||
      eventAt < 0
    )
      continue;
    if (event.type === "unfollow" || event.type === "leave") {
      await processLifecycle(env, event, nowS);
      continue;
    }
    if (
      event.type !== "message" ||
      event.message?.type !== "text" ||
      typeof event.message.text !== "string"
    )
      continue;
    const code = event.message.text.trim().toUpperCase();
    if (!/^FW-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(code)) continue;
    const target = targetFrom(event);
    if (!target) continue;
    const eventId = event.webhookEventId || event.message.id;
    if (typeof eventId !== "string" || eventId.length > 128) continue;
    const sourceHash = await sha256Hex(event.source?.userId || target);
    const receipt = await env.DB.prepare(
      `INSERT INTO line_webhook_attempts(event_id,source_hash,created_at_s)
      SELECT ?,?,? WHERE (SELECT COUNT(*) FROM line_webhook_attempts WHERE receipt_kind='pairing' AND source_hash=? AND created_at_s>=?)<10
      AND (SELECT COUNT(*) FROM line_webhook_attempts WHERE receipt_kind='pairing' AND created_at_s>=?)<200 ON CONFLICT DO NOTHING`,
    )
      .bind(eventId, sourceHash, nowS, sourceHash, nowS - 600, nowS - 600)
      .run();
    if (!receipt.meta.changes) {
      const previous = await env.DB.prepare(
        "SELECT processed FROM line_webhook_attempts WHERE event_id=?",
      )
        .bind(eventId)
        .first<{ processed: number }>();
      if (!previous || previous.processed) continue;
    }
    const hash = await sha256Hex(code);
    const nonce = crypto.randomUUID();
    const [claim] = await env.DB.batch([
      env.DB.prepare(
        `UPDATE line_pairing_codes SET consumed_nonce=?,target_id=? WHERE code_hash=? AND revoked=0 AND consumed_nonce IS NULL AND expires_at_s>? AND ${validIssuer}
        AND ? > COALESCE((SELECT timestamp_ms FROM line_target_resets WHERE target_id=?),0)
        AND (scope!='user' OR ? >= COALESCE((SELECT line_linked_at_ms FROM user_line_profiles WHERE user_id=line_pairing_codes.user_id),0))
        AND (scope!='fridge' OR ? >= COALESCE((SELECT line_linked_at_ms FROM fridges WHERE id=line_pairing_codes.fridge_id),0))
        AND (scope='fridge' OR ?='user') AND (scope!='user' OR NOT EXISTS(SELECT 1 FROM user_line_profiles p WHERE p.line_user_id=? AND p.user_id!=line_pairing_codes.user_id))`,
      ).bind(
        nonce,
        target,
        hash,
        nowS,
        nowS,
        eventAt,
        target,
        eventAt,
        eventAt,
        event.source?.type ?? "",
        target,
      ),
      env.DB.prepare(
        `UPDATE fridges SET line_target_id=?,line_linked_at_ms=? WHERE id=(SELECT fridge_id FROM line_pairing_codes WHERE code_hash=? AND consumed_nonce=? AND scope='fridge')`,
      ).bind(target, eventAt, hash, nonce),
      env.DB.prepare(
        `INSERT INTO user_line_profiles(user_id,line_user_id,updated_at_s,line_linked_at_ms) SELECT user_id,?,?,? FROM line_pairing_codes WHERE code_hash=? AND consumed_nonce=? AND scope='user'
        ON CONFLICT(user_id) DO UPDATE SET line_user_id=excluded.line_user_id,updated_at_s=excluded.updated_at_s,line_linked_at_ms=excluded.line_linked_at_ms`,
      ).bind(target, nowS, eventAt, hash, nonce),
      env.DB.prepare(
        "UPDATE user_line_outbox SET failed=1 WHERE user_id=(SELECT user_id FROM line_pairing_codes WHERE code_hash=? AND consumed_nonce=? AND scope='user') AND delivered_s IS NULL",
      ).bind(hash, nonce),
      env.DB.prepare(
        "UPDATE line_outbox SET failed=1 WHERE fridge_id=(SELECT fridge_id FROM line_pairing_codes WHERE code_hash=? AND consumed_nonce=? AND scope='fridge')",
      ).bind(hash, nonce),
      env.DB.prepare(
        "UPDATE line_webhook_attempts SET processed=1 WHERE event_id=?",
      ).bind(eventId),
    ]);
    if (!claim?.meta.changes) {
      await reply(
        env,
        event,
        "รหัสไม่ถูกต้อง หมดอายุ หรือใช้แล้ว กรุณาสร้างรหัสใหม่ใน FoodWarden และส่งรหัสส่วนตัวในแชทกับบอทเท่านั้น",
      );
      continue;
    }
    const paired = await env.DB.prepare(
      `SELECT c.scope, c.fridge_id, f.name AS fridge_name, u.name AS user_name, u.email AS user_email
       FROM line_pairing_codes c
       LEFT JOIN fridges f ON f.id = c.fridge_id
       LEFT JOIN user u ON u.id = c.user_id
       WHERE c.code_hash=? AND c.consumed_nonce=?`,
    )
      .bind(hash, nonce)
      .first<{
        scope: "fridge" | "user";
        fridge_id: string | null;
        fridge_name: string | null;
        user_name: string | null;
        user_email: string | null;
      }>();
    if (paired?.fridge_id)
      await notifyFridgeRoom(env, paired.fridge_id, {
        type: "line_settings_changed",
      });
    const replyText =
      paired?.scope === "fridge"
        ? `🏠 [LINE ของตู้เย็น · ${
            paired.fridge_name
              ? `${paired.fridge_name} (รหัสตู้: ${paired.fridge_id})`
              : (paired.fridge_id ?? "ตู้เย็น")
          }]\nเชื่อมต่อ FoodWarden สำเร็จแล้ว ✅ การแจ้งเตือนส่วนกลางของตู้เย็นนี้จะส่งมาที่แชทนี้ กลับไปที่หน้าเว็บเพื่อดูสถานะและส่งข้อความทดสอบได้เลย`
        : `👤 [LINE ส่วนตัว · บัญชี ${
            paired?.user_name
              ? `${paired.user_name} (${paired.user_email})`
              : (paired?.user_email ?? "บัญชีของคุณ")
          }]\nเชื่อมต่อ FoodWarden สำเร็จแล้ว ✅ การแจ้งเตือนส่วนตัวจากทุกตู้เย็นในบัญชีของคุณจะส่งมาที่แชทนี้ กลับไปที่หน้าเว็บเพื่อดูสถานะและส่งข้อความทดสอบได้เลย`;
    await reply(env, event, replyText);
  }
}

async function processLifecycle(
  env: AppBindings,
  event: LineEvent,
  nowS: number,
): Promise<void> {
  const target = targetFrom(event);
  const eventId = event.webhookEventId;
  const at = event.timestamp;
  const personal = event.type === "unfollow" && event.source?.type === "user";
  const group =
    event.type === "leave" &&
    (event.source?.type === "group" || event.source?.type === "room");
  if (
    !target ||
    typeof eventId !== "string" ||
    !eventId ||
    eventId.length > 128 ||
    typeof at !== "number" ||
    !Number.isSafeInteger(at) ||
    (!personal && !group)
  )
    return;
  const receipt = env.DB.prepare(
    "INSERT INTO line_webhook_attempts(event_id,source_hash,created_at_s,receipt_kind) VALUES(?,?,?,'lifecycle') ON CONFLICT DO NOTHING",
  ).bind(eventId, await sha256Hex(target), nowS);
  const guard =
    " AND EXISTS(SELECT 1 FROM line_webhook_attempts WHERE event_id=? AND receipt_kind='lifecycle' AND processed=0)";
  const watermark = env.DB.prepare(
    "INSERT INTO line_target_resets(target_id,timestamp_ms) VALUES(?,?) ON CONFLICT(target_id) DO UPDATE SET timestamp_ms=MAX(timestamp_ms,excluded.timestamp_ms)",
  ).bind(target, at);
  const done = env.DB.prepare(
    "UPDATE line_webhook_attempts SET processed=1 WHERE event_id=?",
  ).bind(eventId);
  if (personal) {
    await env.DB.batch([
      receipt,
      watermark,
      env.DB.prepare(
        "UPDATE user_line_outbox SET failed=1 WHERE delivered_s IS NULL AND user_id IN (SELECT user_id FROM user_line_profiles WHERE line_user_id=? AND line_linked_at_ms<=?)" +
          guard,
      ).bind(target, at, eventId),
      env.DB.prepare(
        "UPDATE line_pairing_codes SET revoked=1 WHERE scope='user' AND user_id IN (SELECT user_id FROM user_line_profiles WHERE line_user_id=? AND line_linked_at_ms<=?)" +
          guard,
      ).bind(target, at, eventId),
      env.DB.prepare(
        "UPDATE user_line_profiles SET line_user_id=NULL,updated_at_s=?,line_linked_at_ms=? WHERE line_user_id=? AND line_linked_at_ms<=?" +
          guard,
      ).bind(nowS, at, target, at, eventId),
      done,
    ]);
    return;
  }
  const affected = await env.DB.prepare(
    "SELECT id FROM fridges WHERE line_target_id=? AND line_linked_at_ms<=?",
  )
    .bind(target, at)
    .all<{ id: string }>();
  await env.DB.batch([
    receipt,
    watermark,
    env.DB.prepare(
      "UPDATE line_outbox SET failed=1 WHERE fridge_id IN (SELECT id FROM fridges WHERE line_target_id=? AND line_linked_at_ms<=?)" +
        guard,
    ).bind(target, at, eventId),
    env.DB.prepare(
      "UPDATE line_pairing_codes SET revoked=1 WHERE scope='fridge' AND fridge_id IN (SELECT id FROM fridges WHERE line_target_id=? AND line_linked_at_ms<=?)" +
        guard,
    ).bind(target, at, eventId),
    env.DB.prepare(
      "UPDATE fridges SET line_target_id=NULL,line_linked_at_ms=? WHERE line_target_id=? AND line_linked_at_ms<=?" +
        guard,
    ).bind(at, target, at, eventId),
    done,
  ]);
  await Promise.all(
    affected.results.map((row) =>
      notifyFridgeRoom(env, row.id, { type: "line_settings_changed" }),
    ),
  );
}
