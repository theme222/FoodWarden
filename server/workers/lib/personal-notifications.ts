import type { AppBindings } from "../types";
import type { DoorEvent } from "./door-events";
import type { TelemetrySample } from "./telemetry";
import { LinePairingError } from "./line-pairing";
import { readFavorites, type LineProfile } from "./personal";
import { addDaysToIsoDate, bangkokIsoDate } from "./gemini";
interface Message {
  type: "text";
  text: string;
}
async function push(
  env: AppBindings,
  target: string,
  messages: Message[],
  key: string,
): Promise<"accepted" | "retry" | "rejected"> {
  try {
    const res = await fetch(
      `${env.LINE_API_BASE_URL?.replace(/\/+$/, "") || "https://api.line.me"}/v2/bot/message/push`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN?.trim()}`,
          "X-Line-Retry-Key": key,
        },
        signal: AbortSignal.timeout(10_000),
        body: JSON.stringify({ to: target, messages }),
      },
    );
    const accepted =
      res.ok ||
      (res.status === 409 && res.headers.has("x-line-accepted-request-id"));
    const status = res.status;
    await res.body?.cancel();
    return accepted
      ? "accepted"
      : status >= 500 || status === 429
        ? "retry"
        : "rejected";
  } catch {
    return "retry";
  }
}
export async function enqueuePersonalTest(
  env: AppBindings,
  userId: string,
  nowS: number,
): Promise<void> {
  const profile = await env.DB.prepare(
    "SELECT line_user_id FROM user_line_profiles WHERE user_id=?",
  )
    .bind(userId)
    .first<{ line_user_id: string | null }>();
  if (!profile?.line_user_id)
    throw new LinePairingError("Connect your LINE account first.", 409);
  const [userRow, fridges] = await Promise.all([
    env.DB.prepare("SELECT name, email FROM user WHERE id=?")
      .bind(userId)
      .first<{ name: string | null; email: string }>(),
    env.DB.prepare(
      `SELECT f.id, f.name
       FROM fridges f
       JOIN fridge_members fm ON fm.fridge_id=f.id
       JOIN user u ON lower(trim(u.email))=fm.email
       WHERE u.id=?
       ORDER BY f.created_at_s ASC, f.id ASC`,
    )
      .bind(userId)
      .all<{ id: string; name: string }>(),
  ]);
  const accountLabel = userRow?.name
    ? `${userRow.name} (${userRow.email})`
    : (userRow?.email ?? userId);
  const fridgeSummary =
    fridges.results.length > 0
      ? fridges.results.map((f) => `${f.name} (${f.id})`).join(", ")
      : "ยังไม่ได้เป็นสมาชิกตู้เย็นใด";
  const text =
    `👤 [LINE ส่วนตัว · บัญชี ${accountLabel}]\n` +
    `FoodWarden เชื่อมต่อแล้ว ✅ คุณจะได้รับการแจ้งเตือนส่วนตัวที่แชทนี้\n` +
    `ตู้เย็นในบัญชีของคุณ (${fridges.results.length} ตู้): ${fridgeSummary}`;
  const insert = await env.DB.prepare(
    `INSERT INTO user_line_outbox(id,user_id,alert_type,event_key,fridge_ids_json,target_id,messages_json,created_s,next_attempt_s)
    SELECT ?,?,'test',?,'[]',?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM user_line_outbox WHERE user_id=? AND alert_type='test' AND created_s>?)`,
  )
    .bind(
      crypto.randomUUID(),
      userId,
      crypto.randomUUID(),
      profile.line_user_id,
      JSON.stringify([{ type: "text", text }]),
      nowS,
      nowS,
      userId,
      nowS - 60,
    )
    .run();
  if (!insert.meta.changes)
    throw new LinePairingError(
      "Please wait one minute before another test.",
      429,
    );
  await dispatchPersonalOutbox(env, nowS, userId);
}
export async function dispatchPersonalOutbox(
  env: AppBindings,
  nowS: number,
  onlyUser?: string,
): Promise<number> {
  if (!env.LINE_CHANNEL_ACCESS_TOKEN?.trim()) return 0;
  const jobs = await env.DB.prepare(
    "SELECT id FROM user_line_outbox WHERE delivered_s IS NULL AND failed=0 AND next_attempt_s<=? AND lease_until_s<=? AND (? IS NULL OR user_id=?) ORDER BY next_attempt_s LIMIT 30",
  )
    .bind(nowS, nowS, onlyUser ?? null, onlyUser ?? null)
    .all<{ id: string }>();
  let sent = 0;
  for (const job of jobs.results) {
    const lease = crypto.randomUUID();
    const row = await env.DB.prepare(
      `UPDATE user_line_outbox SET lease_until_s=?,lease_token=?,attempts=attempts+1 WHERE id=? AND delivered_s IS NULL AND failed=0 AND lease_until_s<=? AND next_attempt_s<=? RETURNING *`,
    )
      .bind(nowS + 30, lease, job.id, nowS, nowS)
      .first<{
        id: string;
        user_id: string;
        target_id: string;
        alert_type: string;
        fridge_ids_json: string;
        messages_json: string;
        created_s: number;
        attempts: number;
      }>();
    if (!row) continue;
    const profile = await env.DB.prepare(
      `SELECT p.*,u.emailVerified FROM user_line_profiles p JOIN user u ON u.id=p.user_id WHERE p.user_id=?`,
    )
      .bind(row.user_id)
      .first<LineProfile & { emailVerified: number }>();
    const ids: unknown = JSON.parse(row.fridge_ids_json);
    let permitted =
      Array.isArray(ids) && ids.every((id) => typeof id === "string");
    if (permitted)
      for (const id of ids as string[]) {
        const member = await env.DB.prepare(
          `SELECT 1 FROM fridge_members fm JOIN user u ON lower(trim(u.email))=fm.email WHERE u.id=? AND fm.fridge_id=?`,
        )
          .bind(row.user_id, id)
          .first();
        if (!member) {
          permitted = false;
          break;
        }
      }
    const enabled =
      profile &&
      (row.alert_type === "morning"
        ? profile.morning_enabled
        : row.alert_type === "warm"
          ? profile.inst_warm
          : row.alert_type === "spoil"
            ? profile.inst_spoil
            : row.alert_type === "obstruct"
              ? profile.inst_obstruct
              : true);
    if (
      !permitted ||
      !profile?.emailVerified ||
      profile.line_user_id !== row.target_id ||
      !enabled ||
      nowS - row.created_s >= 23 * 3600
    ) {
      await env.DB.prepare(
        "UPDATE user_line_outbox SET failed=1,lease_until_s=0 WHERE id=? AND lease_token=?",
      )
        .bind(row.id, lease)
        .run();
      continue;
    }
    const result = await push(
      env,
      row.target_id,
      JSON.parse(row.messages_json) as Message[],
      row.id,
    );
    if (result === "accepted") {
      await env.DB.prepare(
        "UPDATE user_line_outbox SET delivered_s=?,lease_until_s=0 WHERE id=? AND lease_token=?",
      )
        .bind(nowS, row.id, lease)
        .run();
      sent++;
    } else if (result === "rejected") {
      await env.DB.prepare(
        "UPDATE user_line_outbox SET failed=1,lease_until_s=0 WHERE id=? AND lease_token=?",
      )
        .bind(row.id, lease)
        .run();
    } else {
      await env.DB.prepare(
        "UPDATE user_line_outbox SET lease_until_s=0,next_attempt_s=? WHERE id=? AND lease_token=?",
      )
        .bind(
          nowS + Math.min(3600, 30 * 2 ** Math.min(row.attempts - 1, 7)),
          row.id,
          lease,
        )
        .run();
    }
  }
  return sent;
}
async function queueInstant(
  env: AppBindings,
  fridgeId: string,
  kind: "obstruct" | "warm" | "spoil",
  text: string,
  eventKeys: string[],
  nowS: number,
  detail?: string,
): Promise<void> {
  const field =
    kind === "obstruct"
      ? "inst_obstruct"
      : kind === "warm"
        ? "inst_warm"
        : "inst_spoil";
  const profiles = await env.DB.prepare(
    `SELECT p.user_id,p.line_user_id,f.name,u.name AS user_name,u.email AS user_email FROM user_line_profiles p JOIN user u ON u.id=p.user_id JOIN fridge_members fm ON fm.email=lower(trim(u.email)) JOIN fridges f ON f.id=fm.fridge_id WHERE fm.fridge_id=? AND u.emailVerified=1 AND p.line_user_id IS NOT NULL AND p.${field}=1`,
  )
    .bind(fridgeId)
    .all<{
      user_id: string;
      line_user_id: string;
      name: string;
      user_name: string | null;
      user_email: string;
    }>();
  const statements: D1PreparedStatement[] = [];
  for (const profile of profiles.results) {
    const id = crypto.randomUUID();
    const cooldown = kind === "obstruct" ? 300 : 1800;
    const userLabel = profile.user_name
      ? `${profile.user_name} (${profile.user_email})`
      : profile.user_email;
    const messageText =
      `👤 [แจ้งเตือนส่วนตัว · ${userLabel}]\n` +
      `[${profile.name}] ${text} (รหัสตู้: ${fridgeId}${detail ? ` · ${detail}` : ""})`;
    statements.push(
      env.DB.prepare(
        `INSERT INTO user_line_outbox(id,user_id,alert_type,event_key,fridge_ids_json,target_id,messages_json,created_s,next_attempt_s)
        SELECT ?,?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM user_alert_cooldowns WHERE user_id=? AND fridge_id=? AND alert_type=? AND ?-last_sent_s<?)
        AND EXISTS(SELECT 1 FROM json_each(?) e WHERE NOT EXISTS(SELECT 1 FROM user_line_events WHERE user_id=? AND fridge_id=? AND alert_type=? AND event_key=e.value))`,
      ).bind(
        id,
        profile.user_id,
        kind,
        id,
        JSON.stringify([fridgeId]),
        profile.line_user_id,
        JSON.stringify([{ type: "text", text: messageText }]),
        nowS,
        nowS,
        profile.user_id,
        fridgeId,
        kind,
        nowS,
        cooldown,
        JSON.stringify(eventKeys),
        profile.user_id,
        fridgeId,
        kind,
      ),
      env.DB.prepare(
        `INSERT INTO user_alert_cooldowns(user_id,fridge_id,alert_type,last_sent_s) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM user_line_outbox WHERE id=?) ON CONFLICT(user_id,fridge_id,alert_type) DO UPDATE SET last_sent_s=excluded.last_sent_s`,
      ).bind(profile.user_id, fridgeId, kind, nowS, id),
      env.DB.prepare(
        "INSERT INTO user_line_events(user_id,fridge_id,alert_type,event_key) SELECT ?,?,?,value FROM json_each(?) WHERE true ON CONFLICT DO NOTHING",
      ).bind(profile.user_id, fridgeId, kind, JSON.stringify(eventKeys)),
    );
  }
  if (statements.length) await env.DB.batch(statements);
}
export async function personalDoorAlerts(
  env: AppBindings,
  fridgeId: string,
  events: DoorEvent[],
  nowS: number,
): Promise<void> {
  if (!env.LINE_CHANNEL_ACCESS_TOKEN?.trim()) return;
  const relevant = events.filter((event) =>
    [
      "OBSTRUCTION_ERROR",
      "FAULT_LOCKOUT",
      "TIMEOUT_ERROR",
      "CONTRADICTION_ERROR",
    ].includes(event.status),
  );
  if (!relevant.length) return;
  const nodeIds = [...new Set(relevant.map((e) => e.node_id))].join(", ");
  await queueInstant(
    env,
    fridgeId,
    "obstruct",
    "ประตูต้องการการตรวจสอบ กรุณาดูว่ามีสิ่งกีดขวางหรืออุปกรณ์ขัดข้องหรือไม่",
    relevant.map((e) => JSON.stringify([e.node_id, e.timestamp_s, e.status])),
    nowS,
    `โหนด ${nodeIds}`,
  );
  await dispatchPersonalOutbox(env, nowS);
}
export async function personalTelemetryAlerts(
  env: AppBindings,
  fridgeId: string,
  samples: TelemetrySample[],
  nowS: number,
): Promise<void> {
  if (!env.LINE_CHANNEL_ACCESS_TOKEN?.trim()) return;
  const warm = samples.filter(
    (s) => s.temp_celsius !== null && s.temp_celsius > 8,
  );
  const spoil = samples.filter(
    (s) => s.voc_index !== null && s.voc_index >= 250,
  );
  if (warm.length) {
    const hottest = warm.reduce((best, s) =>
      (s.temp_celsius ?? -Infinity) > (best.temp_celsius ?? -Infinity)
        ? s
        : best,
    );
    await queueInstant(
      env,
      fridgeId,
      "warm",
      "อุณหภูมิสูงกว่า 8°C กรุณาตรวจสอบการปิดประตูและระบบทำความเย็น",
      warm.map((e) => JSON.stringify([e.node_id, e.timestamp_s])),
      nowS,
      `วัดได้ ${hottest.temp_celsius!.toFixed(1)}°C จากโหนด ${hottest.node_id}`,
    );
  }
  if (spoil.length) {
    const highestVoc = spoil.reduce((best, s) =>
      (s.voc_index ?? -Infinity) > (best.voc_index ?? -Infinity) ? s : best,
    );
    await queueInstant(
      env,
      fridgeId,
      "spoil",
      "พบค่า VOC สูงผิดปกติ กรุณาตรวจสอบอาหารภายในตู้",
      spoil.map((e) => JSON.stringify([e.node_id, e.timestamp_s])),
      nowS,
      `ดัชนี VOC ${highestVoc.voc_index!.toFixed(0)} จากโหนด ${highestVoc.node_id}`,
    );
  }
  if (warm.length || spoil.length) await dispatchPersonalOutbox(env, nowS);
}
export async function queueMorningDigests(
  env: AppBindings,
  nowS: number,
): Promise<void> {
  if (!env.LINE_CHANNEL_ACCESS_TOKEN?.trim()) return;
  const local = new Date((nowS + 7 * 3600) * 1000);
  const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
  const today = bangkokIsoDate(nowS);
  const soon = addDaysToIsoDate(today, 2);
  const profiles = await env.DB.prepare(
    "SELECT p.*,u.name AS user_name,u.email AS user_email FROM user_line_profiles p JOIN user u ON u.id=p.user_id WHERE p.line_user_id IS NOT NULL AND p.morning_enabled=1 AND u.emailVerified=1",
  ).all<LineProfile & { user_name: string | null; user_email: string }>();
  for (const profile of profiles.results) {
    const [h, m] = profile.morning_time.split(":").map(Number);
    const due = h! * 60 + m!;
    if (minutes < due || minutes >= due + 60) continue;
    if (
      await env.DB.prepare(
        "SELECT 1 FROM user_line_outbox WHERE user_id=? AND alert_type='morning' AND event_key=?",
      )
        .bind(profile.user_id, today)
        .first()
    )
      continue;
    const fridges = await env.DB.prepare(
      `SELECT f.id,f.name FROM fridges f JOIN fridge_members fm ON fm.fridge_id=f.id JOIN user u ON lower(trim(u.email))=fm.email WHERE u.id=? ORDER BY f.name`,
    )
      .bind(profile.user_id)
      .all<{ id: string; name: string }>();
    const sections: string[] = [];
    const included: string[] = [];
    for (const fridge of fridges.results) {
      const [foods, favorites, closures] = await Promise.all([
        env.DB.prepare(
          "SELECT name_th,name_en,estimated_expiry_date FROM inventory WHERE fridge_id=? AND estimated_expiry_date<=? ORDER BY estimated_expiry_date LIMIT 12",
        )
          .bind(fridge.id, soon)
          .all<{
            name_th: string;
            name_en: string;
            estimated_expiry_date: string;
          }>(),
        readFavorites(env.DB, profile.user_id, fridge.id),
        env.DB.prepare(
          "SELECT COUNT(*) AS n FROM door_events WHERE fridge_id=? AND status='SUCCESS' AND timestamp_s>=? AND timestamp_s<=?",
        )
          .bind(fridge.id, nowS - 86400, nowS)
          .first<{ n: number }>(),
      ]);
      const lines = foods.results.map(
        (f) =>
          `${f.estimated_expiry_date < today ? "หมดอายุแล้ว" : "ควรทานเร็ว ๆ นี้"}: ${f.name_th || f.name_en} (${f.estimated_expiry_date})`,
      );
      for (const item of favorites.items.slice(0, 10))
        lines.push(
          `ของโปรด ${item.name_th || item.name_en}: ${item.count ? `เหลือ ${item.count} ชิ้น` : "หมดแล้ว อาจต้องซื้อเพิ่ม"}`,
        );
      for (const category of favorites.categories) {
        lines.push(
          `หมวดโปรด ${category}: ${favorites.category_counts[category] ?? 0} ชิ้น`,
        );
      }
      if (closures?.n)
        lines.push(`ประตูปิดเอง ${closures.n} ครั้งใน 24 ชั่วโมงที่ผ่านมา`);
      if (lines.length) {
        sections.push(
          `🏠 [${fridge.name}] (รหัสตู้: ${fridge.id})\n${lines.join("\n")}`,
        );
        included.push(fridge.id);
      }
    }
    if (!sections.length) continue;
    const userLabel = profile.user_name
      ? `${profile.user_name} (${profile.user_email})`
      : profile.user_email;
    const summary =
      `👤 สวัสดีตอนเช้า 🥬 สรุปเช้า FoodWarden ${today} (LINE ส่วนตัว · ${userLabel})\n\n` +
      sections.join("\n\n");
    const text =
      summary.length > 4500
        ? summary.slice(0, 4400) +
          "\n\nสรุปบางส่วน กรุณาเปิด FoodWarden เพื่อดูรายการทั้งหมด"
        : summary;
    await env.DB.prepare(
      `INSERT INTO user_line_outbox(id,user_id,alert_type,event_key,fridge_ids_json,target_id,messages_json,created_s,next_attempt_s) VALUES(?,?,'morning',?,?,?,?,?,?) ON CONFLICT(user_id,alert_type,event_key) DO NOTHING`,
    )
      .bind(
        crypto.randomUUID(),
        profile.user_id,
        today,
        JSON.stringify(included),
        profile.line_user_id,
        JSON.stringify([{ type: "text", text }]),
        nowS,
        nowS,
      )
      .run();
  }
}
