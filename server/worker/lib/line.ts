import type { AppBindings } from "../types";
import type { DoorEvent, DoorEventStatus } from "./door-events";
import { addDaysToIsoDate, bangkokIsoDate } from "./gemini";
import type { TelemetrySample } from "./telemetry";

const DEFAULT_LINE_BASE_URL = "https://api.line.me";
const DOOR_ALERT_COOLDOWN_S = 300;
const TELEMETRY_ALERT_COOLDOWN_S = 1800;
const DAILY_DIGEST_COOLDOWN_S = 20 * 3600;
const ORPHAN_CROP_MAX_AGE_S = 86_400;

export interface LineTextMessage {
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
      message: (fridgeName: string, nodeId: string) => string;
    }
  >
> = {
  OBSTRUCTION_ERROR: {
    alertType: "door_obstruction",
    message: (fridgeName, nodeId) =>
      `⚠️ [${fridgeName}] Door obstruction detected (${nodeId}). Motor stopped and retracted safely.\nตรวจพบสิ่งกีดขวางขณะปิดประตูตู้เย็น (${nodeId}) ระบบหยุดและถอยแขนกลเพื่อความปลอดภัยแล้ว`,
  },
  TIMEOUT_ERROR: {
    alertType: "door_timeout",
    message: (fridgeName, nodeId) =>
      `⏱️ [${fridgeName}] Door closer timed out (${nodeId}). Please check that the door can shut cleanly.\nแขนกลปิดประตูใช้เวลาเกินกำหนด (${nodeId}) กรุณาตรวจสอบว่าประตูไม่มีสิ่งกีดขวาง`,
  },
  FAULT_LOCKOUT: {
    alertType: "door_fault_lockout",
    message: (fridgeName, nodeId) =>
      `🛑 [${fridgeName}] Door actuator entered safety fault lockout (${nodeId}). Manual inspection required.\nระบบปิดประตูเข้าสู่โหมดนิรภัย (${nodeId}) กรุณาตรวจสอบอุปกรณ์`,
  },
  CONTRADICTION_ERROR: {
    alertType: "door_contradiction",
    message: (fridgeName, nodeId) =>
      `💡 [${fridgeName}] Door closed sensor disagrees with interior light sensor (${nodeId}). Seal may still be ajar.\nเซนเซอร์ประตูปิดขัดแย้งกับไฟภายในตู้ (${nodeId}) กรุณาตรวจสอบว่าประตูปิดสนิท`,
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

export async function sendLinePush(
  env: AppBindings,
  targetId: string,
  messages: LineTextMessage[],
): Promise<boolean> {
  const token = env.LINE_CHANNEL_ACCESS_TOKEN?.trim();
  const to = targetId.trim();
  if (!token || !to || messages.length === 0) return false;

  const baseUrl = (
    env.LINE_API_BASE_URL?.trim() || DEFAULT_LINE_BASE_URL
  ).replace(/\/+$/, "");
  try {
    const response = await fetch(`${baseUrl}/v2/bot/message/push`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        to,
        messages: messages.slice(0, 5).map((msg) => ({
          type: "text",
          text: msg.text.slice(0, 5000),
        })),
      }),
    });
    const ok = response.ok;
    await response.body?.cancel();
    return ok;
  } catch {
    return false;
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

    const acquired = await tryAcquireAlertCooldown(
      env.DB,
      fridgeId,
      meta.alertType,
      nowS,
      DOOR_ALERT_COOLDOWN_S,
    );
    if (!acquired) continue;

    const sent = await sendLinePush(env, config.line_target_id, [
      { type: "text", text: meta.message(config.name, event.node_id) },
    ]);
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
    const acquired = await tryAcquireAlertCooldown(
      env.DB,
      fridgeId,
      alert.alertType,
      nowS,
      TELEMETRY_ALERT_COOLDOWN_S,
    );
    if (!acquired) continue;

    const text =
      alert.alertType === "voc_high"
        ? `🚨 [${config.name}] High VOC spoilage index detected (${maxVoc}). Please inspect fridge contents.\nตรวจพบค่าก๊าซ VOC สูงผิดปกติ (${maxVoc}) อาจมีอาหารเริ่มเน่าเสีย กรุณาตรวจสอบภายในตู้เย็น`
        : `🌡️ [${config.name}] High fridge temperature detected (${maxTemp!.toFixed(1)}°C > 8.0°C). Check door seal & cooling.\nอุณหภูมิในตู้เย็นสูงเกินเกณฑ์ปลอดภัย (${maxTemp!.toFixed(1)}°C) กรุณาตรวจสอบการปิดประตูและระบบทำความเย็น`;

    const sent = await sendLinePush(env, config.line_target_id, [
      { type: "text", text },
    ]);
    if (sent) sentCount += 1;
  }

  return sentCount;
}

export async function cleanupOrphanedFoodCrops(
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
    await photos.delete(batch);
    deletedCount += batch.length;
  }
  return deletedCount;
}

export async function dispatchDailyExpiryDigests(
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

    const acquired = await tryAcquireAlertCooldown(
      env.DB,
      fridge.id,
      "daily_expiry_digest",
      nowS,
      DAILY_DIGEST_COOLDOWN_S,
    );
    if (!acquired) continue;

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
      `🥬 [${fridge.name}] Daily FEFO Expiry Digest (${today})`,
      `สรุปรายการอาหารใกล้หมดอายุ / หมดอายุแล้ว (${items.length} รายการ):`,
      ...lines,
    ].join("\n");

    const sent = await sendLinePush(env, fridge.line_target_id, [
      { type: "text", text: message },
    ]);
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
