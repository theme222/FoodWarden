import type { ReactNode } from "react";
import { localTimestamp } from "./model";
import type { Language, Sample } from "./model";
import { words } from "./words";

const metrics = [
  { key: "temperature", label: "temperature", unit: "°C", icon: <><path d="M10 13.5V5a2 2 0 0 1 4 0v8.5a4 4 0 1 1-4 0Z"/><path d="M12 9v7"/></> },
  { key: "voc", label: "voc", unit: "VOC", icon: <><path d="M3 8h13a2 2 0 1 0-2-2M3 12h16a2 2 0 1 1-2 2M3 16h9a2 2 0 1 1-2 2"/></> },
  { key: "light", label: "light", unit: "LDR", icon: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></> },
] as const;

type Key = (typeof metrics)[number]["key"];

function SensorIcon({ children }: { children: ReactNode }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{children}</svg>;
}

export function chartPoints(samples: Sample[], key: Key, now: number) {
  const start = now - 3600;
  const values = samples.filter((sample) => sample.timeS >= start && sample.timeS <= now)
    .sort((a, b) => a.timeS - b.timeS);
  const readings = values.flatMap((sample) => sample[key] === null ? [] : [sample[key]]);
  if (readings.length === 0) return [];

  const min = Math.min(...readings);
  const max = Math.max(...readings);
  const segments: Array<Array<[number, number]>> = [];
  let segment: Array<[number, number]> = [];
  let lastTime = start;
  for (const sample of values) {
    const value = sample[key];
    if (value === null || sample.timeS - lastTime > 360) {
      if (segment.length) segments.push(segment);
      segment = [];
    }
    if (value !== null) {
      const x = 4 + (sample.timeS - start) * 232 / 3600;
      const y = max === min ? 23 : 42 - (value - min) * 38 / (max - min);
      segment.push([x, y]);
    }
    lastTime = sample.timeS;
  }
  if (segment.length) segments.push(segment);
  return segments;
}

export function Metrics({ latest, history, now, language, failed }: {
  latest: Sample | null; history: Sample[]; now: number; language: Language; failed: boolean;
}) {
  const t = words[language];
  const currentHistory = latest ? history.filter((sample) => sample.nodeId === latest.nodeId) : [];
  return <section aria-label={t.history}>
    <div className="metrics">
      {metrics.map(({ key, label, unit, icon }) => {
        const value = latest?.[key] ?? null;
        const segments = chartPoints(currentHistory, key, now);
        return <article className={"metric metric-" + key} key={key}>
          <h2><SensorIcon>{icon}</SensorIcon>{t[label]}</h2>
          <p className="metric-value">{value === null ? "—" : new Intl.NumberFormat(language, {
            maximumFractionDigits: key === "temperature" ? 1 : 0,
          }).format(value)} <span>{unit}</span></p>
          {segments.length ? <svg className="sparkline" viewBox="0 0 240 46" role="img"
            aria-label={t[label] + " · " + t.history}>
            <path d="M4 43h232" fill="none" stroke="var(--border)" />
            {segments.map((points, index) => points.length === 1
              ? <circle key={index} cx={points[0]?.[0]} cy={points[0]?.[1]} r="3" fill="currentColor" />
              : <polyline key={index} points={points.map(([x, y]) => x + "," + y).join(" ")}
                fill="none" stroke="currentColor" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />)}
          </svg> : <p className="chart-empty">{t.noHistory}</p>}
        </article>;
      })}
    </div>
    {failed ? <p role="status">{t.failed}</p> : <p className="small">{latest
      ? t.sensor + " " + latest.nodeId + " · " + t.lastReading + " " + localTimestamp(latest.timeS, language) + " · " + t.history
      : t.waitingReadings}</p>}
  </section>;
}
