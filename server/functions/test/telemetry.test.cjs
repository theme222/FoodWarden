const assert = require("node:assert/strict");
const { createHash, randomUUID } = require("node:crypto");
const { test } = require("node:test");
const { deleteApp, initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const projectId = "demo-foodwarden";
const api = `http://127.0.0.1:5001/${projectId}/asia-southeast1/api`;

test("the local API authenticates, validates, and deduplicates telemetry", async (t) => {
  const health = await fetch(`${api}/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true });

  process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
  const app = initializeApp({ projectId });
  const firestore = getFirestore(app);
  const token = randomUUID();
  const fridge = firestore.collection("fridges").doc(`smoke-${randomUUID()}`);
  t.after(async () => {
    try {
      await firestore.recursiveDelete(fridge);
    } finally {
      await deleteApp(app);
    }
  });

  await fridge.set({ name: "Emulator test fridge" });
  await fridge.collection("private").doc("config").set({
    gatewayTokenHash: createHash("sha256").update(token).digest("hex"),
  });

  const sample = {
    node_id: "F0",
    timestamp_s: 1792944000,
    temp_celsius: null,
    voc_index: 115,
    light_ldr: 128,
  };
  const send = (body, bearer) => fetch(`${api}/telemetry`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify(body),
  });

  assert.equal((await send({ samples: [sample] })).status, 401);
  assert.equal((await send({ samples: [sample] }, randomUUID())).status, 403);
  assert.equal((await send({ samples: [{ ...sample, temp_celsius: "bad" }] }, token)).status, 400);

  const first = await send({ samples: [sample, { ...sample, node_id: "F1" }] }, token);
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { success: true, ingested_count: 1 });
  const retry = await send({ samples: [sample] }, token);
  assert.equal(retry.status, 200);
  assert.deepEqual(await retry.json(), { success: true, ingested_count: 0 });

  const backfill = { ...sample, timestamp_s: sample.timestamp_s - 60 };
  const older = await send({ samples: [backfill] }, token);
  assert.equal(older.status, 200);
  assert.deepEqual(await older.json(), { success: true, ingested_count: 1 });

  const buckets = await fridge.collection("telemetry_minute").get();
  assert.equal(buckets.size, 2);
  assert.deepEqual(buckets.docs.flatMap((bucket) => bucket.get("samples")), [backfill, sample]);
  assert.deepEqual((await fridge.get()).get("last_telemetry"), sample);
});
