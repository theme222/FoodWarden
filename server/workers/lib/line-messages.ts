import type { AppBindings } from "../types";
import { capLineText } from "./line-format";

export type LineTestState = "queued" | "accepted" | "failed";

export function fridgePath(id: string): string {
  return `/fridges/${encodeURIComponent(id)}`;
}
function bangkokDay(timestamp: number): string {
  return new Date((timestamp + 7 * 3600) * 1000).toISOString().slice(0, 10);
}
function lineClock(timestamp: number): string {
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(timestamp * 1000);
}
export function shortLineLabel(value: string, limit = 80): string {
  return capLineText(
    value
      .replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, " ")
      .replace(/\b(?:https?:\/\/|www\.)\S+/gi, "")
      .trim(),
    limit,
  );
}
export function lineMessage(
  env: AppBindings,
  title: string,
  lines: string[],
  action: string,
  path: string,
): string {
  const content = capLineText(
    [title, ...lines.filter(Boolean)].join("\n"),
    420,
  );
  try {
    const configured = new URL(env.BETTER_AUTH_URL ?? "");
    const link = new URL(path, configured.origin);
    if (configured.protocol === "https:" && link.origin === configured.origin)
      return `${content}\n\n${action}\n${link.href}`;
  } catch {
    return content;
  }
  return content;
}
export const doorNotices = {
  OBSTRUCTION_ERROR: ["พบสิ่งกีดขวางที่ประตู", "ตรวจว่าประตูปิดสนิทและมีสิ่งกีดขวางหรือไม่"],
  TIMEOUT_ERROR: ["ประตูปิดไม่สำเร็จ", "ตรวจประตูและสิ่งกีดขวาง"],
  FAULT_LOCKOUT: ["ชุดปิดประตูแจ้งข้อขัดข้อง", "ตรวจสถานะอุปกรณ์บนเว็บ"],
  CONTRADICTION_ERROR: ["เซนเซอร์ประตูรายงานไม่ตรงกัน", "ตรวจว่าประตูปิดสนิท"],
} as const;
export function doorLineMessage(
  env: AppBindings,
  fridgeId: string,
  name: string,
  timestamp: number,
  notice: readonly [string, string],
) {
  return lineMessage(
    env,
    notice[0],
    [`${shortLineLabel(name)} · ${lineClock(timestamp)}`, notice[1]],
    "ดูประวัติประตู",
    `${fridgePath(fridgeId)}/monitoring/history?kind=door&date=${bangkokDay(timestamp)}`,
  );
}
export function sensorLineMessage(
  env: AppBindings,
  fridgeId: string,
  name: string,
  timestamp: number,
  metric: "temperature" | "voc",
  value: number,
  nodeId: string,
) {
  const warm = metric === "temperature";
  return lineMessage(
    env,
    warm ? "อุณหภูมิตู้เย็นสูง" : "ดัชนี VOC สูง",
    [
      `${shortLineLabel(name)} · ${lineClock(timestamp)}`,
      warm
        ? `${value.toFixed(1)}°C · ตรวจว่าประตูปิดสนิท`
        : `${Math.round(value)} · ตรวจอาหารในตู้`,
    ],
    "ดูกราฟ",
    `${fridgePath(fridgeId)}/monitoring?${new URLSearchParams({ metric, node: nodeId })}`,
  );
}
export function lineFoodLabel(
  item: { name_th: string; name_en: string; estimated_expiry_date: string },
  today: string,
): string {
  const expiry =
    item.estimated_expiry_date < today
      ? "หมดอายุแล้ว"
      : item.estimated_expiry_date === today
        ? "หมดอายุวันนี้"
        : `หมดอายุ ${item.estimated_expiry_date}`;
  return `${shortLineLabel(item.name_th || item.name_en, 48)} · ${expiry}`;
}
