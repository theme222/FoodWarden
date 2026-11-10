const assert = require("node:assert/strict");
const { createHash, randomUUID } = require("node:crypto");
const { test } = require("node:test");
const { deleteApp, initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");

const projectId = "demo-foodwarden";
const bucketName = projectId + ".appspot.com";
const functions = process.env.FOODWARDEN_FUNCTIONS_HOST || "127.0.0.1:5001";
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";
const storageHost = process.env.STORAGE_EMULATOR_HOST || "http://127.0.0.1:9199";
const api = "http://" + functions + "/" + projectId + "/asia-southeast1/api";
const documentApi = "http://" + firestoreHost + "/v1/projects/" + projectId + "/databases/(default)/documents";
const authApi = "http://" + authHost + "/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo";
const now = () => Math.floor(Date.now() / 1000);

function request(path, token, body) {
  return fetch(api + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(token ? { Authorization: "Bearer " + token } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function signIn(auth, email, emailVerified) {
  const password = randomUUID();
  const user = await auth.createUser({ email, password, emailVerified });
  const response = await fetch(authApi, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const data = await response.json();
  assert.equal(response.status, 200, JSON.stringify(data));
  assert.equal(typeof data.idToken, "string");
  return { uid: user.uid, token: data.idToken };
}

test("device heartbeat and photo inventory respect fridge membership and retries", async (t) => {
  process.env.FIRESTORE_EMULATOR_HOST = firestoreHost;
  process.env.FIREBASE_AUTH_EMULATOR_HOST = authHost;
  process.env.STORAGE_EMULATOR_HOST = storageHost;
  const app = initializeApp({ projectId, storageBucket: bucketName }, "dashboard-test");
  const db = getFirestore(app);
  const auth = getAuth(app);
  const bucket = getStorage(app).bucket();
  const uid = randomUUID();
  const email = uid + "@example.test";
  const nonMemberEmail = "other-" + email;
  const unverifiedEmail = "unverified-" + email;
  const fridge = db.collection("fridges").doc("dashboard-" + uid);
  const gatewayToken = randomUUID();
  const users = [];
  t.after(async () => {
    await Promise.allSettled([
      db.recursiveDelete(fridge),
      bucket.deleteFiles({ prefix: "food_crops/" + fridge.id + "/" }),
      ...users.map((user) => auth.deleteUser(user.uid)),
    ]);
    await deleteApp(app);
  });

  const owner = await signIn(auth, email, true);
  users.push(owner);
  const outsider = await signIn(auth, nonMemberEmail, true);
  users.push(outsider);
  const unverified = await signIn(auth, unverifiedEmail, false);
  users.push(unverified);
  await fridge.set({ name: "Test fridge", members: { [email]: "owner", [unverifiedEmail]: "member" } });
  await fridge.collection("private").doc("config").set({
    gatewayTokenHash: createHash("sha256").update(gatewayToken).digest("hex"),
  });

  const time = now() - 10;
  const report = { nodes: [
    { node_id: "C0", last_seen_s: time },
    { node_id: "F0", last_seen_s: time - 60 },
    { node_id: "D0", last_seen_s: null },
  ] };
  assert.equal((await request("/status", null, report)).status, 401);
  assert.equal((await request("/status", owner.token, report)).status, 403);
  assert.equal((await request("/status", gatewayToken, { nodes: report.nodes.slice(1) })).status, 400);
  assert.equal((await request("/status", gatewayToken, { nodes: [...report.nodes, report.nodes[1]] })).status, 400);
  const accepted = await request("/status", gatewayToken, report);
  assert.equal(accepted.status, 200, await accepted.clone().text());
  assert.deepEqual(await accepted.json(), { success: true, updated_count: 3 });
  assert.deepEqual(await (await request("/status", gatewayToken, report)).json(), { success: true, updated_count: 0 });
  const next = { nodes: [
    { node_id: "C0", last_seen_s: time + 1 },
    { node_id: "F0", last_seen_s: null },
    { node_id: "D0", last_seen_s: time },
    { node_id: "F1", last_seen_s: time - 5 },
  ] };
  assert.deepEqual(await (await request("/status", gatewayToken, next)).json(), { success: true, updated_count: 4 });
  assert.deepEqual(await (await request("/status", gatewayToken, report)).json(), { success: true, updated_count: 0 });
  const status = await fridge.collection("system_status").doc("latest").get();
  assert.equal(status.get("gateway_seen_s"), time + 1);
  assert.ok(status.get("received_s") >= time);
  assert.deepEqual(status.get("nodes").find((node) => node.node_id === "F0"), {
    node_id: "F0", last_seen_s: null, last_known_seen_s: time - 60,
  });

  const read = (path, user) => fetch(documentApi + "/fridges/" + fridge.id + path, {
    headers: { Authorization: "Bearer " + user.token },
  });
  assert.equal((await read("/system_status/latest", owner)).status, 200);
  assert.equal((await read("/system_status/latest", outsider)).status, 403);
  assert.equal((await read("/system_status/latest", unverified)).status, 403);
  assert.equal((await read("", owner)).status, 403);
  assert.equal((await read("/private/config", owner)).status, 403);

  const bucketId = "20261110_0500";
  await fridge.collection("telemetry_minute").doc(bucketId).set({
    bucket_minute: bucketId,
    samples: [{ node_id: "F0", timestamp_s: time, temp_celsius: 4, voc_index: null, light_ldr: 104 }],
  });
  const history = (user) => fetch(documentApi + "/fridges/" + fridge.id + ":runQuery", {
    method: "POST",
    headers: { Authorization: "Bearer " + user.token, "Content-Type": "application/json" },
    body: JSON.stringify({ structuredQuery: {
      from: [{ collectionId: "telemetry_minute" }],
      orderBy: [{ field: { fieldPath: "bucket_minute" }, direction: "DESCENDING" }],
      limit: 61,
    } }),
  });
  const reading = await history(owner);
  assert.equal(reading.status, 200, await reading.clone().text());
  assert.equal((await reading.json())[0].document.fields.bucket_minute.stringValue, bucketId);
  assert.equal((await history(outsider)).status, 403);

  const list = await request("/fridges", owner.token);
  assert.equal(list.status, 200, await list.clone().text());
  const { fridges } = await list.json();
  assert.deepEqual(fridges.find((entry) => entry.id === fridge.id), { id: fridge.id, name: "Test fridge" });
  assert.deepEqual(await (await request("/fridges", outsider.token)).json(), { fridges: [] });
  assert.equal((await request("/fridges", unverified.token)).status, 401);

  const path = "/fridges/" + fridge.id + "/inventory";
  const jpeg = Buffer.from("ffd8ffe000104a46494600010100000100010000ffd9", "hex");
  const food = {
    item_id: randomUUID(), name: "Milk", category: "Dairy", estimated_expiry_date: "2026-11-21",
    jpeg_base64: jpeg.toString("base64"),
  };
  assert.equal((await request(path, outsider.token, food)).status, 403);
  assert.equal((await request(path, owner.token, { ...food, jpeg_base64: "bad" })).status, 400);
  assert.equal((await request(path, owner.token, { ...food, estimated_expiry_date: "2026-02-31" })).status, 400);
  const saved = await request(path, owner.token, food);
  assert.equal(saved.status, 201, await saved.clone().text());
  assert.equal((await request(path, owner.token, food)).status, 200);
  assert.equal((await request(path, owner.token, { ...food, name: "Different" })).status, 409);
  const second = { ...food, item_id: randomUUID(), jpeg_base64: null };
  assert.equal((await request(path, owner.token, second)).status, 201);
  const docs = await fridge.collection("inventory").get();
  assert.equal(docs.size, 2);
  assert.deepEqual(docs.docs.map((doc) => doc.get("name_en")), ["Milk", "Milk"]);

  const photoPath = path + "/" + food.item_id + "/photo";
  assert.equal((await request(photoPath, outsider.token)).status, 403);
  const photo = await request(photoPath, owner.token);
  assert.equal(photo.status, 200);
  assert.match(photo.headers.get("content-type"), /^image\/jpeg/);
  assert.equal(photo.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(Buffer.from(await photo.arrayBuffer()), jpeg);
  assert.equal((await request(path + "/" + second.item_id + "/photo", owner.token)).status, 404);

  // Existing camera documents use the same fridge-scoped object naming convention.
  const cameraPath = "food_crops/" + fridge.id + "/camera.jpg";
  await bucket.file(cameraPath).save(jpeg, { resumable: false, contentType: "image/jpeg" });
  const cameraItem = fridge.collection("inventory").doc(randomUUID());
  await cameraItem.set({ name_en: "Orange", name_th: "ส้ม", image_storage_path: "/storage/" + cameraPath });
  assert.deepEqual(Buffer.from(await (await request(path + "/" + cameraItem.id + "/photo", owner.token)).arrayBuffer()), jpeg);
  const localized = { ...food, item_id: randomUUID(), name: "ส้ม", jpeg_base64: null };
  assert.equal((await request(path, owner.token, localized)).status, 201);
  const localizedItem = await fridge.collection("inventory").doc(localized.item_id).get();
  assert.equal(localizedItem.get("name_en"), "Orange");
  assert.equal(localizedItem.get("name_th"), "ส้ม");
  await cameraItem.update({ image_storage_path: "/storage/food_crops/another-fridge/camera.jpg" });
  assert.equal((await request(path + "/" + cameraItem.id + "/photo", owner.token)).status, 404);
});
