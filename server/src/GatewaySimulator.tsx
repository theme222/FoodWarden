import { useState } from "react";
import type { FormEvent } from "react";
import { FlaskConical } from "lucide-react";
import { toast } from "sonner";
import useSWR from "swr";
import { StatusAlert } from "./components/status-alert";
import { getJson, swrOptions, isAccessError } from "./lib/api";
import { readFridgeSettings } from "./model";
import type { Language } from "./model";
import { categories, categoryLabel, words } from "./words";

const STORAGE_KEY = "foodwarden_gateway_sim";

const DOOR_STATUSES = [
  "OBSTRUCTION_ERROR",
  "TIMEOUT_ERROR",
  "FAULT_LOCKOUT",
  "CONTRADICTION_ERROR",
  "SUCCESS",
  "CLOSING",
  "ABORTED",
] as const;

const RAW_ENDPOINTS = [
  "/api/telemetry?bypass_cooldown=1",
  "/api/door_events?bypass_cooldown=1",
  "/api/status",
  "/api/inventory/checkin",
  "/api/inventory/checkout",
] as const;

type RawEndpoint = (typeof RAW_ENDPOINTS)[number];

type NodeStatusMode =
  "now" | "5m_ago" | "10m_ago" | "2h_ago" | "null" | "custom";

function initialSimEnabled(): boolean {
  if (typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    if (params.get("sim") === "1") return true;
  }
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function defaultExpiryDate(): string {
  return new Date(Date.now() + 3 * 86_400_000 + 7 * 3600_000)
    .toISOString()
    .slice(0, 10);
}

function parseOptionalNumber(raw: string): number | null | "invalid" {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : "invalid";
}

function resolveTimestampS(raw: string, fallbackNowS: number): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return fallbackNowS;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function resolveNodeLastSeen(
  mode: NodeStatusMode,
  customOffsetRaw: string,
  nowS: number,
): number | null | "invalid" {
  switch (mode) {
    case "now":
      return nowS;
    case "5m_ago":
      return Math.max(0, nowS - 300);
    case "10m_ago":
      return Math.max(0, nowS - 600);
    case "2h_ago":
      return Math.max(0, nowS - 7200);
    case "null":
      return null;
    case "custom": {
      const offset = parseOptionalNumber(customOffsetRaw);
      if (offset === null || offset === "invalid") return "invalid";
      return Math.max(0, Math.round(nowS + offset));
    }
  }
}

function sampleRawPayload(endpoint: RawEndpoint, fridgeId: string): string {
  const nowS = Math.floor(Date.now() / 1000);
  switch (endpoint) {
    case "/api/telemetry?bypass_cooldown=1":
      return JSON.stringify(
        {
          samples: [
            {
              node_id: "F0",
              timestamp_s: nowS,
              temp_celsius: 10.5,
              voc_index: 310,
              light_ldr: 35,
            },
          ],
        },
        null,
        2,
      );
    case "/api/door_events?bypass_cooldown=1":
      return JSON.stringify(
        {
          events: [
            {
              node_id: "D0",
              timestamp_s: nowS,
              status: "OBSTRUCTION_ERROR",
            },
          ],
        },
        null,
        2,
      );
    case "/api/status":
      return JSON.stringify(
        {
          nodes: [
            { node_id: "C0", last_seen_s: nowS },
            { node_id: "F0", last_seen_s: nowS },
            { node_id: "D0", last_seen_s: nowS },
          ],
        },
        null,
        2,
      );
    case "/api/inventory/checkin":
      return JSON.stringify(
        {
          name_th: "นมสดพาสเจอร์ไรส์",
          name_en: "Pasteurized Milk",
          category: "Dairy",
          category_th: categories.Dairy,
          estimated_shelf_life_days: 3,
          estimated_expiry_date: defaultExpiryDate(),
          storage_recommendation_th: "แช่ช่องเย็น 2-4°C",
          storage_recommendation_en: "Keep refrigerated at 2-4°C",
          image_storage_path: `/storage/food_crops/${fridgeId}/sim_${crypto.randomUUID()}.jpg`,
          confidence: 0.96,
        },
        null,
        2,
      );
    case "/api/inventory/checkout":
      return JSON.stringify({ item_id: "item_replace_me" }, null, 2);
  }
}

function formatResponseBody(responseText: string): string {
  try {
    return JSON.stringify(JSON.parse(responseText), null, 2);
  } catch {
    return responseText;
  }
}

function useSimulatorSender(gatewayToken: string, th: boolean) {
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);

  async function send(
    endpoint: string,
    payload: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    try {
      const bodyText =
        typeof payload === "string" ? payload : JSON.stringify(payload);
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${gatewayToken}`,
          ...extraHeaders,
        },
        body: bodyText,
      });
      if (!res.ok) {
        const errorBody = formatResponseBody(await res.text());
        setLastResult({
          ok: false,
          text: `${res.status} POST ${endpoint}\n${errorBody}`,
        });
        toast.error(
          th
            ? `ส่งข้อมูลไม่สำเร็จ (HTTP ${res.status})`
            : `Request failed (HTTP ${res.status})`,
        );
        return false;
      }
      const okBody = formatResponseBody(await res.text());
      setLastResult({
        ok: true,
        text: `${res.status} POST ${endpoint}\n${okBody}`,
      });
      toast.success(
        th ? "ส่งข้อมูลจำลองไปยัง Gateway API แล้ว" : "Simulated payload sent",
      );
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLastResult({
        ok: false,
        text: `ERR POST ${endpoint}\n${message}`,
      });
      toast.error(th ? "เชื่อมต่อ API ไม่สำเร็จ" : "Network request failed");
      return false;
    } finally {
      setBusy(false);
    }
  }

  function reportInvalid(message: string) {
    toast.error(message);
    setLastResult({ ok: false, text: message });
  }

  return { busy, lastResult, send, reportInvalid };
}

type SimulatorSender = ReturnType<typeof useSimulatorSender>;

function TelemetrySimulatorSection({
  sender,
  th,
}: {
  sender: SimulatorSender;
  th: boolean;
}) {
  const [nodeId, setNodeId] = useState("F0");
  const [temp, setTemp] = useState("4.2");
  const [voc, setVoc] = useState("95");
  const [light, setLight] = useState("20");
  const [timestampRaw, setTimestampRaw] = useState("");
  const [bypassCooldown, setBypassCooldown] = useState(true);

  function applyPreset(tVal: string, vVal: string, lVal: string) {
    setTemp(tVal);
    setVoc(vVal);
    setLight(lVal);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nowS = Math.floor(Date.now() / 1000);
    const trimmedNode = nodeId.trim();
    const parsedTemp = parseOptionalNumber(temp);
    const parsedVoc = parseOptionalNumber(voc);
    const parsedLight = parseOptionalNumber(light);
    const ts = resolveTimestampS(timestampRaw, nowS);
    if (
      !trimmedNode ||
      parsedTemp === "invalid" ||
      parsedVoc === "invalid" ||
      parsedLight === "invalid" ||
      ts === null
    ) {
      sender.reportInvalid(
        th ? "ค่าเซนเซอร์ไม่ถูกต้อง" : "Invalid telemetry values.",
      );
      return;
    }
    const endpoint = `/api/telemetry${bypassCooldown ? "?bypass_cooldown=1" : ""}`;
    await sender.send(endpoint, {
      samples: [
        {
          node_id: trimmedNode,
          timestamp_s: ts,
          temp_celsius: parsedTemp,
          voc_index: parsedVoc,
          light_ldr: parsedLight,
        },
      ],
    });
  }

  return (
    <section className="sim-panel" aria-labelledby="sim-telemetry-title">
      <h3 id="sim-telemetry-title">
        {th
          ? "1. ค่าเซนเซอร์ (Telemetry: กราฟ + แจ้งเตือนร้อน/VOC)"
          : "1. Sensor Telemetry (Charts + Heat/VOC Alerts)"}
      </h3>
      <div className="category-chips">
        <button
          type="button"
          onClick={() => applyPreset("4.0", "80", "20")}
          disabled={sender.busy}
        >
          {th
            ? "ปกติ (4.0°C · VOC 80 · LDR 20)"
            : "Normal (4.0°C · VOC 80 · LDR 20)"}
        </button>
        <button
          type="button"
          onClick={() => applyPreset("10.5", "95", "20")}
          disabled={sender.busy}
        >
          {th
            ? "🔥 ตู้เย็นร้อน (10.5°C · แจ้งเตือน LINE)"
            : "🔥 Warm Fridge (10.5°C · LINE Alert)"}
        </button>
        <button
          type="button"
          onClick={() => applyPreset("4.5", "320", "20")}
          disabled={sender.busy}
        >
          {th
            ? "🧪 VOC สูง/อาหารเสีย (VOC 320 · แจ้งเตือน LINE)"
            : "🧪 High VOC / Spoilage (VOC 320 · LINE Alert)"}
        </button>
        <button
          type="button"
          onClick={() => applyPreset("11.2", "350", "85")}
          disabled={sender.busy}
        >
          {th
            ? "🔥+🧪 ร้อน + VOC สูง (11.2°C · VOC 350)"
            : "🔥+🧪 Warm + High VOC (11.2°C · VOC 350)"}
        </button>
      </div>
      <form onSubmit={(event) => void submit(event)}>
        <div className="sim-grid">
          <label>
            node_id
            <input
              value={nodeId}
              onChange={(e) => setNodeId(e.target.value)}
              required
              maxLength={128}
            />
          </label>
          <label>
            temp_celsius ({th ? "เว้นว่าง = null" : "blank = null"})
            <input
              type="number"
              step="any"
              value={temp}
              onChange={(e) => setTemp(e.target.value)}
            />
          </label>
          <label>
            voc_index ({th ? "≥250 แจ้งเตือน" : "≥250 alerts"})
            <input
              type="number"
              step="any"
              value={voc}
              onChange={(e) => setVoc(e.target.value)}
            />
          </label>
          <label>
            light_ldr
            <input
              type="number"
              step="any"
              value={light}
              onChange={(e) => setLight(e.target.value)}
            />
          </label>
          <label>
            timestamp_s ({th ? "เว้นว่าง = ตอนนี้" : "blank = now"})
            <input
              type="number"
              step="1"
              value={timestampRaw}
              onChange={(e) => setTimestampRaw(e.target.value)}
              placeholder={th ? "ค่าว่าง = เวลาปัจจุบัน" : "Blank = now"}
            />
          </label>
        </div>
        <label className="toggle-row">
          <span>
            {th
              ? "ข้าม Cooldown แจ้งเตือน LINE (ส่งแจ้งเตือนซ้ำได้ทันที)"
              : "Bypass LINE alert cooldown (send alert immediately)"}
          </span>
          <input
            type="checkbox"
            checked={bypassCooldown}
            onChange={(e) => setBypassCooldown(e.target.checked)}
          />
        </label>
        <div className="form-actions">
          <button type="submit" className="primary" disabled={sender.busy}>
            {th ? "ส่งค่า Telemetry" : "Send Telemetry"}
          </button>
        </div>
      </form>
    </section>
  );
}

function DoorSimulatorSection({
  sender,
  th,
}: {
  sender: SimulatorSender;
  th: boolean;
}) {
  const [nodeId, setNodeId] = useState("D0");
  const [status, setStatus] =
    useState<(typeof DOOR_STATUSES)[number]>("OBSTRUCTION_ERROR");
  const [timestampRaw, setTimestampRaw] = useState("");
  const [bypassCooldown, setBypassCooldown] = useState(true);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nowS = Math.floor(Date.now() / 1000);
    const trimmedNode = nodeId.trim();
    const ts = resolveTimestampS(timestampRaw, nowS);
    if (!trimmedNode || ts === null) {
      sender.reportInvalid(
        th ? "ข้อมูลเหตุการณ์ประตูไม่ถูกต้อง" : "Invalid door event values.",
      );
      return;
    }
    const endpoint = `/api/door_events${bypassCooldown ? "?bypass_cooldown=1" : ""}`;
    await sender.send(endpoint, {
      events: [{ node_id: trimmedNode, timestamp_s: ts, status }],
    });
  }

  return (
    <section className="sim-panel" aria-labelledby="sim-door-title">
      <h3 id="sim-door-title">
        {th ? "2. เหตุการณ์ประตู (Door Events)" : "2. Door Events"}
      </h3>
      <form onSubmit={(event) => void submit(event)}>
        <div className="sim-grid">
          <label>
            node_id
            <input
              value={nodeId}
              onChange={(e) => setNodeId(e.target.value)}
              required
              maxLength={128}
            />
          </label>
          <label>
            status
            <select
              value={status}
              onChange={(e) =>
                setStatus(e.target.value as (typeof DOOR_STATUSES)[number])
              }
            >
              {DOOR_STATUSES.map((candidate) => (
                <option key={candidate} value={candidate}>
                  {candidate}
                </option>
              ))}
            </select>
          </label>
          <label>
            timestamp_s ({th ? "เว้นว่าง = ตอนนี้" : "blank = now"})
            <input
              type="number"
              step="1"
              value={timestampRaw}
              onChange={(e) => setTimestampRaw(e.target.value)}
              placeholder={th ? "ค่าว่าง = เวลาปัจจุบัน" : "Blank = now"}
            />
          </label>
        </div>
        <label className="toggle-row">
          <span>
            {th
              ? "ข้าม Cooldown แจ้งเตือน LINE (ส่งแจ้งเตือนซ้ำได้ทันที)"
              : "Bypass LINE alert cooldown (send alert immediately)"}
          </span>
          <input
            type="checkbox"
            checked={bypassCooldown}
            onChange={(e) => setBypassCooldown(e.target.checked)}
          />
        </label>
        <div className="form-actions">
          <button type="submit" className="primary" disabled={sender.busy}>
            {th ? "ส่งเหตุการณ์ประตู" : "Send Door Event"}
          </button>
        </div>
      </form>
    </section>
  );
}

function NodeHeartbeatFields({
  idLabel,
  modeLabel,
  fallbackId,
  midMode,
  midLabel,
  id,
  mode,
  offset,
  th,
  onIdChange,
  onModeChange,
  onOffsetChange,
}: {
  idLabel: string;
  modeLabel: string;
  fallbackId: string;
  midMode: "5m_ago" | "10m_ago";
  midLabel: string;
  id: string;
  mode: NodeStatusMode;
  offset: string;
  th: boolean;
  onIdChange: (value: string) => void;
  onModeChange: (value: NodeStatusMode) => void;
  onOffsetChange: (value: string) => void;
}) {
  return (
    <>
      <label>
        {idLabel}
        <input
          value={id}
          onChange={(e) => onIdChange(e.target.value)}
          required
          maxLength={128}
        />
      </label>
      <label>
        {modeLabel}
        <select
          value={mode}
          onChange={(e) => onModeChange(e.target.value as NodeStatusMode)}
        >
          <option value="now">{th ? "ตอนนี้ (now)" : "Now"}</option>
          <option value={midMode}>{midLabel}</option>
          <option value="2h_ago">
            {th ? "2 ชม.ก่อน / stale (-7200s)" : "2h ago / stale (-7200s)"}
          </option>
          <option value="null">null ({th ? "ไม่พบ" : "unreported"})</option>
          <option value="custom">
            {th ? "กำหนด offset (วินาที)" : "Custom offset (sec)"}
          </option>
        </select>
      </label>
      {mode === "custom" && (
        <label>
          {id || fallbackId} offset (sec)
          <input
            type="number"
            step="1"
            value={offset}
            onChange={(e) => onOffsetChange(e.target.value)}
          />
        </label>
      )}
    </>
  );
}

function StatusSimulatorSection({
  sender,
  th,
}: {
  sender: SimulatorSender;
  th: boolean;
}) {
  const [c0Offset, setC0Offset] = useState("0");
  const [f0Id, setF0Id] = useState("F0");
  const [f0Mode, setF0Mode] = useState<NodeStatusMode>("now");
  const [f0Offset, setF0Offset] = useState("-60");
  const [d0Id, setD0Id] = useState("D0");
  const [d0Mode, setD0Mode] = useState<NodeStatusMode>("now");
  const [d0Offset, setD0Offset] = useState("-60");
  const [extraId, setExtraId] = useState("");
  const [extraOffset, setExtraOffset] = useState("0");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nowS = Math.floor(Date.now() / 1000);
    const parsedC0Offset = parseOptionalNumber(c0Offset);
    const f0Last = resolveNodeLastSeen(f0Mode, f0Offset, nowS);
    const d0Last = resolveNodeLastSeen(d0Mode, d0Offset, nowS);
    const invalidMain =
      parsedC0Offset === null ||
      parsedC0Offset === "invalid" ||
      !f0Id.trim() ||
      f0Last === "invalid" ||
      !d0Id.trim() ||
      d0Last === "invalid";
    if (invalidMain) {
      sender.reportInvalid(
        th ? "ค่าสถานะโหนดไม่ถูกต้อง" : "Invalid node status values.",
      );
      return;
    }
    const nodes: Array<{ node_id: string; last_seen_s: number | null }> = [
      {
        node_id: "C0",
        last_seen_s: Math.max(0, Math.round(nowS + parsedC0Offset)),
      },
      { node_id: f0Id.trim(), last_seen_s: f0Last },
      { node_id: d0Id.trim(), last_seen_s: d0Last },
    ];
    if (extraId.trim()) {
      const parsedExtra = parseOptionalNumber(extraOffset);
      if (parsedExtra === "invalid") {
        sender.reportInvalid(
          th ? "ค่า offset โหนดเสริมไม่ถูกต้อง" : "Invalid extra node offset.",
        );
        return;
      }
      nodes.push({
        node_id: extraId.trim(),
        last_seen_s:
          parsedExtra === null
            ? null
            : Math.max(0, Math.round(nowS + parsedExtra)),
      });
    }
    await sender.send("/api/status", { nodes });
  }

  return (
    <section className="sim-panel" aria-labelledby="sim-status-title">
      <h3 id="sim-status-title">
        {th
          ? "3. สถานะออนไลน์อุปกรณ์ (Node Heartbeat Status)"
          : "3. Node Online Heartbeat Status"}
      </h3>
      <form onSubmit={(event) => void submit(event)}>
        <div className="sim-grid">
          <label>
            Gateway C0 offset (sec)
            <input
              type="number"
              step="1"
              value={c0Offset}
              onChange={(e) => setC0Offset(e.target.value)}
            />
          </label>
          <NodeHeartbeatFields
            idLabel={th ? "รหัสโหนดเซนเซอร์ตู้เย็น" : "Sensor node ID"}
            modeLabel={th ? "สถานะโหนดเซนเซอร์" : "Sensor last seen"}
            fallbackId="F0"
            midMode="5m_ago"
            midLabel={th ? "5 นาทีก่อน (-300s)" : "5m ago (-300s)"}
            id={f0Id}
            mode={f0Mode}
            offset={f0Offset}
            th={th}
            onIdChange={setF0Id}
            onModeChange={setF0Mode}
            onOffsetChange={setF0Offset}
          />
          <NodeHeartbeatFields
            idLabel={th ? "รหัสโหนดประตูปิดเอง" : "Door closer node ID"}
            modeLabel={th ? "สถานะโหนดประตู" : "Door closer last seen"}
            fallbackId="D0"
            midMode="10m_ago"
            midLabel={th ? "10 นาทีก่อน (-600s)" : "10m ago (-600s)"}
            id={d0Id}
            mode={d0Mode}
            offset={d0Offset}
            th={th}
            onIdChange={setD0Id}
            onModeChange={setD0Mode}
            onOffsetChange={setD0Offset}
          />
          <label>
            {th ? "โหนดเสริม (ไม่บังคับ)" : "Extra node ID (optional)"}
            <input
              value={extraId}
              onChange={(e) => setExtraId(e.target.value)}
              placeholder="e.g. F1"
              maxLength={128}
            />
          </label>
          {extraId.trim() && (
            <label>
              {extraId.trim()} offset (sec)
              <input
                type="number"
                step="1"
                value={extraOffset}
                onChange={(e) => setExtraOffset(e.target.value)}
              />
            </label>
          )}
        </div>
        <div className="form-actions">
          <button type="submit" className="primary" disabled={sender.busy}>
            {th ? "ส่งสถานะอุปกรณ์ (Status)" : "Send Device Status"}
          </button>
        </div>
      </form>
    </section>
  );
}

function InventorySimulatorSection({
  fridgeId,
  sender,
  th,
  language,
}: {
  fridgeId: string;
  sender: SimulatorSender;
  th: boolean;
  language: Language;
}) {
  const [nameTh, setNameTh] = useState("นมสดพาสเจอร์ไรส์");
  const [nameEn, setNameEn] = useState("Pasteurized Milk");
  const [category, setCategory] = useState<keyof typeof categories>("Dairy");
  const [shelfLife, setShelfLife] = useState("3");
  const [expiryDate, setExpiryDate] = useState(defaultExpiryDate);
  const [storageTh, setStorageTh] = useState("แช่ช่องเย็น 2-4°C");
  const [storageEn, setStorageEn] = useState("Keep refrigerated at 2-4°C");
  const [confidence, setConfidence] = useState("0.96");
  const [checkoutItemId, setCheckoutItemId] = useState("");

  async function submitCheckIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsedDays = parseOptionalNumber(shelfLife);
    const parsedConfidence = parseOptionalNumber(confidence);
    if (
      parsedDays === null ||
      parsedDays === "invalid" ||
      !Number.isSafeInteger(parsedDays) ||
      parsedDays < 0 ||
      parsedConfidence === null ||
      parsedConfidence === "invalid" ||
      parsedConfidence < 0 ||
      parsedConfidence > 1
    ) {
      sender.reportInvalid(
        th ? "ค่าวันที่หรือ confidence ไม่ถูกต้อง" : "Invalid check-in values.",
      );
      return;
    }
    await sender.send(
      "/api/inventory/checkin",
      {
        name_th: nameTh.trim(),
        name_en: nameEn.trim(),
        category,
        category_th: categories[category],
        estimated_shelf_life_days: parsedDays,
        estimated_expiry_date: expiryDate,
        storage_recommendation_th: storageTh.trim(),
        storage_recommendation_en: storageEn.trim(),
        image_storage_path: `/storage/food_crops/${fridgeId}/sim_${crypto.randomUUID()}.jpg`,
        confidence: parsedConfidence,
      },
      { "Idempotency-Key": crypto.randomUUID() },
    );
  }

  async function submitCheckOut(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = checkoutItemId.trim();
    if (!trimmed) {
      sender.reportInvalid(
        th ? "กรุณาระบุ item_id ที่ต้องการนำออก" : "Enter an item_id to check out.",
      );
      return;
    }
    await sender.send("/api/inventory/checkout", { item_id: trimmed });
  }

  return (
    <section className="sim-panel" aria-labelledby="sim-inventory-title">
      <h3 id="sim-inventory-title">
        {th
          ? "4. จำลองกล้องเพิ่ม/นำอาหารออก (Camera Check-In / Check-Out)"
          : "4. Camera Inventory Check-In / Check-Out"}
      </h3>
      <form onSubmit={(event) => void submitCheckIn(event)}>
        <div className="sim-grid">
          <label>
            name_th
            <input
              value={nameTh}
              onChange={(e) => setNameTh(e.target.value)}
              required
              maxLength={120}
            />
          </label>
          <label>
            name_en
            <input
              value={nameEn}
              onChange={(e) => setNameEn(e.target.value)}
              required
              maxLength={120}
            />
          </label>
          <label>
            category
            <select
              value={category}
              onChange={(e) =>
                setCategory(e.target.value as keyof typeof categories)
              }
            >
              {Object.keys(categories).map((candidate) => (
                <option key={candidate} value={candidate}>
                  {categoryLabel(candidate, language)}
                </option>
              ))}
            </select>
          </label>
          <label>
            estimated_shelf_life_days
            <input
              type="number"
              step="1"
              min="0"
              max="3650"
              value={shelfLife}
              onChange={(e) => setShelfLife(e.target.value)}
              required
            />
          </label>
          <label>
            estimated_expiry_date
            <input
              type="date"
              value={expiryDate}
              onChange={(e) => setExpiryDate(e.target.value)}
              required
            />
          </label>
          <label>
            confidence (0–1)
            <input
              type="number"
              step="0.01"
              min="0"
              max="1"
              value={confidence}
              onChange={(e) => setConfidence(e.target.value)}
              required
            />
          </label>
          <label>
            storage_recommendation_th
            <input
              value={storageTh}
              onChange={(e) => setStorageTh(e.target.value)}
              maxLength={300}
            />
          </label>
          <label>
            storage_recommendation_en
            <input
              value={storageEn}
              onChange={(e) => setStorageEn(e.target.value)}
              maxLength={300}
            />
          </label>
        </div>
        <div className="form-actions">
          <button type="submit" className="primary" disabled={sender.busy}>
            {th ? "จำลองเพิ่มอาหาร (Check-In)" : "Simulate Check-In"}
          </button>
        </div>
      </form>
      <form
        className="sim-checkout-form"
        onSubmit={(event) => void submitCheckOut(event)}
      >
        <div className="sim-grid">
          <label>
            checkout item_id
            <input
              value={checkoutItemId}
              onChange={(e) => setCheckoutItemId(e.target.value)}
              placeholder="item_..."
            />
          </label>
        </div>
        <div className="form-actions">
          <button type="submit" className="secondary" disabled={sender.busy}>
            {th ? "จำลองนำอาหารออก (Check-Out)" : "Simulate Check-Out"}
          </button>
        </div>
      </form>
    </section>
  );
}

function RawJsonSimulatorSection({
  fridgeId,
  sender,
  th,
}: {
  fridgeId: string;
  sender: SimulatorSender;
  th: boolean;
}) {
  const [endpoint, setEndpoint] = useState<RawEndpoint>(RAW_ENDPOINTS[0]);
  const [rawJson, setRawJson] = useState(() =>
    sampleRawPayload(RAW_ENDPOINTS[0], fridgeId),
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      JSON.parse(rawJson);
    } catch {
      sender.reportInvalid(th ? "รูปแบบ JSON ไม่ถูกต้อง" : "Invalid JSON syntax.");
      return;
    }
    const headers = endpoint.startsWith("/api/inventory/checkin")
      ? { "Idempotency-Key": crypto.randomUUID() }
      : undefined;
    await sender.send(endpoint, rawJson, headers);
  }

  return (
    <section className="sim-panel" aria-labelledby="sim-raw-title">
      <h3 id="sim-raw-title">
        {th
          ? "5. ส่ง Raw JSON กำหนดเอง (Custom Raw Gateway Request)"
          : "5. Custom Raw Gateway JSON"}
      </h3>
      <form onSubmit={(event) => void submit(event)}>
        <div className="sim-grid">
          <label>
            Endpoint
            <select
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value as RawEndpoint)}
            >
              {RAW_ENDPOINTS.map((candidate) => (
                <option key={candidate} value={candidate}>
                  {candidate}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          JSON Body
          <textarea
            rows={7}
            value={rawJson}
            onChange={(e) => setRawJson(e.target.value)}
            spellCheck={false}
          />
        </label>
        <div className="form-actions">
          <button
            type="button"
            className="secondary"
            disabled={sender.busy}
            onClick={() => setRawJson(sampleRawPayload(endpoint, fridgeId))}
          >
            {th ? "โหลดตัวอย่าง JSON" : "Load sample JSON"}
          </button>
          <button type="submit" className="primary" disabled={sender.busy}>
            {th ? "ส่ง Raw JSON" : "Send Raw JSON"}
          </button>
        </div>
      </form>
    </section>
  );
}

function simulatorChromeText(th: boolean, enabled: boolean) {
  if (th) {
    return {
      title: "โหมดจำลองข้อมูลจาก Gateway (Simulator Flag)",
      badge: enabled ? "เปิดอยู่" : "ปิดอยู่",
      description:
        "จำลองการส่งค่าจาก Raspberry Pi Gateway เข้า API จริงด้วยโทเคนของตู้เย็นนี้ เพื่อทดสอบกราฟ สถานะอุปกรณ์ รายการอาหาร และแจ้งเตือน LINE (เปิดอัตโนมัติด้วย ?sim=1 ได้)",
      toggle: enabled
        ? "ปิดโหมดจำลองข้อมูล Gateway"
        : "เปิดโหมดจำลองข้อมูล Gateway (Simulator Flag)",
    };
  }
  return {
    title: "Gateway Data Simulator (Flag)",
    badge: enabled ? "Enabled" : "Off",
    description:
      "Send custom Gateway payloads using this fridge's Bearer token to test charts, device status, inventory, and real LINE alerts (or open with ?sim=1).",
    toggle: enabled ? "Hide Gateway Simulator" : "Enable Gateway Simulator",
  };
}

export function GatewaySimulator({
  fridgeId,
  gatewayToken,
  language,
  defaultOpen = false,
}: {
  fridgeId: string;
  gatewayToken: string;
  language: Language;
  defaultOpen?: boolean;
}) {
  const th = language === "th";
  const [enabled, setEnabled] = useState(
    () => Boolean(defaultOpen) || initialSimEnabled(),
  );
  const sender = useSimulatorSender(gatewayToken, th);
  const copy = simulatorChromeText(th, enabled);

  function toggleFlag() {
    const next = !enabled;
    setEnabled(next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    } catch {
      /* Ignore storage failure */
    }
  }

  return (
    <section
      className="surface settings-card gateway-simulator"
      aria-labelledby="sim-title"
    >
      <div className="section-head">
        <h2 id="sim-title">
          <FlaskConical aria-hidden="true" /> {copy.title}
        </h2>
        <span className={`connection-badge ${enabled ? "connected" : ""}`}>
          {copy.badge}
        </span>
      </div>
      <p className="small">{copy.description}</p>
      <div className="form-actions">
        <button
          type="button"
          className="secondary"
          aria-expanded={enabled}
          onClick={toggleFlag}
        >
          {copy.toggle}
        </button>
      </div>
      {enabled && (
        <>
          <TelemetrySimulatorSection sender={sender} th={th} />
          <DoorSimulatorSection sender={sender} th={th} />
          <StatusSimulatorSection sender={sender} th={th} />
          <InventorySimulatorSection
            fridgeId={fridgeId}
            sender={sender}
            th={th}
            language={language}
          />
          <RawJsonSimulatorSection
            fridgeId={fridgeId}
            sender={sender}
            th={th}
          />
          {sender.lastResult && (
            <output
              className={`sim-output block font-mono break-words whitespace-pre-wrap ${sender.lastResult.ok ? "ok" : "err"}`}
            >
              {sender.lastResult.text}
            </output>
          )}
        </>
      )}
    </section>
  );
}

export function GatewaySimulatorPage({
  fridgeId,
  language,
}: {
  fridgeId: string;
  language: Language;
}) {
  const t = words[language];
  const state = useSWR(
    `/api/fridges/${encodeURIComponent(fridgeId)}/settings`,
    (url) => getJson(url, readFridgeSettings),
    swrOptions,
  );
  if (state.isLoading) return <output>{t.loading}</output>;
  if (isAccessError(state.error) || !state.data)
    return <StatusAlert>{t.failed}</StatusAlert>;
  return (
    <GatewaySimulator
      fridgeId={fridgeId}
      gatewayToken={state.data.gatewayToken}
      language={language}
      defaultOpen
    />
  );
}
