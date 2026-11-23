import { ApiRequestError, getJson, swrOptions, isAccessError } from "./lib/api";
import useSWR from "swr";
export interface LineStatus {
  linked: boolean;
  ready: boolean;
  friend_url: string | null;
  kind?: "user" | "group";
  morning_enabled?: boolean;
  morning_time?: string;
  inst_obstruct?: boolean;
  inst_warm?: boolean;
  inst_spoil?: boolean;
}
export interface Favorite {
  item_key: string;
  name_th: string;
  name_en: string;
  category: string;
  count: number;
}
interface Favorites {
  items: Favorite[];
  categories: string[];
  category_counts: Record<string, number>;
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid response");
  return value as Record<string, unknown>;
}
function parseLine(value: unknown): LineStatus {
  const r = record(value);
  if (
    typeof r.linked !== "boolean" ||
    typeof r.ready !== "boolean" ||
    !(r.friend_url === null || typeof r.friend_url === "string")
  )
    throw new Error("Invalid LINE response");
  return {
    linked: r.linked,
    ready: r.ready,
    friend_url: r.friend_url,
    kind: r.kind === "user" ? "user" : "group",
    morning_enabled:
      typeof r.morning_enabled === "boolean" ? r.morning_enabled : undefined,
    morning_time:
      typeof r.morning_time === "string" ? r.morning_time : undefined,
    inst_obstruct:
      typeof r.inst_obstruct === "boolean" ? r.inst_obstruct : undefined,
    inst_warm: typeof r.inst_warm === "boolean" ? r.inst_warm : undefined,
    inst_spoil: typeof r.inst_spoil === "boolean" ? r.inst_spoil : undefined,
  };
}
function parseFavorites(value: unknown): Favorites {
  const r = record(value);
  if (!Array.isArray(r.items) || !Array.isArray(r.categories))
    throw new Error("Invalid favorites");
  return {
    items: r.items.map((v) => {
      const item = record(v);
      if (
        typeof item.item_key !== "string" ||
        typeof item.name_th !== "string" ||
        typeof item.name_en !== "string" ||
        typeof item.category !== "string" ||
        typeof item.count !== "number"
      )
        throw new Error("Invalid favorite");
      return {
        item_key: item.item_key,
        name_th: item.name_th,
        name_en: item.name_en,
        category: item.category,
        count: item.count,
      };
    }),
    category_counts: Object.fromEntries(
      Object.entries(record(r.category_counts ?? {})).filter(
        (entry): entry is [string, number] => typeof entry[1] === "number",
      ),
    ),
    categories: r.categories.filter((c): c is string => typeof c === "string"),
  };
}
export function useLineStatus(url: string, pending = false) {
  const result = useSWR(url, (key) => getJson(key, parseLine), {
    ...swrOptions,
    refreshInterval: (data: LineStatus | undefined) =>
      data?.linked ? 30000 : pending ? 3000 : 30000,
  });
  return {
    ...result,
    data: isAccessError(result.error) ? undefined : result.data,
  };
}
export function useFavorites(fridgeId: string) {
  const result = useSWR(
    fridgeId ? `/api/fridges/${encodeURIComponent(fridgeId)}/favorites` : null,
    (key) => getJson(key, parseFavorites),
    swrOptions,
  );
  return {
    ...result,
    data: isAccessError(result.error) ? undefined : result.data,
  };
}
export async function lineAction(
  url: string,
  method: string,
  body?: unknown,
): Promise<unknown> {
  const response = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new ApiRequestError(response.status);
  return response.json();
}
export function parsePairing(value: unknown): {
  code: string;
  expires_at_s: number;
} {
  const r = record(value);
  if (typeof r.code !== "string" || typeof r.expires_at_s !== "number")
    throw new Error("Invalid pairing response");
  return { code: r.code, expires_at_s: r.expires_at_s };
}
function pairingKey(url: string): string {
  return `foodwarden_line_pair:${url}`;
}
export function readStoredPairing(
  url: string,
  nowS = Math.floor(Date.now() / 1000),
): { code: string; expires_at_s: number } | null {
  try {
    const raw = sessionStorage.getItem(pairingKey(url));
    if (!raw) return null;
    const parsed = parsePairing(JSON.parse(raw));
    if (parsed.expires_at_s <= nowS) {
      sessionStorage.removeItem(pairingKey(url));
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
export function writeStoredPairing(
  url: string,
  value: { code: string; expires_at_s: number } | null,
): void {
  try {
    if (value) sessionStorage.setItem(pairingKey(url), JSON.stringify(value));
    else sessionStorage.removeItem(pairingKey(url));
  } catch {
    /* Ignore storage errors in restricted browsing modes. */
  }
}
export function clearStoredPairings(): void {
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const key = sessionStorage.key(i);
      if (key?.startsWith("foodwarden_line_pair:"))
        sessionStorage.removeItem(key);
    }
  } catch {
    /* Ignore storage errors. */
  }
}
export function favoriteMatches(
  favorite: Favorite,
  food: { nameTh: string; nameEn: string; category: string },
) {
  const norm = (s: string) => s.trim().normalize("NFKC").toLowerCase();
  return (
    norm(favorite.name_th) === norm(food.nameTh) &&
    norm(favorite.name_en) === norm(food.nameEn) &&
    norm(favorite.category) === norm(food.category)
  );
}
