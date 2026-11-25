import { HTTPException } from "hono/http-exception";
import type { InventoryItemRow } from "./inventory";
export class OperationConflictError extends Error {}
export function requireOperationId(value: string | undefined): string {
  if (
    !value ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw new HTTPException(400, {
      message: "A UUID v4 Idempotency-Key header is required.",
    });
  return value.toLowerCase();
}
type Receipt = { request_hash: string; item_id: string };
export async function commitInventoryOperation(
  db: D1Database,
  fridgeId: string,
  kind: "manual" | "camera",
  key: string,
  fingerprint: string,
  item: InventoryItemRow,
  pack?: { count: number; photoPath: string },
): Promise<{ itemId: string; created: boolean }> {
  const nonce = crypto.randomUUID();
  const ids = [
    item.id,
    ...Array.from(
      { length: (pack?.count ?? 1) - 1 },
      () => `item_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
    ),
  ];
  const results = await db.batch([
    db
      .prepare(
        "INSERT INTO inventory_operations(fridge_id,kind,operation_id,request_hash,item_id,claim_token,created_s,pack_photo_path) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING",
      )
      .bind(
        fridgeId,
        kind,
        key,
        fingerprint,
        item.id,
        nonce,
        item.check_in_timestamp_s,
        pack?.photoPath ?? null,
      ),
    db
      .prepare(
        `INSERT INTO inventory(id,fridge_id,name_th,name_en,category,category_th,estimated_expiry_date,storage_recommendation_th,storage_recommendation_en,check_in_timestamp_s,image_storage_path,confidence,check_in_source,manual_request_hash)
      SELECT value,?,?,?,?,?,?,?,?,?,?,?,?,? FROM json_each(?) WHERE EXISTS(SELECT 1 FROM inventory_operations WHERE fridge_id=? AND kind=? AND operation_id=? AND claim_token=?)`,
      )
      .bind(
        fridgeId,
        item.name_th,
        item.name_en,
        item.category,
        item.category_th,
        item.estimated_expiry_date,
        item.storage_recommendation_th,
        item.storage_recommendation_en,
        item.check_in_timestamp_s,
        item.image_storage_path,
        item.confidence,
        item.check_in_source,
        kind === "manual" ? fingerprint : null,
        JSON.stringify(ids),
        fridgeId,
        kind,
        key,
        nonce,
      ),
    db
      .prepare(
        "SELECT request_hash,item_id FROM inventory_operations WHERE fridge_id=? AND kind=? AND operation_id=?",
      )
      .bind(fridgeId, kind, key),
  ]);
  const receipt = (results[2]?.results as Receipt[] | undefined)?.[0] ?? null;
  if (!receipt || receipt.request_hash !== fingerprint)
    throw new OperationConflictError(
      "Idempotency key was already used with different input.",
    );
  return {
    itemId: receipt.item_id,
    created: Boolean(results[0]?.meta.changes),
  };
}
export async function runDraftOperation(
  db: D1Database,
  fridgeId: string,
  kind: "checkin" | "checkout",
  key: string,
  fingerprint: string,
  run: () => Promise<Response>,
): Promise<Response> {
  const claim = await db
    .prepare(
      "INSERT INTO draft_operations(fridge_id,kind,operation_id,request_hash,state,created_s) VALUES(?,?,?,?,'pending',?) ON CONFLICT DO NOTHING",
    )
    .bind(fridgeId, kind, key, fingerprint, Math.floor(Date.now() / 1000))
    .run();
  if (!claim.meta.changes) {
    const previous = await db
      .prepare(
        "SELECT request_hash,state,response_json,response_status FROM draft_operations WHERE fridge_id=? AND kind=? AND operation_id=?",
      )
      .bind(fridgeId, kind, key)
      .first<{
        request_hash: string;
        state: string;
        response_json: string | null;
        response_status: number | null;
      }>();
    if (!previous || previous.request_hash !== fingerprint)
      throw new OperationConflictError(
        "Idempotency key was already used with different input.",
      );
    if (previous.response_json === null || previous.response_status === null)
      return Response.json(
        {
          error: "OPERATION_PENDING",
          message:
            "This operation is pending or has an uncertain outcome. Do not automatically submit a new operation.",
        },
        { status: 409 },
      );
    return new Response(previous.response_json, {
      status: previous.response_status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "private, no-store",
      },
    });
  }
  try {
    const response = await run();
    if (response.status === 429) {
      // Quota denial occurs before contacting the provider; retrying this key is safe.
      await db
        .prepare(
          "DELETE FROM draft_operations WHERE fridge_id=? AND kind=? AND operation_id=?",
        )
        .bind(fridgeId, kind, key)
        .run();
      return response;
    }
    const text = await response.text();
    await db
      .prepare(
        "UPDATE draft_operations SET state=?,response_json=?,response_status=? WHERE fridge_id=? AND kind=? AND operation_id=?",
      )
      .bind(
        response.status >= 500 ? "uncertain" : "done",
        text,
        response.status,
        fridgeId,
        kind,
        key,
      )
      .run();
    return new Response(text, {
      status: response.status,
      headers: response.headers,
    });
  } catch (error) {
    await db
      .prepare(
        "UPDATE draft_operations SET state='uncertain' WHERE fridge_id=? AND kind=? AND operation_id=?",
      )
      .bind(fridgeId, kind, key)
      .run();
    throw error;
  }
}
