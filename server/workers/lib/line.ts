import { LinePairingError } from "./line-pairing";
import { retireUnreferencedPhoto } from "./storage";
import type { AppBindings } from "../types";
import type { DoorEvent, DoorEventStatus } from "./door-events";
import { addDaysToIsoDate, bangkokIsoDate } from "./gemini";
import {
  LINE_MAX_MESSAGES_PER_REQUEST,
  LINE_MAX_TEXT_LENGTH,
  capLineText,
} from "./line-format";
import type { TelemetrySample } from "./telemetry";

const DEFAULT_LINE_BASE_URL = "https://api.line.me";
const DOOR_ALERT_COOLDOWN_S = 300;
const TELEMETRY_ALERT_COOLDOWN_S = 1800;
const DAILY_DIGEST_COOLDOWN_S = 20 * 3600;
const ORPHAN_CROP_MAX_AGE_S = 86_400;

interface LineTextMessage {
  type: "text";
  text: string;
}

interface FridgeAlertConfig {
  id: string;
  name: string;
  line_target_id: string;
}

const DOOR_ALERT_META: Partial<
  Record<
    DoorEventStatus,
    {
      alertType: string;
      message: (fridgeName: string, fridgeId: string, nodeId: string) => string;
    }
  >
> = {
  OBSTRUCTION_ERROR: {
    alertType: "door_obstruction",
    message: (fridgeName, fridgeId, nodeId) =>
      `⚠️ 🏠 [${fridgeName} · รหัสตู้: ${fridgeId}] Door obstruction detected (${nodeId}). Motor stopped and retracted safely.\nตรวจพบสิ่งกีดขวางขณะปิดประตูตู้เย็น (${nodeId}) ระบบหยุดและถอยแขนกลเพื่อความปลอดภัยแล้ว`,
  },
  TIMEOUT_ERROR: {
    alertType: "door_timeout",
    message: (fridgeName, fridgeId, nodeId) =>
      `⏱️ 🏠 [${fridgeName} · รหัสตู้: ${fridgeId}] Door closer timed out (${nodeId}). Please check that the door can shut cleanly.\nแขนกลปิดประตูใช้เวลาเกินกำหนด (${nodeId}) กรุณาตรวจสอบว่าประตูไม่มีสิ่งกีดขวาง`,
  },
  FAULT_LOCKOUT: {
    alertType: "door_fault_lockout",
    message: (fridgeName, fridgeId, nodeId) =>
      `🛑 🏠 [${fridgeName} · รหัสตู้: ${fridgeId}] Door actuator entered safety fault lockout (${nodeId}). Manual inspection required.\nระบบปิดประตูเข้าสู่โหมดนิรภัย (${nodeId}) กรุณาตรวจสอบอุปกรณ์`,
  },
  CONTRADICTION_ERROR: {
    alertType: "door_contradiction",
    message: (fridgeName, fridgeId, nodeId) =>
      `💡 🏠 [${fridgeName} · รหัสตู้: ${fridgeId}] Door closed sensor disagrees with interior light sensor (${nodeId}). Seal may still be ajar.\nเซนเซอร์ประตูปิดขัดแย้งกับไฟภายในตู้ (${nodeId}) กรุณาตรวจสอบว่าประตูปิดสนิท`,
  },
};

export async function tryAcquireAlertCooldown(
  db: D1Database,
  fridgeId: string,
  alertType: string,
  nowS: number,
  cooldownS: number,
): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT INTO alert_cooldowns (fridge_id, alert_type, last_sent_s)
       VALUES (?, ?, ?)
       ON CONFLICT (fridge_id, alert_type) DO UPDATE
       SET last_sent_s = excluded.last_sent_s
       WHERE excluded.last_sent_s - alert_cooldowns.last_sent_s >= ?`,
    )
    .bind(fridgeId, alertType, nowS, cooldownS)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

async function sendLinePush(
  env: AppBindings,
  targetId: string,
  messages: LineTextMessage[],
  retryKey: string,
): Promise<"accepted" | "retry" | "rejected"> {
  const token = env.LINE_CHANNEL_ACCESS_TOKEN?.trim();
  const to = targetId.trim();
  if (!token || !to || messages.length === 0) return "retry";

  const baseUrl = (
    env.LINE_API_BASE_URL?.trim() || DEFAULT_LINE_BASE_URL
  ).replace(/\/+$/, "");
  try {
    const response = await fetch(`${baseUrl}/v2/bot/message/push`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "X-Line-Retry-Key": retryKey,
      },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        to,
        messages: messages
          .slice(0, LINE_MAX_MESSAGES_PER_REQUEST)
          .map((msg) => ({
            type: "text",
            text: capLineText(msg.text, LINE_MAX_TEXT_LENGTH),
          })),
      }),
    });
    const ok =
      response.ok ||
      (response.status === 409 &&
        response.headers.has("x-line-accepted-request-id"));
    await response.body?.cancel();
    return ok
      ? "accepted"
      : response.status >= 500 || response.status === 429
        ? "retry"
        : "rejected";
  } catch {
    return "retry";
  }
}

async function getFridgeAlertConfig(
  db: D1Database,
  fridgeId: string,
): Promise<FridgeAlertConfig | null> {
  const row = await db
    .prepare("SELECT id, name, line_target_id FROM fridges WHERE id = ?")
    .bind(fridgeId)
    .first<{ id: string; name: string; line_target_id: string | null }>();
  const target = row?.line_target_id?.trim();
  if (!row || !target) return null;
  return { id: row.id, name: row.name, line_target_id: target };
}

export async function maybeSendDoorSafetyAlerts(
  env: AppBindings,
  fridgeId: string,
  events: DoorEvent[],
  nowS: number,
): Promise<number> {
  if (!env.LINE_CHANNEL_ACCESS_TOKEN?.trim()) return 0;
  const criticalEvents = events.filter((ev) => DOOR_ALERT_META[ev.status]);
  if (criticalEvents.length === 0) return 0;

  const config = await getFridgeAlertConfig(env.DB, fridgeId);
  if (!config) return 0;

  const seenStatuses = new Set<DoorEventStatus>();
  let sentCount = 0;

  for (const event of criticalEvents) {
    if (seenStatuses.has(event.status)) continue;
    seenStatuses.add(event.status);

    const meta = DOOR_ALERT_META[event.status];
    if (!meta) continue;

    const sent = await queueLineAlert(
      env,
      fridgeId,
      meta.alertType,
      config.line_target_id,
      [
        {
          type: "text",
          text: meta.message(config.name, config.id, event.node_id),
        },
      ],
      nowS,
      DOOR_ALERT_COOLDOWN_S,
      criticalEvents
        .filter((e) => e.status === event.status)
        .map((e) => JSON.stringify([e.node_id, e.timestamp_s, e.status])),
    );
    if (sent) sentCount += 1;
  }

  return sentCount;
}

export async function maybeSendTelemetryAlerts(
  env: AppBindings,
  fridgeId: string,
  samples: TelemetrySample[],
  nowS: number,
): Promise<number> {
  if (!env.LINE_CHANNEL_ACCESS_TOKEN?.trim() || samples.length === 0) return 0;

  let maxVoc: number | null = null;
  let maxTemp: number | null = null;
  for (const sample of samples) {
    if (
      sample.voc_index !== null &&
      (maxVoc === null || sample.voc_index > maxVoc)
    ) {
      maxVoc = sample.voc_index;
    }
    if (
      sample.temp_celsius !== null &&
      (maxTemp === null || sample.temp_celsius > maxTemp)
    ) {
      maxTemp = sample.temp_celsius;
    }
  }

  const pending: Array<{ alertType: string; text: string }> = [];
  if (maxVoc !== null && maxVoc >= 250) {
    pending.push({
      alertType: "voc_high",
      text: "",
    });
  }
  if (maxTemp !== null && maxTemp > 8.0) {
    pending.push({
      alertType: "temp_high",
      text: "",
    });
  }
  if (pending.length === 0) return 0;

  const config = await getFridgeAlertConfig(env.DB, fridgeId);
  if (!config) return 0;

  let sentCount = 0;
  for (const alert of pending) {
    const text =
      alert.alertType === "voc_high"
        ? `🚨 🏠 [${config.name} · รหัสตู้: ${config.id}] High VOC spoilage index detected (${maxVoc}). Please inspect fridge contents.\nตรวจพบค่าก๊าซ VOC สูงผิดปกติ (${maxVoc}) อาจมีอาหารเริ่มเน่าเสีย กรุณาตรวจสอบภายในตู้เย็น`
        : `🌡️ 🏠 [${config.name} · รหัสตู้: ${config.id}] High fridge temperature detected (${maxTemp!.toFixed(1)}°C > 8.0°C). Check door seal & cooling.\nอุณหภูมิในตู้เย็นสูงเกินเกณฑ์ปลอดภัย (${maxTemp!.toFixed(1)}°C) กรุณาตรวจสอบการปิดประตูและระบบทำความเย็น`;

    const sent = await queueLineAlert(
      env,
      fridgeId,
      alert.alertType,
      config.line_target_id,
      [{ type: "text", text }],
      nowS,
      TELEMETRY_ALERT_COOLDOWN_S,
      samples
        .filter((sample) =>
          alert.alertType === "voc_high"
            ? sample.voc_index !== null && sample.voc_index >= 250
            : sample.temp_celsius !== null && sample.temp_celsius > 8,
        )
        .map((sample) => JSON.stringify([sample.node_id, sample.timestamp_s])),
    );
    if (sent) sentCount += 1;
  }

  return sentCount;
}

async function cleanupOrphanedFoodCrops(
  db: D1Database,
  photos: R2Bucket,
  nowS: number,
): Promise<number> {
  const { results } = await db
    .prepare(
      "SELECT image_storage_path FROM inventory WHERE image_storage_path IS NOT NULL",
    )
    .all<{ image_storage_path: string }>();

  const referencedKeys = new Set(
    results.map((row) => row.image_storage_path.replace(/^\/storage\//, "")),
  );

  const staleKeys: string[] = [];
  let cursor: string | undefined;

  while (true) {
    const page = await photos.list({
      prefix: "food_crops/",
      limit: 1000,
      ...(cursor ? { cursor } : {}),
    });

    for (const obj of page.objects) {
      if (referencedKeys.has(obj.key)) continue;
      const uploadedS = Math.floor(obj.uploaded.getTime() / 1000);
      if (nowS - uploadedS >= ORPHAN_CROP_MAX_AGE_S) {
        staleKeys.push(obj.key);
      }
    }

    if (!page.truncated || !page.cursor) break;
    cursor = page.cursor;
  }

  let deletedCount = 0;
  for (let i = 0; i < staleKeys.length; i += 1000) {
    const batch = staleKeys.slice(i, i + 1000);
    for (const key of batch) {
      if (await retireUnreferencedPhoto(db, photos, key)) deletedCount++;
    }
  }
  return deletedCount;
}

async function dispatchDailyExpiryDigests(
  env: AppBindings,
  nowS: number,
): Promise<number> {
  if (!env.LINE_CHANNEL_ACCESS_TOKEN?.trim()) return 0;

  const { results: fridges } = await env.DB.prepare(
    `SELECT id, name, line_target_id
     FROM fridges
     WHERE line_target_id IS NOT NULL AND trim(line_target_id) != ''`,
  ).all<FridgeAlertConfig>();

  if (fridges.length === 0) return 0;

  const today = bangkokIsoDate(nowS);
  const cutoff = addDaysToIsoDate(today, 2);
  let sentFridges = 0;

  for (const fridge of fridges) {
    const { results: items } = await env.DB.prepare(
      `SELECT name_th, name_en, estimated_expiry_date
       FROM inventory
       WHERE fridge_id = ? AND estimated_expiry_date <= ?
       ORDER BY estimated_expiry_date ASC, check_in_timestamp_s ASC`,
    )
      .bind(fridge.id, cutoff)
      .all<{
        name_th: string;
        name_en: string;
        estimated_expiry_date: string;
      }>();

    if (items.length === 0) continue;

    const lines = items.slice(0, 10).map((item) => {
      const status =
        item.estimated_expiry_date < today
          ? "หมดอายุแล้ว / Expired"
          : item.estimated_expiry_date === today
            ? "หมดอายุวันนี้ / Today"
            : `หมดอายุ ${item.estimated_expiry_date}`;
      const label =
        item.name_th === item.name_en
          ? item.name_en
          : `${item.name_th} (${item.name_en})`;
      return `• ${label} — ${status}`;
    });

    if (items.length > 10) {
      lines.push(
        `...และอีก ${items.length - 10} รายการ / +${items.length - 10} more`,
      );
    }

    const message = [
      `🥬 🏠 [${fridge.name} · รหัสตู้: ${fridge.id}] Daily FEFO Expiry Digest (${today})`,
      `สรุปรายการอาหารใกล้หมดอายุ / หมดอายุแล้ว (${items.length} รายการ):`,
      ...lines,
    ].join("\n");

    const sent = await queueLineAlert(
      env,
      fridge.id,
      "daily_expiry_digest",
      fridge.line_target_id,
      [{ type: "text", text: message }],
      nowS,
      DAILY_DIGEST_COOLDOWN_S,
      [today],
    );
    if (sent) sentFridges += 1;
  }

  return sentFridges;
}

export async function runDailyCronTasks(
  env: AppBindings,
  nowS: number,
): Promise<{ deletedCrops: number; digestsSent: number }> {
  const [cropOutcome, digestOutcome] = await Promise.allSettled([
    cleanupOrphanedFoodCrops(env.DB, env.PHOTOS, nowS),
    dispatchDailyExpiryDigests(env, nowS),
  ]);

  return {
    deletedCrops: cropOutcome.status === "fulfilled" ? cropOutcome.value : 0,
    digestsSent: digestOutcome.status === "fulfilled" ? digestOutcome.value : 0,
  };
}

async function queueLineAlert(
  env: AppBindings,
  fridgeId: string,
  alertType: string,
  targetId: string,
  messages: LineTextMessage[],
  nowS: number,
  cooldownS: number,
  eventKeys: string[],
): Promise<boolean> {
  const boundedMessages = messages
    .slice(0, LINE_MAX_MESSAGES_PER_REQUEST)
    .map((msg) => ({
      type: "text" as const,
      text: capLineText(msg.text, LINE_MAX_TEXT_LENGTH),
    }));
  const id = crypto.randomUUID();
  const [insert] = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO line_outbox (id, fridge_id, alert_type, target_id, messages_json, created_s, next_attempt_s)
      SELECT ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS
      (SELECT 1 FROM alert_cooldowns WHERE fridge_id = ? AND alert_type = ? AND ? - last_sent_s < ?)
      AND NOT EXISTS (SELECT 1 FROM line_outbox WHERE fridge_id = ? AND alert_type = ? AND failed = 0)
      AND EXISTS (SELECT 1 FROM json_each(?) e WHERE NOT EXISTS (SELECT 1 FROM line_alert_events WHERE fridge_id = ? AND alert_type = ? AND event_key = e.value))`,
    ).bind(
      id,
      fridgeId,
      alertType,
      targetId,
      JSON.stringify(boundedMessages),
      nowS,
      nowS,
      fridgeId,
      alertType,
      nowS,
      cooldownS,
      fridgeId,
      alertType,
      JSON.stringify(eventKeys),
      fridgeId,
      alertType,
    ),
    env.DB.prepare(
      `INSERT INTO alert_cooldowns(fridge_id, alert_type, last_sent_s)
      SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM line_outbox WHERE id = ?)
      ON CONFLICT(fridge_id, alert_type) DO UPDATE SET last_sent_s = excluded.last_sent_s`,
    ).bind(fridgeId, alertType, nowS, id),
    env.DB.prepare(
      "INSERT INTO line_alert_events (fridge_id, alert_type, event_key) SELECT ?, ?, value FROM json_each(?) WHERE true ON CONFLICT DO NOTHING",
    ).bind(fridgeId, alertType, JSON.stringify(eventKeys)),
  ]);
  if (!insert?.meta.changes) return false;
  return (await dispatchLineOutbox(env, nowS, id)) > 0;
}

export async function dispatchLineOutbox(
  env: AppBindings,
  nowS: number,
  onlyId?: string,
): Promise<number> {
  if (!env.LINE_CHANNEL_ACCESS_TOKEN?.trim()) return 0;
  const { results: pending } = await env.DB.prepare(
    "SELECT id FROM line_outbox WHERE failed = 0 AND next_attempt_s <= ? AND lease_until_s <= ? AND (? IS NULL OR id = ?) ORDER BY next_attempt_s LIMIT 50",
  )
    .bind(nowS, nowS, onlyId ?? null, onlyId ?? null)
    .all<{ id: string }>();
  let sent = 0;
  for (const { id } of pending) {
    const lease = crypto.randomUUID();
    const row = await env.DB.prepare(
      "UPDATE line_outbox SET lease_until_s = ?, lease_token = ?, attempts = attempts + 1 WHERE id = ? AND failed = 0 AND lease_until_s <= ? AND next_attempt_s <= ? RETURNING target_id, messages_json, attempts, created_s",
    )
      .bind(nowS + 30, lease, id, nowS, nowS)
      .first<{
        target_id: string;
        messages_json: string;
        attempts: number;
        created_s: number;
      }>();
    if (!row) continue;
    // LINE retry keys expire at 24h. Retain expired attempts for inspection, never resend ambiguously accepted messages after expiry.
    if (nowS - row.created_s >= 23 * 3600) {
      await env.DB.prepare(
        "UPDATE line_outbox SET failed = 1, lease_until_s = 0 WHERE id = ? AND lease_token = ?",
      )
        .bind(id, lease)
        .run();
      continue;
    }
    const current = await env.DB.prepare(
      "SELECT line_target_id FROM fridges WHERE id = (SELECT fridge_id FROM line_outbox WHERE id = ?)",
    )
      .bind(id)
      .first<{ line_target_id: string | null }>();
    if (current?.line_target_id?.trim() !== row.target_id.trim()) {
      await env.DB.prepare(
        "UPDATE line_outbox SET failed = 1, lease_until_s = 0 WHERE id = ? AND lease_token = ?",
      )
        .bind(id, lease)
        .run();
      continue;
    }
    const ok = await sendLinePush(
      env,
      row.target_id,
      JSON.parse(row.messages_json) as LineTextMessage[],
      id,
    );
    if (ok === "accepted") {
      await env.DB.prepare(
        "DELETE FROM line_outbox WHERE id = ? AND lease_token = ?",
      )
        .bind(id, lease)
        .run();
      sent++;
    } else if (ok === "rejected") {
      await env.DB.prepare(
        "UPDATE line_outbox SET failed = 1, lease_until_s = 0 WHERE id = ? AND lease_token = ?",
      )
        .bind(id, lease)
        .run();
    } else {
      const next =
        nowS + Math.min(3600, 30 * 2 ** Math.min(row.attempts - 1, 7));
      await env.DB.prepare(
        "UPDATE line_outbox SET lease_until_s = 0, next_attempt_s = ? WHERE id = ? AND lease_token = ?",
      )
        .bind(next, id, lease)
        .run();
    }
  }
  return sent;
}
export async function enqueueFridgeLineTest(
  env: AppBindings,
  fridgeId: string,
  nowS: number,
): Promise<void> {
  const config = await getFridgeAlertConfig(env.DB, fridgeId);
  if (!config)
    throw new LinePairingError("Connect this fridge to LINE first.", 409);
  if (
    !(await tryAcquireAlertCooldown(
      env.DB,
      fridgeId,
      "line_test_request",
      nowS,
      60,
    ))
  )
    throw new LinePairingError(
      "Please wait one minute before another test.",
      429,
    );
  await queueLineAlert(
    env,
    fridgeId,
    "line_test",
    config.line_target_id,
    [
      {
        type: "text",
        text:
          `🏠 [LINE ของตู้เย็น · ${config.name} (รหัสตู้: ${config.id})]\n` +
          `เชื่อมต่อ FoodWarden แล้ว ✅ การแจ้งเตือนส่วนกลางของตู้เย็น "${config.name}" จะส่งมาที่แชทนี้`,
      },
    ],
    nowS,
    0,
    [crypto.randomUUID()],
  );
}
