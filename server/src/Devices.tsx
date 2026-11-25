import { Collapsible } from "@base-ui/react/collapsible";
import { Link } from "react-router-dom";
import { AlertTriangle, Check, ChevronDown, HelpCircle, X } from "lucide-react";
import { useState } from "react";
import { ReadingTime } from "./components/reading-time";
import { DeviceUptime } from "./components/device-uptime";
import { StatusAlert } from "./components/status-alert";
import { Badge } from "./components/ui/badge";
import { useNow } from "./data";
import { localTimestamp } from "./model";
import type { DoorEvent, Heartbeat, Language } from "./model";
import {
  deviceHelpTip,
  summarizeDeviceHealth,
} from "./state/dashboard-machine";
import type {
  DeviceHealthSummary,
  DeviceHealthTier,
} from "./state/dashboard-machine";
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
          <rect
            x="142"
            y="22"
            width="46"
            height="24"
            rx="8"
            fill="var(--dark)"
          />
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
          <rect
            x="240"
            y="96"
            width="22"
            height="32"
            rx="7"
            fill="var(--dark)"
          />
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
          <text
            x="284"
            y="108"
            fontSize="12"
            fontWeight="700"
            fill="var(--ink)"
          >
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

const deviceBadgeVariants = {
  ok: "fresh",
  late: "soon",
  off: "expired",
  unknown: "neutral",
} as const;

function DeviceRow({
  entry,
  language,
  expanded,
  onToggle,
}: {
  entry: DeviceHealthSummary["nodes"][number];
  language: Language;
  expanded: boolean;
  onToggle: () => void;
}) {
  const t = words[language];
  const { node, state, tier } = entry;
  const helpTip = deviceHelpTip(node.id, state, language);
  const title = nodeTitle(node.id, language);

  return (
    <Collapsible.Root
      id={`dev-${node.id}`}
      open={expanded}
      onOpenChange={onToggle}
    >
      <Collapsible.Trigger className="group/device grid min-h-14 w-full cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 rounded-md px-3 py-2 text-start text-foreground outline-none focus-visible:outline-2 focus-visible:-outline-offset-3 focus-visible:outline-ring aria-[expanded=false]:hover:bg-secondary sm:gap-x-3 @sm:grid-cols-[auto_minmax(0,1fr)_auto_auto]">
        <span
          className="row-span-2 grid size-8 shrink-0 place-items-center rounded-md bg-secondary text-muted-foreground @sm:row-span-1"
          aria-hidden="true"
        >
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
        <span className="min-w-0">
          <span className="block wrap-anywhere">
            <strong className="font-semibold">{title}</strong>{" "}
            <span className="text-sm text-muted-foreground tabular-nums">
              {node.id}
            </span>
          </span>
          <span className="block text-sm text-muted-foreground">
            {t[state]}
          </span>
        </span>
        <Badge
          variant={deviceBadgeVariants[tier]}
          className="col-start-2 row-start-2 px-2 @sm:col-start-3 @sm:row-start-1"
        >
          {tierBadge(tier, language)}
        </Badge>
        <ChevronDown
          size={16}
          aria-hidden="true"
          className="col-start-3 row-span-2 row-start-1 text-muted-foreground group-aria-expanded/device:rotate-180 @sm:col-start-4 @sm:row-span-1"
        />
      </Collapsible.Trigger>

      <Collapsible.Panel className="px-3 pb-3">
        <div className="grid gap-2 border-t border-border px-1 pt-3 text-sm">
          {helpTip && <p>{helpTip}</p>}
          <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] items-baseline gap-x-3 gap-y-1 tabular-nums sm:grid-cols-[auto_1fr]">
            <dt className="text-muted-foreground">{t.lastActive}</dt>
            <dd className="m-0 wrap-anywhere">
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
                <dt className="text-muted-foreground">{t.reportedTime}</dt>
                <dd className="m-0 wrap-anywhere">
                  <time
                    dateTime={new Date(node.reportedS * 1000).toISOString()}
                  >
                    {localTimestamp(node.reportedS, language)}
                  </time>
                </dd>
              </>
            )}
          </dl>
        </div>
      </Collapsible.Panel>
    </Collapsible.Root>
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
  headingLevel,
  error,
  onRetry,
}: {
  fridgeId?: string;
  error?: boolean;
  onRetry?: () => void;
  doorEvents: DoorEvent[] | null;
  language: Language;
  headingLevel: 2 | 4;
}) {
  const th = language === "th";
  const t = words[language];
  const Heading = headingLevel === 4 ? "h4" : "h2";
  return (
    <section className="panel flex flex-col gap-3" aria-labelledby="door-title">
      <div className="page-head">
        <Heading id="door-title">{t.doorEvents}</Heading>
        {fridgeId && (
          <Link
            className="btn sm"
            to={
              "/fridges/" +
              encodeURIComponent(fridgeId) +
              "/monitoring/history?kind=door"
            }
          >
            {th ? "ดูประวัติ" : "View history"}
          </Link>
        )}
      </div>
      {error && (
        <StatusAlert
          action={
            onRetry && (
              <button type="button" className="btn sm" onClick={onRetry}>
                {th ? "ลองใหม่" : "Retry"}
              </button>
            )
          }
        >
          {th ? "อัปเดตประวัติประตูไม่ได้" : "Could not refresh door history"}
        </StatusAlert>
      )}
      {!doorEvents ? (
        error ? null : (
          <output className="sub">{t.loading}</output>
        )
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
  onRetryStatus,
  doorError,
  onRetryDoors,
  language,
  headingLevel = 1,
}: {
  fridgeId?: string;
  heartbeat: Heartbeat | null | undefined;
  doorEvents: DoorEvent[] | null;
  error: boolean;
  onRetryStatus?: () => void;
  doorError?: boolean;
  onRetryDoors?: () => void;
  language: Language;
  headingLevel?: 1 | 3;
}) {
  const now = useNow();
  const t = words[language];
  const resolvedHeartbeat = heartbeat ?? null;
  const summary = summarizeDeviceHealth(resolvedHeartbeat, now);
  const [expandedId, setExpandedId] = useState<string | null>();
  const Heading = headingLevel === 3 ? "h3" : "h1";

  const activeExpanded =
    expandedId === undefined
      ? (summary.firstDegradedId ?? summary.nodes[0]?.node.id ?? null)
      : expandedId;

  return (
    <section className="flex flex-col gap-4" aria-labelledby="device-title">
      <div className="page-head">
        <div className="page-head-copy">
          <Heading id="device-title">{t.devices}</Heading>
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

      {error && (
        <StatusAlert
          action={
            onRetryStatus && (
              <button type="button" className="btn sm" onClick={onRetryStatus}>
                {language === "th" ? "ลองใหม่" : "Retry"}
              </button>
            )
          }
        >
          {language === "th"
            ? "อัปเดตสถานะอุปกรณ์ไม่ได้"
            : "Could not refresh device status"}
        </StatusAlert>
      )}
      {heartbeat === undefined && !error && (
        <output className="sub">{t.loading}</output>
      )}
      {heartbeat !== undefined && (!error || heartbeat !== null) && (
        <>
          <DevicesStatusBanner summary={summary} language={language} />

          <div className="@container divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
            {summary.nodes.map((entry) => (
              <DeviceRow
                key={entry.node.id}
                entry={entry}
                language={language}
                expanded={activeExpanded === entry.node.id}
                onToggle={() =>
                  setExpandedId(
                    activeExpanded === entry.node.id ? null : entry.node.id,
                  )
                }
              />
            ))}
          </div>
          <details className="rounded-lg border border-border bg-card p-3">
            <summary className="w-fit cursor-pointer">
              {language === "th" ? "ดูผังตำแหน่งอุปกรณ์" : "View device placement"}
            </summary>
            <FridgeSchematic
              summary={summary}
              selectedId={activeExpanded}
              onSelect={(id) =>
                setExpandedId((prev) => (prev === id ? null : id))
              }
              language={language}
            />
          </details>
        </>
      )}

      {fridgeId && fridgeId !== "demo" && (
        <DeviceUptime fridgeId={fridgeId} language={language} />
      )}

      <DoorEventsSection
        fridgeId={fridgeId}
        doorEvents={doorEvents}
        error={doorError}
        onRetry={onRetryDoors}
        language={language}
        headingLevel={headingLevel === 3 ? 4 : 2}
      />
    </section>
  );
}
