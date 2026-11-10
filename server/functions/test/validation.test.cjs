const assert = require("node:assert/strict");
const { test } = require("node:test");
const { parseDoorEvents } = require("../lib/door-events");
const { parseTelemetry } = require("../lib/telemetry");
const { parseStatus } = require("../lib/status");
const { parseManualFood, inventoryPhotoPath, isFridgeMember } = require("../lib/inventory");

test("door events validate every status, timestamp, node and batch limit", () => {
  const event = { node_id: "D0", timestamp_s: 1792944005, status: "SUCCESS" };
  for (const status of ["CLOSING", "SUCCESS", "OBSTRUCTION_ERROR", "ABORTED", "TIMEOUT_ERROR",
    "FAULT_LOCKOUT", "CONTRADICTION_ERROR"]) {
    assert.deepEqual(parseDoorEvents({ events: [{ ...event, status }] }), [{ ...event, status }]);
  }
  for (const change of [{ status: "OPEN" }, { timestamp_s: -1 }, { timestamp_s: 1.5 },
    { timestamp_s: Infinity }, { timestamp_s: 253402300800 }, { node_id: " " },
    { node_id: " D0" }, { node_id: "D".repeat(129) }]) {
    assert.equal(parseDoorEvents({ events: [event, { ...event, ...change }] }), null);
  }
  assert.equal(parseDoorEvents({ events: [] }), null);
  assert.equal(parseDoorEvents({ events: Array(500).fill(event) }), null);
  assert.equal(parseDoorEvents({ events: Array(499).fill(event) }).length, 499);
});

test("telemetry bounds offline batches without rejecting nullable sensor failures", () => {
  const sample = { node_id: "F0", timestamp_s: 0, temp_celsius: null, voc_index: null, light_ldr: null };
  assert.equal(parseTelemetry({ samples: [sample] }).size, 1);
  assert.equal(parseTelemetry({ samples: Array(10001).fill(sample) }), null);
  assert.equal(parseTelemetry({ samples: [{ ...sample, node_id: "F".repeat(129) }] }), null);
  assert.equal(parseTelemetry({ samples: [{ ...sample, temp_celsius: NaN }] }), null);
  const samples = Array.from({ length: 499 }, (_, i) => ({ ...sample, timestamp_s: i * 60 }));
  assert.equal(parseTelemetry({ samples }).size, 499);
  assert.equal(parseTelemetry({ samples: [...samples, { ...sample, timestamp_s: 499 * 60 }] }), null);
});

test("heartbeat rejects future clocks and repeated node identities", () => {
  const node = { node_id: "C0", last_seen_s: 1000 };
  assert.ok(parseStatus({ nodes: [node] }, 1000));
  assert.equal(parseStatus({ nodes: [node, node] }, 1000), null);
  assert.equal(parseStatus({ nodes: [{ ...node, last_seen_s: 1301 }] }, 1000), null);
  assert.equal(parseStatus({ nodes: [{ ...node, last_seen_s: null }] }, 1000), null);
});

test("manual inventory validates dates, private paths and explicit membership", () => {
  const food = { item_id: "11111111-1111-4111-8111-111111111111", name: "Milk",
    category: "Dairy", estimated_expiry_date: "2024-02-29" };
  assert.ok(parseManualFood(food));
  assert.equal(parseManualFood({ ...food, estimated_expiry_date: "2026-02-29" }), null);
  assert.equal(parseManualFood({ ...food, jpeg_base64: "not a jpeg" }), null);
  assert.equal(inventoryPhotoPath("/storage/food_crops/other/a.jpg", "kitchen"), null);
  assert.equal(inventoryPhotoPath("food_crops/kitchen/../a.jpg", "kitchen"), null);
  assert.equal(isFridgeMember(Object.create({ "member@example.test": "owner" }), "member@example.test"), false);
});
