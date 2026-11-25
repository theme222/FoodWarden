import type { AppBindings } from "../types";
import {
  doorLineMessage,
  doorNotices,
  fridgePath,
  lineFoodLabel,
  lineMessage,
  sensorLineMessage,
  shortLineLabel,
  type LineTestState,
} from "./line-messages";
import {
  previousDayDoorFaults,
  previousDaySensorAlerts,
} from "./telemetry-alerts";
import type { DoorEvent } from "./door-events";
import type { TelemetrySample } from "./telemetry";
import { LinePairingError } from "./line-pairing";
import { readFavorites, type LineProfile } from "./personal";
import { addDaysToIsoDate, bangkokIsoDate } from "./gemini";
import {
  LINE_MAX_MESSAGES_PER_REQUEST,
  LINE_MAX_TEXT_LENGTH,
  capLineText,
} from "./line-format";
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
  const safeMessages = messages
    .slice(0, LINE_MAX_MESSAGES_PER_REQUEST)
    .map((msg) => ({
      type: "text" as const,
      text: capLineText(msg.text, LINE_MAX_TEXT_LENGTH),
    }));
  if (safeMessages.length === 0) return "rejected";
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
        body: JSON.stringify({ to: target, messages: safeMessages }),
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
): Promise<LineTestState> {
  const profile = await env.DB.prepare(
    "SELECT line_user_id FROM user_line_profiles WHERE user_id=?",
  )
    .bind(userId)
    .first<{ line_user_id: string | null }>();
  if (!profile?.line_user_id)
    throw new LinePairingError("Connect your LINE account first.", 409);
  const text = lineMessage(
    env,
    "ทดสอบ LINE ส่วนตัวสำเร็จ",
    [],
    "ดูการตั้งค่า LINE",
    "/me#line-connection",
  );
  const id = crypto.randomUUID();
  const insert = await env.DB.prepare(
    `INSERT INTO user_line_outbox(id,user_id,alert_type,event_key,fridge_ids_json,target_id,messages_json,created_s,next_attempt_s)
    SELECT ?,?,'test',?,'[]',?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM user_line_outbox WHERE user_id=? AND alert_type='test' AND created_s>?)`,
  )
    .bind(
      id,
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
  const job = await env.DB.prepare(
    "SELECT failed, delivered_s FROM user_line_outbox WHERE id=?",
  )
    .bind(id)
    .first<{ failed: number; delivered_s: number | null }>();
  if (job?.failed) return "failed";
  return job?.delivered_s != null ? "accepted" : "queued";
}
export async function dispatchPersonalOutbox(
  env: AppBindings,
  nowS: number,
  onlyUser?: string,
  fridgeId?: string,
): Promise<number> {
  if (!env.LINE_CHANNEL_ACCESS_TOKEN?.trim()) return 0;
  const jobs = await env.DB.prepare(
    "SELECT id FROM user_line_outbox WHERE delivered_s IS NULL AND failed=0 AND next_attempt_s<=? AND lease_until_s<=? AND (? IS NULL OR user_id=?) AND (? IS NULL OR ? IN (SELECT value FROM json_each(fridge_ids_json))) ORDER BY next_attempt_s LIMIT 30",
  )
    .bind(
      nowS,
      nowS,
      onlyUser ?? null,
      onlyUser ?? null,
      fridgeId ?? null,
      fridgeId ?? null,
    )
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
  formatMessage: (name: string) => string,
  eventKeys: string[],
  nowS: number,
): Promise<void> {
  const field =
    kind === "obstruct"
      ? "inst_obstruct"
      : kind === "warm"
        ? "inst_warm"
        : "inst_spoil";
  const profiles = await env.DB.prepare(
    `SELECT p.user_id,p.line_user_id,f.name FROM user_line_profiles p JOIN user u ON u.id=p.user_id JOIN fridge_members fm ON fm.email=lower(trim(u.email)) JOIN fridges f ON f.id=fm.fridge_id WHERE fm.fridge_id=? AND u.emailVerified=1 AND p.line_user_id IS NOT NULL AND p.${field}=1`,
  )
    .bind(fridgeId)
    .all<{
      user_id: string;
      line_user_id: string;
      name: string;
    }>();
  const statements: D1PreparedStatement[] = [];
  for (const profile of profiles.results) {
    const id = crypto.randomUUID();
    const cooldown = kind === "obstruct" ? 300 : 1800;
    const messageText = formatMessage(profile.name);
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
  dispatch = true,
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
  const latest = relevant.reduce((a, b) =>
    a.timestamp_s >= b.timestamp_s ? a : b,
  );
  const notice = doorNotices[latest.status as keyof typeof doorNotices];
  await queueInstant(
    env,
    fridgeId,
    "obstruct",
    (name) => doorLineMessage(env, fridgeId, name, latest.timestamp_s, notice),
    relevant.map((event) =>
      JSON.stringify([event.node_id, event.timestamp_s, event.status]),
    ),
    nowS,
  );
  if (dispatch) await dispatchPersonalOutbox(env, nowS);
}
export async function personalTelemetryAlerts(
  env: AppBindings,
  fridgeId: string,
  samples: TelemetrySample[],
  nowS: number,
  dispatch = true,
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
      (name) =>
        sensorLineMessage(
          env,
          fridgeId,
          name,
          hottest.timestamp_s,
          "temperature",
          hottest.temp_celsius!,
          hottest.node_id,
        ),
      warm.map((e) => JSON.stringify([e.node_id, e.timestamp_s])),
      nowS,
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
      (name) =>
        sensorLineMessage(
          env,
          fridgeId,
          name,
          highestVoc.timestamp_s,
          "voc",
          highestVoc.voc_index!,
          highestVoc.node_id,
        ),
      spoil.map((e) => JSON.stringify([e.node_id, e.timestamp_s])),
      nowS,
    );
  }
  if (dispatch && (warm.length || spoil.length))
    await dispatchPersonalOutbox(env, nowS);
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
    "SELECT p.* FROM user_line_profiles p JOIN user u ON u.id=p.user_id WHERE p.line_user_id IS NOT NULL AND p.morning_enabled=1 AND u.emailVerified=1",
  ).all<LineProfile>();
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
    const included = new Map<string, string>();
    const highlights: Array<{ label: string; expiry: string; fridge: string }> =
      [];
    let totalFoods = 0;
    let doorFaults = 0;
    let sensorObservations = 0;
    let missingFavorites = 0;
    let autoClosed = 0;
    for (const fridge of fridges.results) {
      const [foods, favorites, faults, sensorAlerts, closures] =
        await Promise.all([
          env.DB.prepare(
            "SELECT name_th,name_en,estimated_expiry_date,COUNT(*) OVER () AS total FROM inventory WHERE fridge_id=? AND estimated_expiry_date<=? ORDER BY estimated_expiry_date,check_in_timestamp_s,id LIMIT 3",
          )
            .bind(fridge.id, soon)
            .all<{
              name_th: string;
              name_en: string;
              estimated_expiry_date: string;
              total: number;
            }>(),
          readFavorites(env.DB, profile.user_id, fridge.id),
          previousDayDoorFaults(env.DB, fridge.id, nowS),
          previousDaySensorAlerts(env.DB, fridge.id, nowS, profile.user_id),
          env.DB.prepare(
            "SELECT COUNT(*) AS n FROM door_events WHERE fridge_id=? AND status='SUCCESS' AND timestamp_s BETWEEN ? AND ?",
          )
            .bind(fridge.id, nowS - 86400, nowS)
            .first<{ n: number }>(),
        ]);
      const missing = favorites.items.filter((item) => !item.count).length;
      if (
        !foods.results.length &&
        !missing &&
        !faults &&
        !sensorAlerts &&
        !closures?.n
      )
        continue;
      const name = shortLineLabel(fridge.name);
      included.set(fridge.id, name);
      totalFoods += foods.results[0]?.total ?? 0;
      doorFaults += faults;
      sensorObservations += sensorAlerts;
      missingFavorites += missing;
      autoClosed += closures?.n ?? 0;
      for (const item of foods.results)
        highlights.push({
          label: lineFoodLabel(item, today),
          expiry: item.estimated_expiry_date,
          fridge: name,
        });
    }
    if (!included.size) continue;
    const single =
      included.size === 1 ? included.entries().next().value : undefined;
    const text = lineMessage(
      env,
      "สรุปตู้เย็นเช้านี้",
      [
        `${single?.[1] ?? `${included.size} ตู้เย็น`} · อาหารที่ควรตรวจ ${totalFoods} รายการ`,
        ...highlights
          .sort((a, b) => a.expiry.localeCompare(b.expiry))
          .slice(0, 3)
          .map((item) =>
            single
              ? item.label
              : shortLineLabel(`${item.fridge}: ${item.label}`),
          ),
        totalFoods > 3 ? `และอีก ${totalFoods - 3} รายการ` : "",
        missingFavorites ? `ของโปรดหมด ${missingFavorites} รายการ` : "",
        autoClosed ? `ประตูปิดเอง ${autoClosed} ครั้งใน 24 ชั่วโมงที่ผ่านมา` : "",
        doorFaults || sensorObservations
          ? `เมื่อวาน: เหตุประตู ${doorFaults} · ค่าที่เข้าคิวเตือน ${sensorObservations}`
          : "",
      ],
      single ? "เปิดตู้เย็น" : "ดูตู้เย็นทั้งหมด",
      single ? fridgePath(single[0]) : "/fridges",
    );
    await env.DB.prepare(
      `INSERT INTO user_line_outbox(id,user_id,alert_type,event_key,fridge_ids_json,target_id,messages_json,created_s,next_attempt_s) VALUES(?,?,'morning',?,?,?,?,?,?) ON CONFLICT(user_id,alert_type,event_key) DO NOTHING`,
    )
      .bind(
        crypto.randomUUID(),
        profile.user_id,
        today,
        JSON.stringify([...included.keys()]),
        profile.line_user_id,
        JSON.stringify([{ type: "text", text }]),
        nowS,
        nowS,
      )
      .run();
  }
}
