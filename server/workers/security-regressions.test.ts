import { createSignedSessionForEmail } from "./lib/auth";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { beforeAll, describe, it, expect, vi } from "vitest";
import {
  createFridge,
  upsertFridgeMember,
  removeFridgeMember,
} from "./lib/fridges";
import { parseMultipartJpeg } from "./lib/ai-inventory";
import { withInferenceQuota, InferenceQuotaError } from "./lib/ai-quota";
import { updateInventoryItem, deleteInventoryItem } from "./lib/inventory";
import { ingestStatus } from "./lib/status";
import {
  maybeSendDoorSafetyAlerts,
  dispatchLineOutbox,
  runDailyCronTasks,
} from "./lib/line";
import type { AppBindings } from "./types";
const bindings = env as unknown as AppBindings & {
  TEST_MIGRATIONS: D1Migration[];
};
const now = () => Math.floor(Date.now() / 1000);
async function fixture() {
  const email = crypto.randomUUID() + "@example.com";
  const fridge = await createFridge(
    bindings.DB,
    email,
    "Regression fridge",
    now(),
  );
  return { email, id: fridge.id };
}
async function item(fridgeId: string, id: string, photo: string | null = null) {
  await bindings.DB.prepare(
    `INSERT INTO inventory (id, fridge_id, name_th, name_en, category, category_th, estimated_expiry_date, check_in_timestamp_s, check_in_source, image_storage_path) VALUES (?, ?, 'old', 'old', 'Dairy', 'old', '2026-12-01', ?, 'CAMERA', ?)`,
  )
    .bind(id, fridgeId, now(), photo)
    .run();
}
describe("Deepsec regressions", () => {
  beforeAll(async () => {
    await applyD1Migrations(bindings.DB, bindings.TEST_MIGRATIONS);
  });
  it("keeps an owner under concurrent demotion/deletion and rejects a revoked actor", async () => {
    const f = await fixture();
    const second = "second-" + f.email;
    expect(
      await upsertFridgeMember(
        bindings.DB,
        f.id,
        second,
        "owner",
        now(),
        f.email,
      ),
    ).toBe("ok");
    await Promise.all([
      upsertFridgeMember(bindings.DB, f.id, f.email, "member", now(), f.email),
      removeFridgeMember(bindings.DB, f.id, second, second),
    ]);
    const owners = await bindings.DB.prepare(
      "SELECT email FROM fridge_members WHERE fridge_id = ? AND role = 'owner'",
    )
      .bind(f.id)
      .all<{ email: string }>();
    expect(owners.results).toHaveLength(1);
    const revoked = owners.results[0]!.email === f.email ? second : f.email;
    expect(
      await upsertFridgeMember(
        bindings.DB,
        f.id,
        revoked,
        "owner",
        now(),
        revoked,
      ),
    ).toBe("forbidden");
    expect(
      await removeFridgeMember(
        bindings.DB,
        f.id,
        owners.results[0]!.email,
        revoked,
      ),
    ).toBe("forbidden");
    expect(
      await upsertFridgeMember(
        bindings.DB,
        f.id,
        owners.results[0]!.email,
        "member",
        now(),
        owners.results[0]!.email,
      ),
    ).toBe("last_owner");
  });
  it("rejects total multipart overflow without trusting Content-Length, and accepts a full-sized image", async () => {
    let cancelled = false;
    let reads = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        reads++;
        c.enqueue(new Uint8Array(3_000_000));
      },
      cancel() {
        cancelled = true;
      },
    });
    const request = new Request("https://local", {
      method: "POST",
      headers: {
        "Content-Type": "multipart/form-data; boundary=x",
        "Content-Length": "10",
      },
      body: stream,
    });
    expect(await parseMultipartJpeg(request)).toEqual({ kind: "too_large" });
    expect(cancelled).toBe(true);
    expect(reads).toBeLessThan(5);
    const jpeg = new Uint8Array(5_000_000);
    jpeg.set([255, 216, 255]);
    jpeg.set([255, 217], jpeg.length - 2);
    const form = new FormData();
    form.set("image", new Blob([jpeg], { type: "image/jpeg" }), "max.jpg");
    expect(
      (
        await parseMultipartJpeg(
          new Request("https://local", { method: "POST", body: form }),
        )
      ).kind,
    ).toBe("ok");
    const extra = new FormData();
    extra.set(
      "image",
      new Blob([new Uint8Array([255, 216, 255, 255, 217])]),
      "ok.jpg",
    );
    extra.set("unused", "a".repeat(5_100_000));
    expect(
      (
        await parseMultipartJpeg(
          new Request("https://local", { method: "POST", body: extra }),
        )
      ).kind,
    ).toBe("too_large");
  });
  it("reserves account-wide concurrent capacity atomically, releases failures, and preserves budget after fridge churn", async () => {
    const f = await fixture();
    const f2 = await createFridge(
      bindings.DB,
      f.email,
      "Another fridge",
      now(),
    );
    let release!: () => void;
    const wait = new Promise<void>((r) => {
      release = r;
    });
    let started!: () => void;
    const ready = new Promise<void>((r) => {
      started = r;
    });
    const active = withInferenceQuota(bindings, f.id, async () => {
      started();
      await wait;
      return 42;
    });
    await ready;
    await expect(
      withInferenceQuota(bindings, f2.id, async () => 0),
    ).rejects.toBeInstanceOf(InferenceQuotaError);
    release();
    expect(await active).toBe(42);
    await expect(
      withInferenceQuota(bindings, f.id, async () => {
        throw new Error("upstream");
      }),
    ).rejects.toThrow("upstream");
    expect(await withInferenceQuota(bindings, f2.id, async () => 7)).toBe(7);
    await bindings.DB.prepare("DELETE FROM fridges WHERE id = ?")
      .bind(f.id)
      .run();
    const saved = await bindings.DB.prepare(
      "SELECT COUNT(*) AS n FROM ai_reservations WHERE owner_email = ?",
    )
      .bind(f.email)
      .first<{ n: number }>();
    expect(saved!.n).toBe(3);
  });
  it("keeps shared photos until unreferenced and prevents references racing the collector", async () => {
    const f = await fixture();
    const key = `food_crops/${f.id}/shared.jpg`;
    const path = "/storage/" + key;
    await bindings.PHOTOS.put(key, new Uint8Array([255, 216, 255, 255, 217]));
    await item(f.id, "a-" + f.id, path);
    await item(f.id, "b-" + f.id, path);
    expect(
      await deleteInventoryItem(
        bindings.DB,
        bindings.PHOTOS,
        f.id,
        "a-" + f.id,
      ),
    ).toBe(true);
    await runDailyCronTasks(bindings, now() + 90_000);
    expect(await bindings.PHOTOS.head(key)).not.toBeNull();
    await deleteInventoryItem(bindings.DB, bindings.PHOTOS, f.id, "b-" + f.id);
    await runDailyCronTasks(bindings, now() + 90_000);
    expect(await bindings.PHOTOS.head(key)).toBeNull();
    await expect(item(f.id, "c-" + f.id, path)).rejects.toThrow(
      "PHOTO_RETIRED",
    );
  });
  it("preserves independent concurrent inventory patches", async () => {
    const f = await fixture();
    const id = "edit-" + f.id;
    await item(f.id, id);
    await Promise.all([
      updateInventoryItem(bindings.DB, f.id, id, { name_en: "new" }),
      updateInventoryItem(bindings.DB, f.id, id, {
        estimated_expiry_date: "2026-12-20",
      }),
    ]);
    const row = await bindings.DB.prepare(
      "SELECT name_en, estimated_expiry_date FROM inventory WHERE id = ?",
    )
      .bind(id)
      .first();
    expect(row).toEqual({
      name_en: "new",
      estimated_expiry_date: "2026-12-20",
    });
  });
  it("never regresses node history when a newer concurrent gateway report omits it", async () => {
    const f = await fixture();
    const t = now();
    await ingestStatus(
      bindings.DB,
      f.id,
      { gatewaySeenS: t - 3, nodes: [{ node_id: "F", last_seen_s: t - 10 }] },
      t,
    );
    await Promise.all([
      ingestStatus(
        bindings.DB,
        f.id,
        { gatewaySeenS: t - 2, nodes: [{ node_id: "F", last_seen_s: t - 2 }] },
        t,
      ),
      ingestStatus(
        bindings.DB,
        f.id,
        { gatewaySeenS: t - 1, nodes: [{ node_id: "F", last_seen_s: null }] },
        t,
      ),
    ]);
    const row = await bindings.DB.prepare(
      "SELECT nodes_json FROM system_status WHERE fridge_id = ?",
    )
      .bind(f.id)
      .first<{ nodes_json: string }>();
    expect(JSON.parse(row!.nodes_json)[0].last_known_seen_s).toBe(t - 2);
  });
  it("retries failed LINE delivery with the same deduplication key after cooldown acquisition", async () => {
    const f = await fixture();
    await bindings.DB.prepare(
      "UPDATE fridges SET line_target_id = 'U-test' WHERE id = ?",
    )
      .bind(f.id)
      .run();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("failure", { status: 503 }))
      .mockResolvedValue(new Response("{}", { status: 200 }));
    try {
      const event = {
        node_id: "D",
        timestamp_s: now(),
        status: "OBSTRUCTION_ERROR" as const,
      };
      expect(
        await maybeSendDoorSafetyAlerts(bindings, f.id, [event], now()),
      ).toBe(0);
      expect(await dispatchLineOutbox(bindings, now() + 31)).toBe(1);
      const first = new Headers(
        (fetchMock.mock.calls[0]![1] as RequestInit).headers,
      ).get("X-Line-Retry-Key");
      const second = new Headers(
        (fetchMock.mock.calls[1]![1] as RequestInit).headers,
      ).get("X-Line-Retry-Key");
      expect(first).toBeTruthy();
      expect(second).toBe(first);
      expect(
        await maybeSendDoorSafetyAlerts(bindings, f.id, [event], now() + 32),
      ).toBe(0);
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("retains failed LINE jobs and never retries beyond the retry-key lifetime", async () => {
    const f = await fixture();
    await bindings.DB.prepare(
      "UPDATE fridges SET line_target_id = 'U-test' WHERE id = ?",
    )
      .bind(f.id)
      .run();
    const mock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("bad", { status: 503 }));
    try {
      const t = now();
      await maybeSendDoorSafetyAlerts(
        bindings,
        f.id,
        [{ node_id: "D", timestamp_s: t, status: "FAULT_LOCKOUT" }],
        t,
      );
      expect(await dispatchLineOutbox(bindings, t + 23 * 3600)).toBe(0);
      expect(mock).toHaveBeenCalledTimes(1);
      const job = await bindings.DB.prepare(
        "SELECT failed FROM line_outbox WHERE fridge_id = ?",
      )
        .bind(f.id)
        .first<{ failed: number }>();
      expect(job!.failed).toBe(1);
    } finally {
      mock.mockRestore();
    }
  });
  it("bounds daily creator and global budgets even when fridges are recreated", async () => {
    const f = await fixture();
    const t = now();
    await bindings.DB.prepare(
      `WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<50)
      INSERT INTO ai_reservations SELECT ? || x, ?, ?, ?, 0 FROM n`,
    )
      .bind(f.id, f.email, f.id, t)
      .run();
    await bindings.DB.prepare("DELETE FROM fridges WHERE id = ?")
      .bind(f.id)
      .run();
    const replacement = await createFridge(
      bindings.DB,
      f.email,
      "Replacement",
      t,
    );
    const run = vi.fn(async () => 1);
    await expect(
      withInferenceQuota(bindings, replacement.id, run),
    ).rejects.toBeInstanceOf(InferenceQuotaError);
    expect(run).not.toHaveBeenCalled();
    await bindings.DB.prepare(
      `WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<200)
      INSERT INTO ai_reservations SELECT ? || x, 'other@example.com', 'deleted', ?, 0 FROM n`,
    )
      .bind("global-" + f.id, t)
      .run();
    const other = await fixture();
    await expect(
      withInferenceQuota(bindings, other.id, run),
    ).rejects.toBeInstanceOf(InferenceQuotaError);
    expect(run).not.toHaveBeenCalled();
  });

  it("does not replay old LINE events after cooldown or retry to a disabled recipient", async () => {
    const f = await fixture();
    const t = now();
    await bindings.DB.prepare(
      "UPDATE fridges SET line_target_id = 'old-target' WHERE id = ?",
    )
      .bind(f.id)
      .run();
    const mock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("error", { status: 503 }))
      .mockResolvedValue(new Response("{}", { status: 200 }));
    try {
      const event = {
        node_id: "D",
        timestamp_s: t,
        status: "OBSTRUCTION_ERROR" as const,
      };
      await maybeSendDoorSafetyAlerts(bindings, f.id, [event], t);
      await bindings.DB.prepare(
        "UPDATE fridges SET line_target_id = NULL WHERE id = ?",
      )
        .bind(f.id)
        .run();
      expect(await dispatchLineOutbox(bindings, t + 31)).toBe(0);
      expect(mock).toHaveBeenCalledTimes(1);
      await bindings.DB.prepare(
        "UPDATE fridges SET line_target_id = 'new-target' WHERE id = ?",
      )
        .bind(f.id)
        .run();
      expect(
        await maybeSendDoorSafetyAlerts(bindings, f.id, [event], t + 301),
      ).toBe(0);
      expect(mock).toHaveBeenCalledTimes(1);
      expect(
        await maybeSendDoorSafetyAlerts(
          bindings,
          f.id,
          [{ ...event, timestamp_s: t + 302 }],
          t + 302,
        ),
      ).toBe(1);
      expect(mock).toHaveBeenCalledTimes(2);
    } finally {
      mock.mockRestore();
    }
  });

  it("attributes app-created fridge budgets to the authenticated stable account ID", async () => {
    const identity = await createSignedSessionForEmail(
      bindings,
      "http://localhost/",
      { email: crypto.randomUUID() + "@example.com" },
    );
    const response = await exports.default.fetch(
      "http://localhost/api/fridges",
      {
        method: "POST",
        headers: {
          Cookie: identity.cookieHeader.split(";")[0]!,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "Stable creator" }),
      },
    );
    expect(response.status).toBe(201);
    const { id } = (await response.json()) as { id: string };
    const row = await bindings.DB.prepare(
      "SELECT ai_budget_owner FROM fridges WHERE id = ?",
    )
      .bind(id)
      .first<{ ai_budget_owner: string }>();
    expect(row!.ai_budget_owner).toBe(identity.userId);
  });
});
