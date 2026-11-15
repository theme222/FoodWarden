import { useNow } from "./data";
import { words } from "./words";
import { useMemo, useState } from "react";
import useSWR from "swr";
import { getJson, swrOptions } from "./lib/api";
import { readBucket, localTimestamp } from "./model";
import type { Sample, Language, DoorEvent } from "./model";
import { Metrics } from "./Metrics";
import { StatusAlert } from "./components/status-alert";
const series = [
  {
    key: "temperature",
    th: "อุณหภูมิ",
    en: "Temperature",
    unit: "°C",
    limit: 8,
    color: "#4E7A12",
  },
  {
    key: "voc",
    th: "VOC",
    en: "VOC",
    unit: "VOC",
    limit: 250,
    color: "#7256A8",
  },
  {
    key: "light",
    th: "แสง",
    en: "Light",
    unit: "LDR",
    limit: 200,
    color: "#BD6F12",
  },
] as const;
export function Charts({
  fridgeId,
  language,
  latest,
  doorEvents,
}: {
  fridgeId: string;
  language: Language;
  latest: Sample | null;
  doorEvents: DoorEvent[];
}) {
  const th = language === "th";
  const now = useNow();
  const t = words[language];
  const [node, setNode] = useState("");
  const [range, setRange] = useState("24h");
  const [enabled, setEnabled] = useState<string[]>([
    "temperature",
    "voc",
    "light",
  ]);
  const [index, setIndex] = useState<number | null>(null);
  const [door, setDoor] = useState<DoorEvent | null>(null);
  const state = useSWR(
    `/api/fridges/${encodeURIComponent(fridgeId)}/telemetry?range=${range}`,
    (url) => getJson(url, readBucket),
    { ...swrOptions, refreshInterval: 30000 },
  );
  const allPoints = useMemo(() => {
    const data = state.data ?? [];
    const seconds: Record<string, number> = {
      "1h": 3600,
      "24h": 86400,
      "7d": 604800,
      "30d": 2592000,
    };
    return latest && latest.timeS >= now - seconds[range]!
      ? [
          ...data.filter(
            (sample) =>
              sample.timeS !== latest.timeS || sample.nodeId !== latest.nodeId,
          ),
          latest,
        ]
          .sort((a, b) => a.timeS - b.timeS)
          .slice(-2000)
      : data;
  }, [state.data, latest, range, now]);
  const nodes = [...new Set(allPoints.map((point) => point.nodeId))].sort();
  const activeNode = nodes.includes(node)
    ? node
    : nodes.includes(latest?.nodeId ?? "")
      ? latest!.nodeId
      : nodes[0];
  const points = allPoints.filter((point) => point.nodeId === activeNode);
  const selected = points.length
    ? points[Math.min(index ?? points.length - 1, points.length - 1)]
    : undefined;
  const first = points[0]?.timeS ?? 0;
  const last = points.at(-1)?.timeS ?? first + 1;
  const span = Math.max(1, last - first);
  const ceiling = Math.max(
    1.25,
    ...points.flatMap((point) =>
      series
        .filter((s) => enabled.includes(s.key))
        .map((s) => (point[s.key] === null ? 0 : point[s.key]! / s.limit)),
    ),
  );
  const x = (time: number) => 40 + ((time - first) / span) * 640;
  const y = (value: number) => 220 - (Math.max(0, value) / ceiling) * 190;
  return (
    <section className="charts-page">
      <div className="page-heading">
        <h1>{th ? "กราฟและประวัติ" : "Charts & history"}</h1>
        <div
          className="range-controls"
          role="group"
          aria-label={th ? "ช่วงเวลา" : "Time range"}
        >
          {["1h", "24h", "7d", "30d"].map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={range === value}
              onClick={() => {
                setRange(value);
                setIndex(null);
                setDoor(null);
              }}
            >
              {value}
            </button>
          ))}
        </div>
      </div>
      {nodes.length > 1 && (
        <label className="sensor-node-filter">
          {th ? "เซนเซอร์" : "Sensor"}
          <select
            value={activeNode}
            onChange={(event) => {
              setNode(event.target.value);
              setIndex(null);
            }}
          >
            {nodes.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>
      )}
      {state.error ? (
        <StatusAlert>
          {th
            ? "โหลดประวัติไม่ได้ กรุณาลองใหม่"
            : "Could not load history. Try again."}
        </StatusAlert>
      ) : state.isLoading ? (
        <output>{th ? "กำลังโหลด…" : "Loading…"}</output>
      ) : !points.length ? (
        <p className="surface">
          {th
            ? "ยังไม่มีข้อมูลจากเซนเซอร์ในช่วงเวลานี้"
            : "No sensor readings in this period."}
        </p>
      ) : (
        <>
          <section className="surface sensor-chart">
            <h2>{th ? "ค่าจากเซนเซอร์ในตู้เย็น" : "Fridge sensors"}</h2>
            <p className="small">
              {th
                ? "เส้นแดงคือ 100% ของค่าอ้างอิง: 8°C · VOC 250 · แสง 200 แตะหรือเลื่อนแถบด้านล่างเพื่อดูค่าจริง"
                : "Red line = reference: 8°C · VOC 250 · light 200. Scrub below to see actual readings."}
            </p>
            <div className="series-controls">
              {series.map((item) => (
                <button
                  type="button"
                  key={item.key}
                  aria-pressed={enabled.includes(item.key)}
                  disabled={enabled.length === 1 && enabled.includes(item.key)}
                  onClick={() =>
                    setEnabled(
                      enabled.includes(item.key)
                        ? enabled.filter((key) => key !== item.key)
                        : [...enabled, item.key],
                    )
                  }
                >
                  <span style={{ background: item.color }} />
                  {th ? item.th : item.en}
                </button>
              ))}
            </div>
            <svg
              viewBox="0 0 720 250"
              role="img"
              aria-label={
                th
                  ? "กราฟเซนเซอร์เทียบค่าอ้างอิง"
                  : "Sensor readings relative to reference values"
              }
              onPointerMove={(event) => {
                const bounds = event.currentTarget.getBoundingClientRect();
                const time =
                  first +
                  Math.max(
                    0,
                    Math.min(
                      1,
                      (((event.clientX - bounds.left) / bounds.width) * 720 -
                        40) /
                        640,
                    ),
                  ) *
                    span;
                let nearest = 0;
                points.forEach((point, i) => {
                  if (
                    Math.abs(point.timeS - time) <
                    Math.abs(points[nearest]!.timeS - time)
                  )
                    nearest = i;
                });
                setIndex(nearest);
              }}
            >
              <path d="M40 30V220H680" stroke="#CBD6B9" fill="none" />
              <path
                d={`M40 ${y(1)}H680`}
                stroke="#D6432C"
                strokeDasharray="6 5"
                fill="none"
              />
              <text x="682" y={y(1) + 4} fontSize="11" fill="#B83322">
                100%
              </text>
              {series
                .filter((item) => enabled.includes(item.key))
                .map((item) => {
                  const segments: string[] = [];
                  let path = "";
                  for (const point of points) {
                    const value = point[item.key];
                    if (value === null) {
                      if (path) segments.push(path);
                      path = "";
                    } else {
                      path +=
                        (path ? " L" : "M") +
                        x(point.timeS).toFixed(1) +
                        " " +
                        y(value / item.limit).toFixed(1);
                    }
                  }
                  if (path) segments.push(path);
                  return (
                    <g key={item.key}>
                      {segments.map((segment, i) => (
                        <path
                          key={i}
                          d={segment}
                          stroke={item.color}
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          fill="none"
                        />
                      ))}
                    </g>
                  );
                })}
              {selected && (
                <path
                  d={`M${x(selected.timeS)} 30V220`}
                  stroke="#161A12"
                  strokeDasharray="2 4"
                />
              )}
              {doorEvents
                .filter(
                  (event) =>
                    event.timestampS >= first && event.timestampS <= last,
                )
                .slice(0, 12)
                .map((event, i) => (
                  <g
                    key={`${event.timestampS}-${event.nodeId}-${event.status}`}
                    aria-hidden="true"
                  >
                    <rect
                      x={x(event.timestampS) - 8}
                      y={4 + (i % 2) * 13}
                      width="16"
                      height="12"
                      rx="4"
                      fill={event.status === "SUCCESS" ? "#4E7A12" : "#D6432C"}
                    />
                    <title>{event.status}</title>
                  </g>
                ))}
            </svg>
            <ul
              className="door-event-chips"
              aria-label={th ? "เหตุการณ์ประตูบนกราฟ" : "Door events on the chart"}
            >
              {doorEvents
                .filter(
                  (event) =>
                    event.timestampS >= first && event.timestampS <= last,
                )
                .slice(0, 12)
                .map((event) => (
                  <li key={event.nodeId + event.timestampS + event.status}>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => setDoor(event)}
                    >
                      {t[`door_${event.status}`]} ·{" "}
                      {localTimestamp(event.timestampS, language)}
                    </button>
                  </li>
                ))}
            </ul>
            <label className="chart-scrubber">
              {th ? "เลือกเวลาที่ต้องการดู" : "Choose a reading"}
              <input
                type="range"
                min={0}
                max={Math.max(0, points.length - 1)}
                value={Math.min(index ?? points.length - 1, points.length - 1)}
                onChange={(e) => setIndex(Number(e.target.value))}
              />
            </label>
            {selected && (
              <output className="chart-readout">
                <strong>{localTimestamp(selected.timeS, language)}</strong>
                {series.map((item) => (
                  <span key={item.key}>
                    {th ? item.th : item.en}: {selected[item.key] ?? "—"}{" "}
                    {item.unit}
                  </span>
                ))}
              </output>
            )}
            {door && (
              <output className="door-chart-event">
                {localTimestamp(door.timestampS, language)} · {door.nodeId} ·{" "}
                {t[`door_${door.status}`]}
              </output>
            )}
            <p className="small">
              {th
                ? "แสดงได้สูงสุด 2,000 ตัวอย่างและเหตุการณ์ประตูล่าสุด 25 รายการ ไม่ใช่จำนวนเหตุการณ์ทั้งหมดในช่วงเวลา"
                : "Up to 2,000 readings and 25 recent door events; not a complete event total."}
            </p>
          </section>
          <Metrics
            latest={points.at(-1) ?? null}
            history={points}
            now={now}
            language={language}
            failed={false}
          />
        </>
      )}
    </section>
  );
}
