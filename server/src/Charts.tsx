import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import useSWR from "swr";
import { useNow } from "./data";
import { StatusAlert } from "./components/status-alert";
import { getJson, swrOptions } from "./lib/api";
import { localTimestamp, readBucket } from "./model";
import type { Language, Sample } from "./model";
import { CHART_SERIES, toggleSeriesSafely } from "./state/dashboard-machine";
import type { ChartRange, SeriesKey } from "./state/dashboard-machine";

const ranges = { "1h": 3600, "24h": 86400, "7d": 604800, "30d": 2592000 };
const periods = [
  ["1h", "1 ชั่วโมง", "1 hour"],
  ["24h", "24 ชั่วโมง", "24 hours"],
  ["7d", "7 วัน", "7 days"],
  ["30d", "30 วัน", "30 days"],
] as const;
const PAGE_SIZE = 10;
type Series = (typeof CHART_SERIES)[number];
type AxisTickMode = "time" | "dateTime" | "date";

const AXIS_TIME_FORMATTERS: Record<
  Language,
  Record<AxisTickMode, Intl.DateTimeFormat>
> = {
  th: {
    time: new Intl.DateTimeFormat("th-TH", {
      timeZone: "Asia/Bangkok",
      hour: "2-digit",
      minute: "2-digit",
    }),
    dateTime: new Intl.DateTimeFormat("th-TH", {
      timeZone: "Asia/Bangkok",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }),
    date: new Intl.DateTimeFormat("th-TH", {
      timeZone: "Asia/Bangkok",
      day: "numeric",
      month: "short",
    }),
  },
  en: {
    time: new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Bangkok",
      hour: "2-digit",
      minute: "2-digit",
    }),
    dateTime: new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Bangkok",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }),
    date: new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Bangkok",
      day: "numeric",
      month: "short",
    }),
  },
};

function selectAxisTimeFormatter(
  language: Language,
  plottedSeconds: number,
): Intl.DateTimeFormat {
  const mode: AxisTickMode =
    plottedSeconds <= ranges["24h"]
      ? "time"
      : plottedSeconds < ranges["7d"]
        ? "dateTime"
        : "date";
  return AXIS_TIME_FORMATTERS[language][mode];
}

function mergeTelemetryWithLatest(
  saved: Sample[],
  latest: Sample | null,
  minTimeS: number,
): Sample[] {
  if (!latest || latest.timeS < minTimeS) return saved;
  return [
    ...saved.filter(
      (sample) =>
        sample.timeS !== latest.timeS || sample.nodeId !== latest.nodeId,
    ),
    latest,
  ].sort((a, b) => a.timeS - b.timeS);
}

function ReadingTable({
  points,
  language,
  series,
}: {
  points: Sample[];
  language: Language;
  series: Series[];
}) {
  const [page, setPage] = useState(0);
  const th = language === "th";
  const pages = Math.ceil(points.length / PAGE_SIZE);
  const current = Math.min(page, pages - 1);
  const end = points.length - current * PAGE_SIZE;
  const rows = points.slice(Math.max(0, end - PAGE_SIZE), end).reverse();

  return (
    <details className="history-readings">
      <summary>
        {th ? "ตารางค่าที่วัดได้" : "Readings table"} ({points.length})
      </summary>
      <table className="history-table chart-reading-table">
        <thead>
          <tr>
            <th scope="col">{th ? "เวลา (ไทย)" : "Time (Bangkok)"}</th>
            {series.map(({ key, th: thai, en, unit }) => (
              <th key={key} scope="col">
                {key === "voc" ? "VOC" : (th ? thai : en) + " (" + unit + ")"}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.timeS}>
              <td>{localTimestamp(row.timeS, language)}</td>
              {series.map(({ key }) => (
                <td key={key}>{row[key] ?? "—"}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="history-pagination">
        <button
          type="button"
          className="btn sm"
          disabled={current === 0}
          onClick={() => setPage(current - 1)}
        >
          {th ? "ใหม่กว่า" : "Newer"}
        </button>
        <output>
          {current + 1} / {pages}
        </output>
        <button
          type="button"
          className="btn sm"
          disabled={current + 1 >= pages}
          onClick={() => setPage(current + 1)}
        >
          {th ? "เก่ากว่า" : "Older"}
        </button>
      </div>
    </details>
  );
}

function SensorPlot({
  series,
  points,
  language,
  axisTime,
  height,
  readingTime,
}: {
  series: Series;
  points: Sample[];
  language: Language;
  axisTime: Intl.DateTimeFormat;
  height: number;
  readingTime: number | null;
}) {
  const th = language === "th";
  const metric = series.key;
  const label = th ? series.th : series.en;
  const valueCount = points.filter((point) => point[metric] !== null).length;
  return (
    <div className="sensor-series">
      <h2>{metric === "voc" ? label : `${label} (${series.unit})`}</h2>
      {valueCount > 0 ? (
        <ResponsiveContainer width="100%" height={height} minWidth={0}>
          <LineChart data={points} margin={{ right: 16, top: 12, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="timeS"
              type="number"
              domain={["dataMin", "dataMax"]}
              tickFormatter={(time: number) => axisTime.format(time * 1000)}
              minTickGap={28}
            />
            <YAxis
              width={42}
              domain={[
                (min: number) => Math.min(min, series.limit),
                (max: number) => Math.max(max, series.limit),
              ]}
            />
            <ReferenceLine
              y={series.limit}
              stroke="var(--muted-ink)"
              strokeDasharray="4 4"
            />
            {readingTime !== null && (
              <ReferenceLine x={readingTime} stroke="var(--control-border)" />
            )}
            <Tooltip
              labelFormatter={(time) => localTimestamp(Number(time), language)}
            />
            <Line
              dataKey={metric}
              name={label}
              unit={" " + series.unit}
              stroke={series.textColor}
              strokeWidth={2}
              dot={valueCount === 1}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <p className="small">
          {th
            ? "เซนเซอร์ไม่ได้ส่งค่านี้ในช่วงที่เลือก"
            : "No values for this metric in the selected period."}
        </p>
      )}
      {valueCount > 0 && (
        <p className="small">
          {th ? "เส้นประแสดงเกณฑ์" : "Dashed line shows the threshold"} (
          {series.limit} {series.unit})
        </p>
      )}
    </div>
  );
}

type ChartsProps = {
  fridgeId: string;
  language: Language;
  latest: Sample | null;
};

export function Charts(props: ChartsProps) {
  const [params] = useSearchParams();
  const linkedMetric = CHART_SERIES.find(
    ({ key }) => key === params.get("metric"),
  );
  const initialMetric = linkedMetric?.key ?? "temperature";
  return (
    <ChartContents
      key={props.fridgeId + "/" + initialMetric}
      initialMetric={initialMetric}
      {...props}
    />
  );
}

function ChartFilterControls({
  language,
  metrics,
  onToggleMetric,
  range,
  onChangeRange,
  nodes,
  activeNode,
  onChangeNode,
}: {
  language: Language;
  metrics: SeriesKey[];
  onToggleMetric: (key: SeriesKey) => void;
  range: ChartRange;
  onChangeRange: (next: ChartRange) => void;
  nodes: string[];
  activeNode: string | undefined;
  onChangeNode: (id: string) => void;
}) {
  const th = language === "th";
  const periodIndex = periods.findIndex(([key]) => key === range);
  const period = periods[periodIndex] ?? periods[1];

  return (
    <div className="chart-filters">
      <fieldset className="visible-choices">
        <legend>{th ? "ค่าที่แสดง" : "Metrics"}</legend>
        <div>
          {CHART_SERIES.map((entry) => {
            const active = metrics.includes(entry.key);
            const lastActive = active && metrics.length <= 1;
            return (
              <label key={entry.key}>
                <input
                  type="checkbox"
                  checked={active}
                  disabled={lastActive}
                  onChange={() => onToggleMetric(entry.key)}
                />
                {th ? (entry.key === "voc" ? "ค่า VOC" : entry.th) : entry.en}
              </label>
            );
          })}
        </div>
      </fieldset>
      <div className="chart-period">
        <div className="chart-period-label">
          <label htmlFor="chart-period">{th ? "ช่วงเวลา" : "Time range"}</label>
          <strong>{th ? period[1] : period[2]}</strong>
        </div>
        <input
          id="chart-period"
          type="range"
          min={0}
          max={periods.length - 1}
          step={1}
          value={periodIndex}
          aria-valuetext={th ? period[1] : period[2]}
          onChange={(event) => {
            const next = periods[Number(event.currentTarget.value)];
            if (next && next[0] !== range) onChangeRange(next[0]);
          }}
        />
        <div className="chart-period-stops" aria-hidden="true">
          {periods.map(([key, thai, english]) => (
            <span key={key}>{th ? thai : english}</span>
          ))}
        </div>
      </div>
      {nodes.length > 0 && (
        <label>
          {th ? "เซนเซอร์" : "Sensor"}
          <select
            value={activeNode ?? ""}
            onChange={(event) => onChangeNode(event.target.value)}
          >
            <option value="">{th ? "อัตโนมัติ" : "Automatic"}</option>
            {nodes.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

function ChartPlotPanel({
  series,
  points,
  selected,
  selectedIndex,
  language,
  axisTime,
  onSelectTime,
}: {
  series: Series[];
  points: Sample[];
  selected: Sample;
  selectedIndex: number;
  language: Language;
  axisTime: Intl.DateTimeFormat;
  onSelectTime: (timeS: number | null) => void;
}) {
  const th = language === "th";
  return (
    <section
      className="panel sensor-plot"
      aria-label={th ? "ค่าจากเซนเซอร์" : "Sensor values"}
    >
      <div className="sensor-series-list">
        {series.map((item) => (
          <SensorPlot
            key={item.key}
            series={item}
            points={points}
            language={language}
            axisTime={axisTime}
            height={series.length > 1 ? 170 : 230}
            readingTime={selectedIndex >= 0 ? selected.timeS : null}
          />
        ))}
      </div>
      <label className="chart-scrubber">
        {th ? "เลือกเวลาที่ต้องการดู" : "Choose a reading"}
        <input
          type="range"
          min={0}
          max={points.length - 1}
          value={selectedIndex === -1 ? points.length - 1 : selectedIndex}
          disabled={points.length === 1}
          aria-valuetext={localTimestamp(selected.timeS, language)}
          onChange={(event) =>
            onSelectTime(points[Number(event.target.value)]?.timeS ?? null)
          }
        />
      </label>
      <output className="reading-selected">
        <time dateTime={new Date(selected.timeS * 1000).toISOString()}>
          {localTimestamp(selected.timeS, language)}
        </time>
        {series.map(({ key, th: thai, en, unit }) => (
          <strong key={key}>
            {th ? thai : en}: {selected[key] ?? "—"} {unit}
          </strong>
        ))}
      </output>
    </section>
  );
}

function ChartResultsView({
  series,
  points,
  selected,
  selectedIndex,
  language,
  axisTime,
  range,
  activeNode,
  hasError,
  isLoading,
  onSelectTime,
}: {
  series: Series[];
  points: Sample[];
  selected: Sample | undefined;
  selectedIndex: number;
  language: Language;
  axisTime: Intl.DateTimeFormat;
  range: ChartRange;
  activeNode: string | undefined;
  hasError: boolean;
  isLoading: boolean;
  onSelectTime: (timeS: number | null) => void;
}) {
  const th = language === "th";
  if (!series.length) {
    return (
      <p className="empty-state">
        {th
          ? "เลือกค่าที่ต้องการแสดงบนกราฟ"
          : "Select metrics to show on the chart."}
      </p>
    );
  }
  if (!selected) {
    if (hasError || isLoading) return null;
    return (
      <p className="empty-state">
        {th ? "ยังไม่มีค่าจากเซนเซอร์ในช่วงนี้" : "No sensor readings in this period."}
      </p>
    );
  }
  return (
    <>
      <ChartPlotPanel
        series={series}
        points={points}
        selected={selected}
        selectedIndex={selectedIndex}
        language={language}
        axisTime={axisTime}
        onSelectTime={onSelectTime}
      />
      <ReadingTable
        key={range + activeNode}
        points={points}
        language={language}
        series={series}
      />
    </>
  );
}

function ChartContents({
  fridgeId,
  language,
  latest,
  initialMetric,
}: ChartsProps & { initialMetric: SeriesKey }) {
  const th = language === "th";
  const now = useNow();
  const [metrics, setMetrics] = useState<SeriesKey[]>([initialMetric]);
  const series = CHART_SERIES.filter(({ key }) => metrics.includes(key));
  const [params, setParams] = useSearchParams();
  const range: ChartRange =
    periods.find(([key]) => key === params.get("range"))?.[0] ?? "24h";
  const requestedNode = params.get("node") ?? "";
  const node =
    requestedNode.length <= 128 && !/[\p{Cc}]/u.test(requestedNode)
      ? requestedNode
      : "";
  function setChartFilter(key: "range" | "node", value: string) {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
    setSelectedTime(null);
  }
  const [selectedTime, setSelectedTime] = useState<number | null>(null);
  const base = "/api/fridges/" + encodeURIComponent(fridgeId);
  const state = useSWR(
    base + "/telemetry?range=" + range,
    (url: string) => getJson(url, readBucket),
    {
      ...swrOptions,
      refreshInterval: 30000,
    },
  );
  const allPoints = useMemo(
    () =>
      mergeTelemetryWithLatest(state.data ?? [], latest, now - ranges[range]),
    [state.data, latest, range, now],
  );
  const nodes = [
    ...new Set(
      allPoints.map((point) => point.nodeId).concat(node ? [node] : []),
    ),
  ].sort();
  const activeNode =
    [node, latest?.nodeId].find(
      (id): id is string => id !== undefined && nodes.includes(id),
    ) ?? nodes[0];
  const points = allPoints.filter((point) => point.nodeId === activeNode);
  const index = points.findIndex((point) => point.timeS === selectedTime);
  const selected = points[index] ?? points.at(-1);
  const plottedSeconds = (points.at(-1)?.timeS ?? 0) - (points[0]?.timeS ?? 0);
  const axisTime = selectAxisTimeFormatter(language, plottedSeconds);

  return (
    <section className="chart-page">
      <div className="page-head">
        <h1>{th ? "กราฟเซนเซอร์" : "Sensor charts"}</h1>
        <Link
          className="btn sm"
          to={{
            pathname:
              "/fridges/" +
              encodeURIComponent(fridgeId) +
              "/monitoring/history",
            search: new URLSearchParams({
              ...Object.fromEntries(params),
              kind: "door",
            }).toString(),
          }}
        >
          {th ? "ประวัติประตู" : "Door history"}
        </Link>
      </div>
      <ChartFilterControls
        language={language}
        metrics={metrics}
        onToggleMetric={(key) =>
          setMetrics((prev) => toggleSeriesSafely(prev, key))
        }
        range={range}
        onChangeRange={(nextRange) => {
          setChartFilter("range", nextRange);
        }}
        nodes={nodes}
        activeNode={activeNode}
        onChangeNode={(nextNode) => {
          setChartFilter("node", nextNode);
        }}
      />
      {state.error && (
        <StatusAlert
          action={
            <button
              type="button"
              className="btn sm"
              onClick={() => void state.mutate()}
            >
              {th ? "ลองใหม่" : "Retry"}
            </button>
          }
        >
          {th ? "โหลดค่าจากเซนเซอร์ไม่ได้" : "Could not load sensor readings"}
        </StatusAlert>
      )}
      {state.isLoading && <output>{th ? "กำลังโหลด…" : "Loading…"}</output>}
      <ChartResultsView
        series={series}
        points={points}
        selected={selected}
        selectedIndex={index}
        language={language}
        axisTime={axisTime}
        range={range}
        activeNode={activeNode}
        hasError={Boolean(state.error)}
        isLoading={state.isLoading}
        onSelectTime={setSelectedTime}
      />
    </section>
  );
}
