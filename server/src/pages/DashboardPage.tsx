import { Network, RotateCcw, ChevronRight } from "lucide-react";
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
  if (!room.latest || now - room.latest.timeS > FRIDGE_SENSOR_STALE_S) return null;
  const alerts = deriveTelemetryAlerts(room.latest);

  return (
    <>
      {alerts.length > 0 && (
        <StatusAlert variant="warning">
          {alerts.includes("warm") && (
            th
              ? "ตู้เย็นร้อนเกินเกณฑ์ ตรวจว่าประตูปิดสนิท"
              : "High temperature. Check that the door is shut."
          )}
          {alerts.length > 1 && " "}
          {alerts.includes("spoil") && (
            th ? "ค่า VOC สูง ลองตรวจอาหารในตู้" : "High VOC. Check the food in the fridge."
          )}
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
  const text = deviceSummary.allOk
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
  const location = useLocation();
  const state: unknown = location.state;
  const added =
    typeof state === "object" &&
    state !== null &&
    "added" in state &&
    state.added === true;
  const base = `/fridges/${encodeURIComponent(fridge.id)}`;

  return (
    <div className="flex flex-col gap-4">
      <div className="page-head">
        <div className="page-head-copy">
          <h1>{fridge.name}</h1>
        </div>
      </div>

      {added && <output className="pill accent">{t.saved}</output>}

      <TelemetryAlerts room={room} language={language} now={now} />

      <Metrics
        latest={room.latest}
        now={now}
        language={language}
        failed={room.error}
        fridgeId={fridge.id}
        doorEvents={room.doorEvents ?? []}
      />

      <DeviceHealthBar base={base} room={room} now={now} language={language} />

      {room.error ? (
        <StatusAlert
          action={
            <button type="button" className="btn sm" onClick={room.reloadAll}>
              <RotateCcw size={15} aria-hidden="true" />
              {th ? "ลองใหม่" : "Retry"}
            </button>
          }
        >
          {t.failed}
        </StatusAlert>
      ) : room.inventory ? (
        <Inventory
          fridgeId={fridge.id}
          items={room.inventory}
          onChanged={room.reloadInventory}
          language={language}
        />
      ) : (
        <output className="sub">{t.loading}</output>
      )}
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
  if (room.error) {
    return (
      <StatusAlert
        action={
          <button type="button" className="btn sm" onClick={room.reloadAll}>
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
