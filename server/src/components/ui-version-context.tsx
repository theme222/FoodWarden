import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  applyUiVersionToDom,
  fetchUiConfig,
  readStoredUiVersion,
  resolveUiVersion,
  writeStoredUiVersion,
  type UiVersion,
  type UiVersionConfig,
  type UiVersionSource,
} from "@/ui-version";

export interface UiVersionContextValue {
  version: UiVersion;
  source: UiVersionSource;
  locked: boolean;
  setVersion: (next: UiVersion) => void;
  resetToDefault: () => void;
}

const DEFAULT_CONTEXT: UiVersionContextValue = {
  version: "v2",
  source: "fallback",
  locked: false,
  setVersion: () => {},
  resetToDefault: () => {},
};

const UiVersionContext = createContext<UiVersionContextValue>(DEFAULT_CONTEXT);

export function UiVersionProvider({ children }: { children: ReactNode }) {
  const [serverConfig, setServerConfig] = useState<UiVersionConfig | null>(null);
  const [{ search, stored }, setLocalState] = useState<{
    search: string;
    stored: string | null;
  }>(() => ({
    search: typeof window === "undefined" ? "" : window.location.search,
    stored: readStoredUiVersion(),
  }));

  const buildDefault = import.meta.env.VITE_UI_VERSION ?? null;

  const resolved = useMemo(
    () =>
      resolveUiVersion({
        search,
        stored,
        serverConfig,
        buildDefault,
      }),
    [search, stored, serverConfig, buildDefault],
  );

  useEffect(() => {
    let cancelled = false;
    void fetchUiConfig().then((cfg) => {
      if (!cancelled) setServerConfig(cfg);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (resolved.nextStorage !== "unchanged") {
      writeStoredUiVersion(resolved.nextStorage);
    }
    applyUiVersionToDom(resolved.version);
  }, [resolved.nextStorage, resolved.version]);

  const setVersion = useCallback(
    (next: UiVersion) => {
      if (resolved.locked) return;
      writeStoredUiVersion(next);
      setLocalState({ search: "", stored: next });
    },
    [resolved.locked],
  );

  const resetToDefault = useCallback(() => {
    if (resolved.locked) return;
    writeStoredUiVersion(null);
    setLocalState({ search: "", stored: null });
  }, [resolved.locked]);

  const value = useMemo<UiVersionContextValue>(
    () => ({
      version: resolved.version,
      source: resolved.source,
      locked: resolved.locked,
      setVersion,
      resetToDefault,
    }),
    [resolved.version, resolved.source, resolved.locked, setVersion, resetToDefault],
  );

  return <UiVersionContext value={value}>{children}</UiVersionContext>;
}

export function useUiVersion(): UiVersionContextValue {
  return useContext(UiVersionContext);
}
