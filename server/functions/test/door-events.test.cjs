const assert = require("node:assert/strict");
const { createHash, randomUUID } = require("node:crypto");
const { test } = require("node:test");
const { deleteApp, initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

test("door events are tenant-scoped, atomic and idempotent under concurrent retries", async (t) => {
  process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
  const projectId = "demo-foodwarden";
  const host = process.env.FOODWARDEN_FUNCTIONS_HOST || "127.0.0.1:5001";
  const url = `http://${host}/${projectId}/asia-southeast1/api/door_events`;
  const app = initializeApp({ projectId }, "door-events-test");
  const db = getFirestore(app);
  const fridge = db.collection("fridges").doc("events-" + randomUUID());
  const other = db.collection("fridges").doc("events-" + randomUUID());
  t.after(async () => {
    try { await Promise.all([db.recursiveDelete(fridge), db.recursiveDelete(other)]); }
    finally { await deleteApp(app); }
  });
  const token = randomUUID();
  const hash = createHash("sha256").update(token).digest("hex");
  await fridge.set({ name: "Event test" });
  await other.set({ name: "Other tenant" });
  await fridge.collection("private").doc("config").set({ gatewayTokenHash: hash });
  const send = (events, bearer = token) => fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json",
      ...(bearer ? { Authorization: "Bearer " + bearer } : {}) },
    body: JSON.stringify({ events }),
  });
  const event = { node_id: "D0", timestamp_s: 1792944005, status: "CLOSING" };
  assert.equal((await fetch(url)).status, 405);
  assert.equal((await send([event], null)).status, 401);
  assert.equal((await send([event], randomUUID())).status, 403);
  assert.equal((await send([event, { ...event, status: "INVALID" }])).status, 400);
  assert.equal((await fridge.collection("door_events").get()).size, 0);
  const events = [event, { ...event, status: "ABORTED" }, { ...event, node_id: "D1" }, event];
  const responses = await Promise.all([send(events), send(events)]);
  for (const response of responses) assert.equal(response.status, 200, await response.clone().text());
  const counts = await Promise.all(responses.map(async (response) => (await response.json()).ingested_count));
  assert.deepEqual(counts.sort(), [0, 3]);
  assert.deepEqual(await (await send(events)).json(), { success: true, ingested_count: 0 });
  assert.equal((await fridge.collection("door_events").get()).size, 3);
  assert.equal((await other.collection("door_events").get()).size, 0);
  // Ambiguous credentials and orphaned configs must never select a tenant.
  await other.collection("private").doc("config").set({ gatewayTokenHash: hash });
  assert.equal((await send([event])).status, 403);
  await other.collection("private").doc("config").delete();
  await fridge.delete();
  assert.equal((await send([event])).status, 403);
});
