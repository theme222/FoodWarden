import { useState } from "react";
import useSWR from "swr";
import { StatusAlert } from "@/components/status-alert";
import { Button } from "@/components/ui/button";
import { getJson, isAccessError, swrOptions } from "@/lib/api";
import type { Language } from "@/model";

type Bucket = { online: number; offline: number; unknown: number };
type Uptime = {
  startS: number;
  endS: number;
  bucketS: number;
  nodes: { id: string; buckets: Bucket[] }[];
};
const colors = {
  online: "bg-fresh",
  offline: "bg-destructive",
  unknown: "bg-muted",
} as const;

function readUptime(value: unknown): Uptime {
  if (typeof value !== "object" || !value)
    throw new Error("Invalid uptime response.");
  const report = value as Partial<Uptime>;
  const { startS, endS, bucketS, nodes } = report;
  if (
    !Number.isSafeInteger(startS) ||
    !Number.isSafeInteger(endS) ||
    !Number.isSafeInteger(bucketS) ||
    !Array.isArray(nodes) ||
    nodes.some(
      (node) =>
        typeof node?.id !== "string" ||
        !Array.isArray(node.buckets) ||
        node.buckets.length !== 24 ||
        node.buckets.some(
          (bucket) =>
            !bucket ||
            Object.keys(colors).some((key) => {
              const duration = bucket[key as keyof Bucket];
              return !Number.isSafeInteger(duration) || duration < 0;
            }),
        ),
    )
  )
    throw new Error("Invalid uptime response.");
  return report as Uptime;
}

export function DeviceUptime({
  fridgeId,
  language,
}: {
  fridgeId: string;
  language: Language;
}) {
  const th = language === "th";
  const [range, setRange] = useState<"24h" | "72h">("24h");
  const state = useSWR(
    `/api/fridges/${encodeURIComponent(fridgeId)}/uptime?range=${range}`,
    (url: string) => getJson(url, readUptime),
    { ...swrOptions, refreshInterval: 60_000 },
  );
  const title = th ? "ประวัติการเชื่อมต่อ" : "Connection history";
  const report = isAccessError(state.error) ? undefined : state.data;
  const labels = {
    online: th ? "ออนไลน์" : "Online",
    offline: th ? "ไม่ออนไลน์" : "Offline",
    unknown: th ? "ไม่ทราบ" : "Unknown",
  };
  const formatTime = new Intl.DateTimeFormat(th ? "th-TH" : "en-GB", {
    timeZone: "Asia/Bangkok",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const percent = (value: number) =>
    new Intl.NumberFormat(language, {
      style: "percent",
      maximumFractionDigits: 1,
    }).format(value);

  return (
    <section
      className="grid gap-3 rounded-lg border border-border bg-card p-3 sm:p-4"
      aria-labelledby="device-uptime-title"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="device-uptime-title">{title}</h2>
        <fieldset className="flex gap-1">
          <legend className="sr-only">{th ? "ช่วงเวลา" : "Time range"}</legend>
          {(["24h", "72h"] as const).map((option) => (
            <Button
              key={option}
              type="button"
              size="sm"
              variant={range === option ? "secondary" : "ghost"}
              className="pointer-coarse:min-h-11"
              aria-pressed={range === option}
              onClick={() => setRange(option)}
            >
              {th ? `${option.slice(0, -1)} ชม.` : option}
            </Button>
          ))}
        </fieldset>
      </div>
      {state.error && (
        <StatusAlert
          action={
            !isAccessError(state.error) && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => void state.mutate().catch(() => {})}
              >
                {th ? "ลองใหม่" : "Retry"}
              </Button>
            )
          }
        >
          {report
            ? th
              ? "อัปเดตประวัติล่าสุดไม่ได้"
              : "Could not refresh connection history"
            : th
              ? "โหลดประวัติการเชื่อมต่อไม่ได้"
              : "Could not load connection history"}
        </StatusAlert>
      )}
      {!report && !state.error && (
        <output>{th ? "กำลังโหลดประวัติ…" : "Loading connection history…"}</output>
      )}
      {report && (
        <>
          <p className="text-sm text-muted-foreground">
            {th
              ? "เปอร์เซ็นต์คำนวณจากช่วงที่ทราบสถานะเท่านั้น ประวัติเริ่มเมื่อระบบได้รับรายงานหลังเปิดใช้การเก็บข้อมูล"
              : "Uptime uses only time with a known status. History starts with reports received after collection was enabled."}
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {Object.entries(labels).map(([key, label]) => (
              <span key={key} className="flex items-center gap-1.5">
                <span
                  className={`size-3 rounded-sm border border-border ${colors[key as keyof Bucket]}`}
                  aria-hidden="true"
                />
                {label}
              </span>
            ))}
          </div>
          <ul className="grid gap-3">
            {report.nodes.map(({ id, buckets }) => {
              const total = buckets.reduce(
                (sum, bucket) => sum + bucket.online + bucket.offline,
                0,
              );
              const online = buckets.reduce(
                (sum, bucket) => sum + bucket.online,
                0,
              );
              return (
                <li key={id} className="grid gap-1.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                    <strong>{id}</strong>
                    <span className="text-sm tabular-nums">
                      {total
                        ? percent(online / total)
                        : th
                          ? "ยังไม่มีข้อมูล"
                          : "No measurements"}
                      {total > 0 && (
                        <span className="ml-2 text-muted-foreground">
                          {th ? "มีข้อมูล" : "Coverage"}{" "}
                          {percent(total / (report.endS - report.startS))}
                          {" · "}
                          {Math.floor(total / 3600)}
                          {th ? " ชม. " : "h "}
                          {Math.floor((total % 3600) / 60)}
                          {th ? " นาที" : "m"}
                        </span>
                      )}
                    </span>
                  </div>
                  <div
                    aria-hidden="true"
                    className="flex h-3 gap-px overflow-hidden rounded-sm"
                  >
                    {buckets.map((bucket, index) => (
                      <div
                        key={index}
                        className="flex min-w-0 flex-1"
                        title={formatTime.format(
                          (report.startS + index * report.bucketS) * 1000,
                        )}
                      >
                        {(Object.keys(colors) as (keyof Bucket)[]).map(
                          (key) => (
                            <span
                              key={key}
                              className={colors[key]}
                              style={{
                                width: `${(100 * bucket[key]) / report.bucketS}%`,
                              }}
                            />
                          ),
                        )}
                      </div>
                    ))}
                  </div>
                  {total > 0 && (
                    <details className="text-sm text-muted-foreground">
                      <summary className="w-fit cursor-pointer rounded-sm">
                        {th ? "ดูรายละเอียดรายช่วง" : "View interval details"}
                      </summary>
                      <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                        {buckets.map((bucket, index) => (
                          <li key={index}>
                            {formatTime.format(
                              (report.startS + index * report.bucketS) * 1000,
                            )}{" "}
                            ·{" "}
                            {(Object.keys(labels) as (keyof Bucket)[])
                              .map(
                                (key) =>
                                  `${labels[key]} ${percent(bucket[key] / report.bucketS)}`,
                              )
                              .join(" · ")}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap justify-between gap-x-3 text-xs text-muted-foreground">
            <time dateTime={new Date(report.startS * 1000).toISOString()}>
              {formatTime.format(report.startS * 1000)}
            </time>
            <time dateTime={new Date(report.endS * 1000).toISOString()}>
              {formatTime.format(report.endS * 1000)}
            </time>
          </div>
        </>
      )}
    </section>
  );
}
