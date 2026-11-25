import { useState } from "react";
import { DoorClosed, Package, Thermometer } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import useSWR from "swr";
import { StatusAlert } from "./components/status-alert";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./components/ui/table";
import { getJson, swrOptions } from "./lib/api";
import { localTimestamp, readDoorEventList, readSample } from "./model";
import type { DoorEvent, Language, Sample } from "./model";
import { words } from "./words";

const kinds = ["inventory", "door", "sensor"] as const;
type Kind = (typeof kinds)[number];
const icons = { inventory: Package, door: DoorClosed, sensor: Thermometer };
type ActivityRow =
  | {
      id: number;
      time: number;
      kind: "inventory";
      action: "created" | "updated" | "deleted";
      nameTh: string;
      nameEn: string;
      source: "CAMERA" | "WEB_MANUAL" | null;
    }
  | { id: number; time: number; kind: "door"; event: DoorEvent }
  | { id: number; time: number; kind: "sensor"; sample: Sample };

function parsePage(value: unknown, kind: Kind) {
  if (
    !value ||
    typeof value !== "object" ||
    !("rows" in value) ||
    !Array.isArray(value.rows)
  ) {
    throw new Error("Invalid activity response");
  }
  const rows = (value.rows as unknown[]).flatMap((row): ActivityRow[] => {
    if (
      !row ||
      typeof row !== "object" ||
      !("id" in row) ||
      typeof row.id !== "number"
    )
      return [];
    const id = row.id;
    if (kind === "door") {
      const [event] = readDoorEventList({ events: [row] });
      return event ? [{ id, time: event.timestampS, kind, event }] : [];
    }
    if (kind === "sensor") {
      const sample = readSample(row);
      return sample ? [{ id, time: sample.timeS, kind, sample }] : [];
    }
    if (
      !("action" in row) ||
      (row.action !== "created" &&
        row.action !== "updated" &&
        row.action !== "deleted") ||
      !("timestamp_s" in row) ||
      typeof row.timestamp_s !== "number" ||
      !("name_th" in row) ||
      typeof row.name_th !== "string" ||
      !("name_en" in row) ||
      typeof row.name_en !== "string"
    )
      return [];
    return [
      {
        id,
        time: row.timestamp_s,
        kind,
        action: row.action,
        nameTh: row.name_th,
        nameEn: row.name_en,
        source:
          "source" in row &&
          (row.source === "CAMERA" || row.source === "WEB_MANUAL")
            ? row.source
            : null,
      },
    ];
  });
  const next =
    "next" in value && typeof value.next === "string" ? value.next : null;
  return { rows, next };
}

const INVENTORY_ACTIONS = {
  th: { created: "เพิ่ม", updated: "แก้ไข", deleted: "นำออก" },
  en: { created: "Added", updated: "Edited", deleted: "Removed" },
} as const;

const INVENTORY_SOURCES = {
  th: { CAMERA: "กล้อง", WEB_MANUAL: "เว็บ" },
  en: { CAMERA: "Camera", WEB_MANUAL: "Web" },
} as const;

function ActivityDetail({
  row,
  language,
}: {
  row: ActivityRow;
  language: Language;
}) {
  if (row.kind === "door") {
    return (
      <>
        {words[language][`door_${row.event.status}`]} · {row.event.nodeId}
      </>
    );
  }
  if (row.kind === "sensor") {
    const { nodeId, temperature, voc, light } = row.sample;
    return (
      <>
        <strong>{nodeId}</strong>
        <br />
        {temperature ?? "—"} °C · {voc ?? "—"} VOC · {light ?? "—"} LDR
      </>
    );
  }
  const name =
    language === "th" ? row.nameTh || row.nameEn : row.nameEn || row.nameTh;
  const source = row.source ? INVENTORY_SOURCES[language][row.source] : null;
  return (
    <>
      {INVENTORY_ACTIONS[language][row.action]} <strong>{name}</strong>
      {source && <span className="small"> · {source}</span>}
    </>
  );
}

function ActivityPagination({
  language,
  pageNumber,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
}: {
  language: Language;
  pageNumber: number;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  const th = language === "th";
  if (!hasPrev && !hasNext) return null;
  return (
    <div className="history-pagination">
      <Button type="button" size="sm" disabled={!hasPrev} onClick={onPrev}>
        {th ? "ใหม่กว่า" : "Newer"}
      </Button>
      <output>
        {th ? "หน้า" : "Page"} {pageNumber}
      </output>
      <Button type="button" size="sm" disabled={!hasNext} onClick={onNext}>
        {th ? "เก่ากว่า" : "Older"}
      </Button>
    </div>
  );
}

function ActivityTable({
  rows,
  kind,
  language,
}: {
  rows: ActivityRow[];
  kind: Kind;
  language: Language;
}) {
  const th = language === "th";
  if (rows.length === 0) {
    return (
      <p className="empty-state">
        {th ? "ไม่มีรายการในช่วงนี้" : "No activity for this selection."}
      </p>
    );
  }
  const Icon = icons[kind];
  return (
    <Table
      className="history-table activity-table"
      scrollLabel={th ? "ตารางประวัติ" : "Activity table"}
    >
      <TableHeader>
        <TableRow>
          <TableHead scope="col">{th ? "เหตุการณ์" : "Activity"}</TableHead>
          <TableHead scope="col">
            {th ? "เวลา (ไทย)" : "Time (Bangkok)"}
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell>
              <Icon aria-hidden="true" size={17} />
              <span>
                <ActivityDetail row={row} language={language} />
              </span>
            </TableCell>
            <TableCell>
              <time dateTime={new Date(row.time * 1000).toISOString()}>
                {localTimestamp(row.time, language)}
              </time>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ActivityResults({
  fridgeId,
  kind,
  date,
  language,
}: {
  fridgeId: string;
  kind: Kind;
  date: string;
  language: Language;
}) {
  const th = language === "th";
  const [cursors, setCursors] = useState<string[]>([]);
  const cursor = cursors.at(-1);
  const query = new URLSearchParams({ kind });
  if (date) query.set("date", date);
  if (cursor) query.set("before", cursor);
  const state = useSWR(
    "/api/fridges/" +
      encodeURIComponent(fridgeId) +
      "/activity?" +
      query.toString(),
    (url: string) => getJson(url, (value) => parsePage(value, kind)),
    swrOptions,
  );
  const next = state.data?.next ?? null;

  return (
    <>
      {state.error && (
        <StatusAlert
          action={
            <Button size="sm" type="button" onClick={() => void state.mutate()}>
              {th ? "ลองใหม่" : "Retry"}
            </Button>
          }
        >
          {th ? "โหลดประวัติไม่ได้" : "Could not load activity"}
        </StatusAlert>
      )}
      {state.isLoading && <output>{th ? "กำลังโหลด…" : "Loading…"}</output>}
      <ActivityPagination
        language={language}
        pageNumber={cursors.length + 1}
        hasPrev={Boolean(cursor)}
        hasNext={Boolean(next)}
        onPrev={() => setCursors(cursors.slice(0, -1))}
        onNext={() => {
          if (next) setCursors([...cursors, next]);
        }}
      />
      {state.data && (
        <ActivityTable rows={state.data.rows} kind={kind} language={language} />
      )}
    </>
  );
}

export function Activity({
  fridgeId,
  language,
}: {
  fridgeId: string;
  language: Language;
}) {
  const th = language === "th";
  const [params, setParams] = useSearchParams();
  const rawDate = params.get("date") ?? "";
  const parsedDate = Date.parse(rawDate);
  const date =
    /^\d{4}-\d{2}-\d{2}$/.test(rawDate) &&
    Number.isFinite(parsedDate) &&
    new Date(parsedDate).toISOString().slice(0, 10) === rawDate
      ? rawDate
      : "";
  function updateFilter(key: "kind" | "date", value: string) {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  }
  const kind =
    kinds.find((value) => value === params.get("kind")) ?? "inventory";
  const labels = th
    ? { inventory: "อาหาร", door: "ประตู", sensor: "เซนเซอร์" }
    : { inventory: "Food", door: "Door", sensor: "Sensors" };

  return (
    <section className="chart-page">
      <div className="page-head">
        <h1>{th ? "ประวัติ" : "Activity history"}</h1>
        {kind === "sensor" && (
          <Link
            className="btn sm"
            to={{
              pathname:
                "/fridges/" + encodeURIComponent(fridgeId) + "/monitoring",
              search: params.toString(),
            }}
          >
            {th ? "ดูกราฟ" : "View charts"}
          </Link>
        )}
      </div>
      <div className="chart-filters">
        <label>
          {th ? "ประเภท" : "Type"}
          <select
            value={kind}
            onChange={(event) => updateFilter("kind", event.target.value)}
          >
            {kinds.map((value) => (
              <option key={value} value={value}>
                {labels[value]}
              </option>
            ))}
          </select>
        </label>
        <label>
          {th ? "วันที่ (ไม่ระบุ = ทุกวัน)" : "Date (blank for all days)"}
          <Input
            type="date"
            value={date}
            onChange={(event) => updateFilter("date", event.target.value)}
          />
        </label>
      </div>
      {kind === "inventory" && (
        <p className="small">
          {th
            ? "แสดงการเปลี่ยนแปลงหลังเปิดใช้การบันทึกประวัติ"
            : "Shows changes recorded after activity logging was enabled."}
        </p>
      )}
      <ActivityResults
        key={JSON.stringify([fridgeId, kind, date])}
        {...{ fridgeId, kind, date, language }}
      />
    </section>
  );
}
