import { expect, test } from "bun:test";
import {
  contactState,
  expiryLabel,
  foodGroups,
  mergeDoorEvents,
  mergeTelemetrySamples,
  parseFridgeRoomEvent,
  readDoorEventList,
  readFood,
  readFridgeList,
  readFridgeSettings,
  readInventoryList,
  readSample,
  readStatusResponse,
  statusTree,
} from "./model";
import { chartPoints } from "./chart";

test("expiry dates reject calendar overflow rather than displaying a different day", () => {
  for (const language of ["th", "en"] as const) {
    expect(expiryLabel("2026-02-31", language)).toBe("—");
    expect(expiryLabel("2026-02-29", language)).toBe("—");
    expect(expiryLabel("2024-02-29", language)).not.toBe("—");
  }
});

test("matching rows group by name and expiry and preserve each item", () => {
  const item = (
    id: string,
    name: string,
    expiry: string,
    image_storage_path?: string,
  ) =>
    readFood(id, {
      name_en: name,
      estimated_expiry_date: expiry,
      image_storage_path,
    });
  const groups = foodGroups([
    item("a", "Milk", "2026-12-08"),
    item("b", "milk ", "2026-12-08", "food_crops/test/b.jpg"),
    item("c", "Milk", "2026-12-01"),
    item("d", "Tea", "2026-12-08"),
  ]);
  expect(groups.map((group) => group.map((food) => food.id))).toEqual([
    ["c"],
    ["a", "b"],
    ["d"],
  ]);
  expect(groups[1]?.map((food) => food.hasPhoto)).toEqual([false, true]);
});

test("an older Thai-only item matches one unambiguous bilingual row", () => {
  const expiry = "2026-12-08";
  const legacy = readFood("legacy", {
    name_en: "นมสด",
    name_th: "นมสด",
    estimated_expiry_date: expiry,
  });
  const milk = readFood("milk", {
    name_en: "Milk",
    name_th: "นมสด",
    estimated_expiry_date: expiry,
  });
  const wholeMilk = readFood("whole", {
    name_en: "Whole milk",
    name_th: "นมสด",
    estimated_expiry_date: expiry,
  });
  expect(foodGroups([legacy, milk]).map((group) => group.length)).toEqual([2]);
  expect(
    foodGroups([legacy, milk, wholeMilk]).map((group) => group.length),
  ).toEqual([1, 1, 1]);
});

test("device state distinguishes no contact, a sleeping sensor and stale gateway", () => {
  const [gateway, fridge, door] = statusTree(null);
  expect([gateway?.id, fridge?.id, door?.id]).toEqual(["C0", "F0", "D0"]);
  if (!gateway || !fridge || !door) throw new Error("Missing nodes");
  const sensor = { ...fridge, reported: true, reportedS: 500, lastKnownS: 500 };
  const heartbeat = { gatewaySeenS: 989, receivedS: 990, nodes: [sensor] };
  expect(contactState(fridge, null, 1000)).toBe("waiting");
  expect(contactState(door, heartbeat, 1000)).toBe("notIncluded");
  expect(contactState({ ...door, reported: true }, heartbeat, 1000)).toBe(
    "unreported",
  );
  expect(contactState(sensor, heartbeat, 1000)).toBe("recent");
  expect(contactState(sensor, { ...heartbeat, receivedS: 1101 }, 1101)).toBe(
    "stale",
  );
  expect(contactState(sensor, heartbeat, 1171)).toBe("gatewayMissing");
  expect(contactState(sensor, { ...heartbeat, gatewaySeenS: 800 }, 1000)).toBe(
    "gatewayMissing",
  );
});

test("light is graphed and missing VOC does not create a line between readings", () => {
  const samples = [100, 65535, 120].flatMap((voc, index) => {
    const sample = readSample({
      node_id: "F0",
      timestamp_s: 1000 + index * 5,
      temp_celsius: 4,
      voc_index: voc,
      light_ldr: index * 100,
    });
    return sample ? [sample] : [];
  });
  expect(
    chartPoints(samples, "light", 1010).map((points) => points.length),
  ).toEqual([3]);
  expect(
    chartPoints(samples, "voc", 1010).map((points) => points.length),
  ).toEqual([1, 1]);
});

test("REST and WebSocket parsers decode Worker API payloads cleanly", () => {
  const fridges = readFridgeList({
    fridges: [
      {
        id: "kitchen-1",
        name: "Kitchen",
        role: "owner",
        last_seen_s: 1790000000,
        last_telemetry: {
          node_id: "F0",
          timestamp_s: 1790000000,
          temp_celsius: 3.5,
          voc_index: 90,
          light_ldr: 12,
        },
      },
    ],
  });
  expect(fridges[0]).toMatchObject({
    id: "kitchen-1",
    name: "Kitchen",
    role: "owner",
    lastSeenS: 1790000000,
  });

  const inventory = readInventoryList({
    items: [
      {
        id: "item-1",
        name_en: "Milk",
        name_th: "นมสด",
        estimated_expiry_date: "2026-12-01",
        category: "Dairy",
        image_storage_path: "/storage/food_crops/kitchen-1/item-1.jpg",
      },
    ],
  });
  expect(inventory).toHaveLength(1);
  expect(inventory[0]?.hasPhoto).toBe(true);

  const status = readStatusResponse({
    status: {
      gateway_seen_s: 2000,
      received_s: 2001,
      nodes: [{ node_id: "C0", last_seen_s: 2000, last_known_seen_s: 2000 }],
    },
  });
  expect(status?.gatewaySeenS).toBe(2000);

  const doors = readDoorEventList({
    events: [
      { node_id: "D0", timestamp_s: 2005, status: "OBSTRUCTION_ERROR" },
      { node_id: "D0", timestamp_s: 2006, status: "UNKNOWN_STATUS" },
    ],
  });
  expect(doors).toEqual([
    { nodeId: "D0", timestampS: 2005, status: "OBSTRUCTION_ERROR" },
  ]);

  const settings = readFridgeSettings({
    id: "kitchen-1",
    name: "Kitchen",
    line_target_id: null,
    gateway_token: "fw_gw_abc",
    has_gemini_api_key: true,
    members: [{ email: "owner@example.com", role: "owner", added_at_s: 100 }],
  });
  expect(settings.hasGeminiApiKey).toBe(true);
  expect(settings.members).toHaveLength(1);

  const wsTel = parseFridgeRoomEvent(
    JSON.stringify({
      type: "telemetry",
      last_seen_s: 5000,
      samples: [
        {
          node_id: "F0",
          timestamp_s: 5000,
          temp_celsius: 4.2,
          voc_index: 100,
          light_ldr: 50,
        },
      ],
    }),
  );
  expect(wsTel?.type).toBe("telemetry");

  const mergedTelemetry = mergeTelemetrySamples(
    [{ nodeId: "F0", timeS: 1000, temperature: 3, voc: 90, light: 10 }],
    [
      { nodeId: "F0", timeS: 4990, temperature: 4, voc: 95, light: 20 },
      { nodeId: "F0", timeS: 5000, temperature: 4.1, voc: 98, light: 30 },
    ],
    5000,
  );
  expect(mergedTelemetry.map((s) => s.timeS)).toEqual([4990, 5000]);

  const mergedDoors = mergeDoorEvents(
    [{ nodeId: "D0", timestampS: 100, status: "SUCCESS" }],
    [
      { nodeId: "D0", timestampS: 100, status: "SUCCESS" },
      { nodeId: "D0", timestampS: 120, status: "CLOSING" },
    ],
  );
  expect(mergedDoors.map((d) => d.timestampS)).toEqual([120, 100]);
});
