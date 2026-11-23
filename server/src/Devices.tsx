import { Link } from "react-router-dom";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  HelpCircle,
  X,
} from "lucide-react";
import { useState } from "react";
import { ReadingTime } from "./components/reading-time";
import { StatusAlert } from "./components/status-alert";
import { useNow } from "./data";
import { localTimestamp } from "./model";
import type { DoorEvent, Heartbeat, Language } from "./model";
import {
  deviceHelpTip,
  summarizeDeviceHealth,
} from "./state/dashboard-machine";
import type { DeviceHealthSummary, DeviceHealthTier } from "./state/dashboard-machine";
import { words } from "./words";

function tierColor(tier: DeviceHealthTier): string {
  if (tier === "ok") return "var(--fresh)";
  if (tier === "late") return "var(--soon)";
  if (tier === "off") return "var(--bad)";
  return "#7C876E";
}

function tierTextColor(tier: DeviceHealthTier): string {
  if (tier === "ok") return "var(--fresh-ink)";
  if (tier === "late") return "var(--soon-ink)";
  if (tier === "off") return "var(--bad-ink)";
  return "var(--muted-ink)";
}

function tierBadge(tier: DeviceHealthTier, language: Language): string {
  const th = language === "th";
  if (tier === "ok") return th ? "ปกติ" : "OK";
  if (tier === "late") return th ? "ช้า" : "Slow";
  if (tier === "off") return th ? "ขาดการติดต่อ" : "No reply";
  return th ? "รอข้อมูล" : "Not seen";
}

function nodeTitle(nodeId: string, language: Language): string {
  const t = words[language];
  if (nodeId.startsWith("C")) return t.gateway;
  if (nodeId.startsWith("F")) return t.fridgeSensor;
  if (nodeId.startsWith("D")) return t.doorCloser;
  return t.otherDevice;
}

function FridgeSchematic({
  summary,
  selectedId,
  onSelect,
  language,
}: {
  summary: DeviceHealthSummary;
  selectedId: string | null;
  onSelect: (id: string) => void;
  language: Language;
}) {
  const byId = new Map(summary.nodes.map((entry) => [entry.node.id, entry]));
  const c0 = byId.get("C0");
  const f0 = byId.get("F0");
  const d0 = byId.get("D0");

  return (
    <section className="panel fp-wrap" aria-label={words[language].devices}>
      <svg
        className="fp-svg"
        viewBox="0 0 380 280"
        role="img"
        aria-label={
          language === "th"
            ? "แผนผังอุปกรณ์ในตู้เย็น C0, F0 และ D0"
            : "Fridge hardware layout schematic for C0, F0, and D0"
        }
      >
        {/* Fridge body */}
        <rect
          x="90"
          y="46"
          width="150"
          height="210"
          rx="16"
          fill="var(--lime-soft)"
        />
        <line
          x1="90"
          y1="126"
          x2="240"
          y2="126"
          stroke="var(--bg)"
          strokeWidth="4"
        />
        <rect x="222" y="72" width="6" height="32" rx="3" fill="var(--leaf)" />
        <rect x="222" y="144" width="6" height="44" rx="3" fill="var(--leaf)" />
        <rect x="108" y="256" width="16" height="8" rx="3" fill="var(--leaf)" />
        <rect x="206" y="256" width="16" height="8" rx="3" fill="var(--leaf)" />

        {/* C0 Camera Gateway on top */}
        <g aria-hidden="true">
          <rect x="142" y="22" width="46" height="24" rx="8" fill="var(--dark)" />
          <circle
            cx="165"
            cy="34"
            r="7"
            fill={tierColor(c0?.tier ?? "unknown")}
          />
          <line
            x1="142"
            y1="34"
            x2="86"
            y2="34"
            stroke="var(--rule)"
            strokeDasharray="3 4"
            strokeWidth="2"
          />
          <text x="12" y="32" fontSize="12" fontWeight="700" fill="var(--ink)">
            C0 Camera
          </text>
          <text
            x="12"
            y="47"
            fontSize="11"
            fontWeight="600"
            fill={tierTextColor(c0?.tier ?? "unknown")}
          >
            {tierBadge(c0?.tier ?? "unknown", language)}
          </text>
        </g>

        {/* F0 Sensor inside compartment */}
        <g aria-hidden="true">
          <rect
            x="116"
            y="162"
            width="42"
            height="28"
            rx="8"
            fill="var(--surface)"
          />
          <circle
            cx="137"
            cy="176"
            r="6"
            fill={tierColor(f0?.tier ?? "unknown")}
          />
          <line
            x1="116"
            y1="176"
            x2="80"
            y2="176"
            stroke="var(--rule)"
            strokeDasharray="3 4"
            strokeWidth="2"
          />
          <text x="12" y="172" fontSize="12" fontWeight="700" fill="var(--ink)">
            F0 Sensor
          </text>
          <text
            x="12"
            y="187"
            fontSize="11"
            fontWeight="600"
            fill={tierTextColor(f0?.tier ?? "unknown")}
          >
            {tierBadge(f0?.tier ?? "unknown", language)}
          </text>
        </g>

        {/* D0 Door closer arm on right */}
        <g aria-hidden="true">
          <rect x="240" y="96" width="22" height="32" rx="7" fill="var(--dark)" />
          <circle
            cx="251"
            cy="112"
            r="6"
            fill={tierColor(d0?.tier ?? "unknown")}
          />
          <line
            x1="262"
            y1="112"
            x2="282"
            y2="112"
            stroke="var(--rule)"
            strokeDasharray="3 4"
            strokeWidth="2"
          />
          <text x="284" y="108" fontSize="12" fontWeight="700" fill="var(--ink)">
            D0
          </text>
          <text
            x="284"
            y="123"
            fontSize="11"
            fontWeight="600"
            fill={tierTextColor(d0?.tier ?? "unknown")}
          >
            {tierBadge(d0?.tier ?? "unknown", language)}
          </text>
        </g>
      </svg>

      <div className="flex flex-wrap items-center justify-center gap-2">
        {summary.nodes.map(({ node, tier }) => (
          <button
            key={node.id}
            type="button"
            className="chip"
            aria-pressed={selectedId === node.id}
            onClick={() => onSelect(node.id)}
          >
            <span className={`dot ${tier}`} aria-hidden="true" />
            {node.id} · {tierBadge(tier, language)}
          </button>
        ))}
      </div>
    </section>
  );
}

function DeviceRow({
  entry,
  heartbeat,
  now,
  language,
  expanded,
  onToggle,
}: {
  entry: DeviceHealthSummary["nodes"][number];
  heartbeat: Heartbeat | null;
  now: number;
  language: Language;
  expanded: boolean;
  onToggle: () => void;
}) {
  const t = words[language];
  const { node, state, tier } = entry;
  const helpTip = deviceHelpTip(node.id, state, language);
  const title = nodeTitle(node.id, language);

  return (
    <article
      id={`dev-${node.id}`}
      className={`dev${tier === "late" ? " st-late" : tier === "off" ? " st-off" : ""}`}
    >
      <button
        type="button"
        className="dev-row"
        aria-expanded={expanded}
        onClick={onToggle}
      >
        <span className={`dev-mk ${tier}`} aria-hidden="true">
          {tier === "ok" ? (
            <Check size={18} />
          ) : tier === "late" ? (
            <AlertTriangle size={18} />
          ) : tier === "off" ? (
            <X size={18} />
          ) : (
            <HelpCircle size={18} />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <strong>{title}</strong>
            <span className="tn-id">{node.id}</span>
          </div>
          <p className="small">{t[state]}</p>
        </div>
        <span className={`pill ${tier}`}>{tierBadge(tier, language)}</span>
        {expanded ? (
          <ChevronDown size={18} aria-hidden="true" />
        ) : (
          <ChevronRight size={18} aria-hidden="true" />
        )}
      </button>

      {expanded && (
        <div className="dev-body">
          {helpTip && <div className="help">{helpTip}</div>}
          <dl className="kv">
            <dt className="small">{t.lastActive}</dt>
            <dd className="num">
              {node.lastKnownS === null ? (
                t.unknown
              ) : (
                <time dateTime={new Date(node.lastKnownS * 1000).toISOString()}>
                  {localTimestamp(node.lastKnownS, language)}
                </time>
              )}
            </dd>
            {node.reportedS !== null && node.reportedS !== node.lastKnownS && (
              <>
                <dt className="small">{t.reportedTime}</dt>
                <dd className="num">
                  <time dateTime={new Date(node.reportedS * 1000).toISOString()}>
                    {localTimestamp(node.reportedS, language)}
                  </time>
                </dd>
              </>
            )}
            {heartbeat && (
              <>
                <dt className="small">{t.lastReport}</dt>
                <dd className="num">
                  <ReadingTime timeS={heartbeat.receivedS} now={now} language={language} />
                </dd>
              </>
            )}
          </dl>
        </div>
      )}
    </article>
  );
}

function doorStatusLabel(
  status: DoorEvent["status"],
  language: Language,
): string {
  const t = words[language];
  const key = ("door_" + status) as keyof typeof t;
  return t[key] ?? status;
}

function DevicesStatusBanner({
  summary,
  language,
}: {
  summary: DeviceHealthSummary;
  language: Language;
}) {
  const th = language === "th";
  if (summary.allOk) {
    return (
      <StatusAlert variant="success">
        {th
          ? "อุปกรณ์ทั้งหมดเชื่อมต่อและทำงานปกติ (3/3)"
          : "All 3 fridge devices are online and reporting normally."}
      </StatusAlert>
    );
  }
  const attentionCount =
    summary.degradedNodeIds.length ||
    summary.nodes.length - summary.healthyCount;
  return (
    <StatusAlert variant="warning">
      {th
        ? `พบอุปกรณ์ที่รอตรวจสอบ ${attentionCount} รายการ`
        : `${attentionCount} device(s) need attention or haven't checked in yet.`}
    </StatusAlert>
  );
}

function DoorEventsSection({
  fridgeId,
  doorEvents,
  language,
}: {
  fridgeId?: string;
  doorEvents: DoorEvent[] | null;
  language: Language;
}) {
  const th = language === "th";
  const t = words[language];
  return (
    <section className="panel flex flex-col gap-3" aria-labelledby="door-title">
      <div className="page-head">
        <h2 id="door-title">{t.doorEvents}</h2>
        {fridgeId && (
          <Link
            className="btn sm"
            to={
              "/fridges/" + encodeURIComponent(fridgeId) + "/history?kind=door"
            }
          >
            {th ? "ดูประวัติ" : "View history"}
          </Link>
        )}
      </div>
      {!doorEvents ? (
        <output className="sub">{t.loading}</output>
      ) : doorEvents.length === 0 ? (
        <p className="sub">{t.emptyDoorEvents}</p>
      ) : (
        <ul className="door-list">
          {doorEvents.slice(0, 3).map((event) => {
            const isAlert =
              event.status !== "SUCCESS" && event.status !== "CLOSING";
            return (
              <li
                key={`${event.nodeId}-${event.timestampS}-${event.status}`}
                className={isAlert ? "door-item door-alert" : "door-item"}
              >
                <div className="flex items-center gap-2">
                  <strong>{doorStatusLabel(event.status, language)}</strong>
                  <span className="tn-id">{event.nodeId}</span>
                </div>
                <time
                  className="small num"
                  dateTime={new Date(event.timestampS * 1000).toISOString()}
                >
                  {localTimestamp(event.timestampS, language)}
                </time>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function Devices({
  fridgeId,
  heartbeat,
  doorEvents,
  error,
  language,
}: {
  fridgeId?: string;
  heartbeat: Heartbeat | null | undefined;
  doorEvents: DoorEvent[] | null;
  error: boolean;
  language: Language;
}) {
  const now = useNow();
  const t = words[language];
  const resolvedHeartbeat = heartbeat ?? null;
  const summary = summarizeDeviceHealth(resolvedHeartbeat, now);
  const [expandedId, setExpandedId] = useState<string | null>(
    () => summary.firstDegradedId,
  );

  if (error) return <StatusAlert>{t.failed}</StatusAlert>;
  if (heartbeat === undefined) return <output className="sub">{t.loading}</output>;

  const activeExpanded =
    expandedId ?? summary.firstDegradedId ?? summary.nodes[0]?.node.id ?? null;

  return (
    <section className="flex flex-col gap-4" aria-labelledby="device-title">
      <div className="page-head">
        <div className="page-head-copy">
          <h1 id="device-title">{t.devices}</h1>
          <p className="sub">{t.deviceIntro}</p>
        </div>
        {resolvedHeartbeat && (
          <p className="gateway-report small num">
            <span>{t.lastReport}</span>
            <ReadingTime
              timeS={resolvedHeartbeat.receivedS}
              now={now}
              language={language}
            />
          </p>
        )}
      </div>

      <DevicesStatusBanner summary={summary} language={language} />

      <FridgeSchematic
        summary={summary}
        selectedId={activeExpanded}
        onSelect={(id) => setExpandedId((prev) => (prev === id ? null : id))}
        language={language}
      />

      <div className="devs">
        {summary.nodes.map((entry) => (
          <DeviceRow
            key={entry.node.id}
            entry={entry}
            heartbeat={resolvedHeartbeat}
            now={now}
            language={language}
            expanded={activeExpanded === entry.node.id}
            onToggle={() =>
              setExpandedId((prev) =>
                prev === entry.node.id ? null : entry.node.id,
              )
            }
          />
        ))}
      </div>

      <DoorEventsSection
        fridgeId={fridgeId}
        doorEvents={doorEvents}
        language={language}
      />
    </section>
  );
}
