import type { AppBindings } from "../types";
import { maybeSendDoorSafetyAlerts, maybeSendTelemetryAlerts } from "./line";
import {
  personalDoorAlerts,
  personalTelemetryAlerts,
} from "./personal-notifications";
import { sustainedAlertSamples } from "./telemetry-alerts";
import type { DoorEvent } from "./door-events";
import type { TelemetrySample } from "./telemetry";

type Job = {
  id: number;
  fridge_id: string;
  kind: "door" | "sensor";
  payload: string;
  created_s: number;
  attempts: number;
};
const JOB_LIFETIME_S = 23 * 3600;

async function deliverJob(env: AppBindings, job: Job, nowS: number) {
  if (job.kind === "door") {
    const events = [JSON.parse(job.payload) as DoorEvent];
    return Promise.allSettled([
      maybeSendDoorSafetyAlerts(env, job.fridge_id, events, nowS, false),
      personalDoorAlerts(env, job.fridge_id, events, nowS, false),
    ]);
  }
  const samples = await sustainedAlertSamples(
    env.DB,
    job.fridge_id,
    [JSON.parse(job.payload) as TelemetrySample],
    job.created_s,
  );
  if (!samples.length) return [];
  return Promise.allSettled([
    maybeSendTelemetryAlerts(env, job.fridge_id, samples, nowS, false),
    personalTelemetryAlerts(env, job.fridge_id, samples, nowS, false),
  ]);
}
export async function processAlertJobs(
  env: AppBindings,
  nowS: number,
  fridgeId?: string,
) {
  if (fridgeId === undefined) {
    await env.DB.prepare(
      "DELETE FROM alert_jobs WHERE id IN (SELECT id FROM alert_jobs WHERE created_s<? AND next_s<=? LIMIT 500)",
    )
      .bind(nowS - JOB_LIFETIME_S, nowS)
      .run();
  }
  if (!env.LINE_CHANNEL_ACCESS_TOKEN?.trim()) return;
  const lease = crypto.randomUUID();
  const scope = fridgeId === undefined ? "" : "AND fridge_id=?";
  const { results } = await env.DB.prepare(
    `UPDATE alert_jobs SET lease=?,next_s=?,attempts=attempts+1 WHERE id IN (
      SELECT id FROM alert_jobs WHERE next_s<=? AND created_s>=? ${scope}
      ORDER BY CASE kind WHEN 'door' THEN 0 ELSE 1 END, id LIMIT 24
    ) RETURNING id,fridge_id,kind,payload,created_s,attempts`,
  )
    .bind(
      lease,
      nowS + 120,
      nowS,
      nowS - JOB_LIFETIME_S,
      ...(fridgeId === undefined ? [] : [fridgeId]),
    )
    .all<Job>();
  for (const job of results.sort((a, b) => a.id - b.id)) {
    let complete = false;
    try {
      complete = (await deliverJob(env, job, nowS)).every(
        (result) => result.status === "fulfilled",
      );
    } catch {
      // The persisted job is available for retry.
    }
    if (complete)
      await env.DB.prepare("DELETE FROM alert_jobs WHERE id=? AND lease=?")
        .bind(job.id, lease)
        .run();
    else
      await env.DB.prepare(
        "UPDATE alert_jobs SET next_s=?,lease=NULL WHERE id=? AND lease=?",
      )
        .bind(
          nowS + Math.min(3600, 30 * 2 ** Math.min(job.attempts - 1, 7)),
          job.id,
          lease,
        )
        .run();
  }
}
