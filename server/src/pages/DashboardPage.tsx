import { Network, RotateCcw, ChevronRight } from "lucide-react";
import { useEffect } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { StatusAlert } from "../components/status-alert";
import { useNow } from "../data";
import type { FridgeRoomState } from "../data";
import { FoodDetail } from "../Food";
import { FridgeFavorites } from "../FridgeFavorites";
import { Inventory } from "../Inventory";
import { Metrics } from "../Metrics";
import { FRIDGE_SENSOR_STALE_S } from "../model";
import type { Fridge, Language } from "../model";
import {
  deriveTelemetryAlerts,
  summarizeDeviceHealth,
  summarizeInventory,
} from "../state/dashboard-machine";
import { words } from "../words";

function TelemetryAlerts({
  room,
  language,
  now,
}: {
  room: FridgeRoomState;
  language: Language;
  now: number;
}) {
  const th = language === "th";
  if (!room.latest || now - room.latest.timeS > FRIDGE_SENSOR_STALE_S)
    return null;
  const alerts = deriveTelemetryAlerts(room.latest);

  return (
    <>
      {alerts.length > 0 && (
        <StatusAlert variant="warning">
          {alerts.includes("warm") &&
            (th
              ? "ตู้เย็นร้อนเกินเกณฑ์ ตรวจว่าประตูปิดสนิท"
              : "High temperature. Check that the door is shut.")}
          {alerts.length > 1 && " "}
          {alerts.includes("spoil") &&
            (th
              ? "ค่า VOC สูง ลองตรวจอาหารในตู้"
              : "High VOC. Check the food in the fridge.")}
        </StatusAlert>
      )}
    </>
  );
}

function DeviceHealthBar({
  base,
  room,
  now,
  language,
}: {
  base: string;
  room: FridgeRoomState;
  now: number;
  language: Language;
}) {
  const th = language === "th";
  const deviceSummary = summarizeDeviceHealth(room.heartbeat ?? null, now);
  const dotClass = deviceSummary.allOk
    ? "ok"
    : deviceSummary.degradedNodeIds.length > 0
      ? "warn"
      : "";
  const text = !room.heartbeat
    ? th
      ? "ยังไม่มีสถานะอุปกรณ์"
      : "Device status unavailable"
    : deviceSummary.allOk
      ? th
        ? "อุปกรณ์ทั้งหมดออนไลน์ปกติ (C0 · F0 · D0)"
        : "All 3 devices online (C0 · F0 · D0)"
      : th
        ? `สถานะอุปกรณ์: ออนไลน์ ${deviceSummary.healthyCount}/3`
        : `Devices: ${deviceSummary.healthyCount}/3 online`;

  return (
    <Link to={`${base}/devices`} className="devbar">
      <span className={`dot ${dotClass}`} aria-hidden="true" />
      <Network size={18} aria-hidden="true" />
      <span className="devbar-text">{text}</span>
      <ChevronRight size={16} aria-hidden="true" />
    </Link>
  );
}

export function Dashboard({
  fridge,
  room,
  language,
}: {
  fridge: Fridge;
  room: FridgeRoomState;
  language: Language;
}) {
  const th = language === "th";
  const now = useNow();
  const t = words[language];
  const base = `/fridges/${encodeURIComponent(fridge.id)}`;
  const { hash, search } = useLocation();
  const loaded = room.inventory !== null;
  useEffect(() => {
    if (hash !== "#inventory" || !loaded) return;
    document.getElementById("inventory")?.scrollIntoView();
    document.getElementById("food-title")?.focus({ preventScroll: true });
  }, [hash, search, loaded]);
  const attention = room.inventory
    ? summarizeInventory(room.inventory, now)
    : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="page-head">
        <div className="page-head-copy">
          <h1>{fridge.name}</h1>
        </div>
      </div>

      <TelemetryAlerts room={room} language={language} now={now} />

      {attention && (attention.expired > 0 || attention.soon > 0) && (
        <div
          className="flex flex-wrap gap-2"
          aria-label={th ? "อาหารที่ควรตรวจ" : "Food to check"}
        >
          {attention.expired > 0 && (
            <Link className="btn sm" to="?food=expired#inventory">
              {th ? "หมดอายุ" : "Expired"} · {attention.expired}
            </Link>
          )}
          {attention.soon > 0 && (
            <Link className="btn sm" to="?food=soon#inventory">
              {th ? "ใกล้หมดอายุ" : "Expiring soon"} · {attention.soon}
            </Link>
          )}
        </div>
      )}

      <Metrics
        latest={room.latest}
        now={now}
        language={language}
        failed={room.errors.readings}
        onRetry={room.reloadReadings}
        fridgeId={fridge.id}
        doorEvents={room.doorEvents ?? []}
      />

      <DeviceHealthBar base={base} room={room} now={now} language={language} />

      {room.errors.inventory && (
        <StatusAlert
          action={
            <button
              type="button"
              className="btn sm"
              onClick={room.reloadInventory}
            >
              <RotateCcw size={15} aria-hidden="true" />
              {th ? "ลองใหม่" : "Retry"}
            </button>
          }
        >
          {th ? "อัปเดตรายการอาหารไม่ได้" : "Could not refresh inventory"}
        </StatusAlert>
      )}
      {room.inventory ? (
        <Inventory
          fridgeId={fridge.id}
          items={room.inventory}
          onChanged={room.reloadInventory}
          language={language}
        />
      ) : !room.errors.inventory ? (
        <output className="sub">{t.loading}</output>
      ) : null}
      <FridgeFavorites fridgeId={fridge.id} language={language} />
    </div>
  );
}

export function ItemPage({
  fridge,
  room,
  language,
}: {
  fridge: Fridge;
  room: FridgeRoomState;
  language: Language;
}) {
  const { itemId = "" } = useParams();
  const t = words[language];
  if (!room.inventory && room.errors.inventory) {
    return (
      <StatusAlert
        action={
          <button
            type="button"
            className="btn sm"
            onClick={room.reloadInventory}
          >
            {language === "th" ? "ลองใหม่" : "Retry"}
          </button>
        }
      >
        {t.failed}
      </StatusAlert>
    );
  }
  if (!room.inventory) return <output className="sub">{t.loading}</output>;
  return (
    <FoodDetail
      itemId={itemId}
      items={room.inventory}
      fridgeId={fridge.id}
      language={language}
      onChanged={room.reloadInventory}
    />
  );
}
