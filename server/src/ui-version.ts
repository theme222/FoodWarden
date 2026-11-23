export type UiVersion = "v1" | "v2";

export type UiVersionSource =
  | "server_lock"
  | "query"
  | "storage"
  | "server"
  | "build"
  | "fallback";

export interface UiVersionConfig {
  defaultVersion: UiVersion;
  locked: boolean;
}

export interface ResolveUiVersionInput {
  search: string;
  stored: string | null;
  serverConfig: UiVersionConfig | null;
  buildDefault?: string | null;
}

export interface ResolvedUiVersion {
  version: UiVersion;
  source: UiVersionSource;
  locked: boolean;
  nextStorage: UiVersion | null | "unchanged";
}

const UI_VERSION_STORAGE_KEY = "foodwarden_ui_version";

function parseUiVersion(
  raw: string | null | undefined,
): UiVersion | null {
  if (typeof raw !== "string") return null;
  const norm = raw.trim().toLowerCase();
  if (norm === "v1" || norm === "v2") return norm;
  return null;
}

/**
 * Pure, deterministic resolver for production v2 / classic v1 rollback flags.
 * Precedence:
 * 1. Emergency server lock (`UI_VERSION_LOCK=true`) overrides everything.
 * 2. Explicit query override (`?ui=v1`, `?ui=v2`, or `?ui=reset` to clear storage).
 * 3. Stored user/device choice in `localStorage`.
 * 4. Server default (`UI_VERSION` from `/api/ui/config`).
 * 5. Build-time fallback (`VITE_UI_VERSION`).
 * 6. Built-in default `"v2"`.
 */
export function resolveUiVersion(
  input: ResolveUiVersionInput,
): ResolvedUiVersion {
  if (input.serverConfig?.locked) {
    return {
      version: input.serverConfig.defaultVersion,
      source: "server_lock",
      locked: true,
      nextStorage: "unchanged",
    };
  }

  let queryRaw: string | null = null;
  try {
    queryRaw = new URLSearchParams(input.search).get("ui");
  } catch {
    queryRaw = null;
  }
  const normalizedQuery = queryRaw?.trim().toLowerCase() ?? "";

  if (normalizedQuery === "reset") {
    const serverVer = input.serverConfig?.defaultVersion ?? null;
    if (serverVer) {
      return {
        version: serverVer,
        source: "server",
        locked: false,
        nextStorage: null,
      };
    }
    const buildVer = parseUiVersion(input.buildDefault);
    if (buildVer) {
      return {
        version: buildVer,
        source: "build",
        locked: false,
        nextStorage: null,
      };
    }
    return {
      version: "v2",
      source: "fallback",
      locked: false,
      nextStorage: null,
    };
  }

  const queryVer = parseUiVersion(normalizedQuery);
  if (queryVer) {
    return {
      version: queryVer,
      source: "query",
      locked: false,
      nextStorage: queryVer,
    };
  }

  const storedVer = parseUiVersion(input.stored);
  if (storedVer) {
    return {
      version: storedVer,
      source: "storage",
      locked: false,
      nextStorage: "unchanged",
    };
  }

  if (input.serverConfig) {
    return {
      version: input.serverConfig.defaultVersion,
      source: "server",
      locked: false,
      nextStorage: "unchanged",
    };
  }

  const buildVer = parseUiVersion(input.buildDefault);
  if (buildVer) {
    return {
      version: buildVer,
      source: "build",
      locked: false,
      nextStorage: "unchanged",
    };
  }

  return {
    version: "v2",
    source: "fallback",
    locked: false,
    nextStorage: "unchanged",
  };
}

export function readStoredUiVersion(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(UI_VERSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writeStoredUiVersion(next: UiVersion | null): void {
  if (typeof window === "undefined") return;
  try {
    if (next === null) {
      window.localStorage.removeItem(UI_VERSION_STORAGE_KEY);
    } else {
      window.localStorage.setItem(UI_VERSION_STORAGE_KEY, next);
    }
  } catch {
    /* Ignore storage access errors in restricted browsing contexts. */
  }
}

export function applyUiVersionToDom(version: UiVersion): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.ui = version;
}

export async function fetchUiConfig(): Promise<UiVersionConfig> {
  try {
    const res = await fetch("/api/ui/config", { credentials: "same-origin" });
    if (!res.ok) return { defaultVersion: "v2", locked: false };
    const raw: unknown = await res.json();
    if (typeof raw !== "object" || raw === null) {
      return { defaultVersion: "v2", locked: false };
    }
    const obj = raw as Record<string, unknown>;
    const parsedVersion = parseUiVersion(
      typeof obj.defaultVersion === "string" ? obj.defaultVersion : null,
    );
    return {
      defaultVersion: parsedVersion ?? "v2",
      locked: obj.locked === true,
    };
  } catch {
    return { defaultVersion: "v2", locked: false };
  }
}
