import type { AppBindings } from "../types";
export class InferenceQuotaError extends Error {}

export const GLOBAL_DAILY_AI_LIMIT = 2000;
export const OWNER_DAILY_AI_LIMIT = 500;
export const FRIDGE_MINUTE_AI_LIMIT = 40;

// One reservation budgets up to eight upstream attempts (primary + fallback).
// Historical reservations survive fridge deletion; fridge churn cannot reset budgets.
export async function withInferenceQuota<T>(
  env: AppBindings,
  fridgeId: string,
  run: () => Promise<T>,
): Promise<T> {
  const now = Math.floor(Date.now() / 1000);
  const [owner, customSecret] = await Promise.all([
    env.DB.prepare("SELECT ai_budget_owner FROM fridges WHERE id = ?")
      .bind(fridgeId)
      .first<{ ai_budget_owner: string | null }>(),
    env.DB.prepare(
      "SELECT gemini_api_key FROM fridge_secrets WHERE fridge_id = ?",
    )
      .bind(fridgeId)
      .first<{ gemini_api_key: string | null }>(),
  ]);
  if (!owner?.ai_budget_owner)
    throw new InferenceQuotaError(
      "An accountable fridge creator is required for AI inference.",
    );
  const hasCustomKey = Boolean(customSecret?.gemini_api_key?.trim());
  const id = crypto.randomUUID();
  const result = await env.DB.prepare(
    `INSERT INTO ai_reservations (id, owner_email, fridge_id, started_s, active_until_s)
    SELECT ?, ?, ?, ?, ? WHERE
    (? = 1 OR (SELECT COUNT(*) FROM ai_reservations WHERE started_s >= ?) < ?) AND
    (? = 1 OR (SELECT COUNT(*) FROM ai_reservations WHERE owner_email = ? AND started_s >= ?) < ?) AND
    (SELECT COUNT(*) FROM ai_reservations WHERE fridge_id = ? AND started_s >= ?) < ? AND
    (SELECT COUNT(*) FROM ai_reservations WHERE active_until_s > ?) < 4 AND
    NOT EXISTS (SELECT 1 FROM ai_reservations WHERE owner_email = ? AND active_until_s > ?)`,
  )
    .bind(
      id,
      owner.ai_budget_owner,
      fridgeId,
      now,
      now + 300,
      hasCustomKey ? 1 : 0,
      now - 86400,
      GLOBAL_DAILY_AI_LIMIT,
      hasCustomKey ? 1 : 0,
      owner.ai_budget_owner,
      now - 86400,
      OWNER_DAILY_AI_LIMIT,
      fridgeId,
      now - 60,
      FRIDGE_MINUTE_AI_LIMIT,
      now,
      owner.ai_budget_owner,
      now,
    )
    .run();
  if (!result.meta.changes)
    throw new InferenceQuotaError(
      "AI request quota reached. Please retry later.",
    );
  try {
    return await run();
  } finally {
    await env.DB.prepare(
      "UPDATE ai_reservations SET active_until_s = 0 WHERE id = ?",
    )
      .bind(id)
      .run();
  }
}
