import {
  Utensils,
  ChartNoAxesCombined,
  Network,
  Settings2,
  Plus,
  RotateCcw,
  ChevronRight,
  ArrowLeft,
  History,
  Languages,
  LogOut,
} from "lucide-react";
import { Tooltip } from "@base-ui/react/tooltip";
import useSWR from "swr";
import { SessionCache } from "./components/session-cache";
import { ConfirmationProvider } from "./components/confirmation";
import { StatusAlert } from "./components/status-alert";
import { Toaster } from "./components/ui/sonner";
import {
  UiVersionProvider,
  useUiVersion,
} from "./components/ui-version-context";
import {
  StrictMode,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useState,
} from "react";
import type { FormEvent, ReactElement } from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Link,
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import {
  fetchAuthState,
  signInDevBypass,
  signInWithGoogle,
  signOutSession,
} from "./auth";
import type { AuthConfig, SessionUser } from "./auth";
import { useFridgeRoom, useFridges, useNow } from "./data";
import type { FridgeRoomState, SocketConnectionState } from "./data";
import { Devices } from "./Devices";
import { AddFood, FoodDetail } from "./Food";
import { FridgeFavorites } from "./FridgeFavorites";
import { Inventory } from "./Inventory";
import { FridgeLogo } from "./icons";
import { Metrics } from "./Metrics";
import { ReadingTime } from "./components/reading-time";
import { Sheet } from "./Sheet";
import { FRIDGE_SENSOR_STALE_S } from "./model";
import type { Fridge, Language } from "./model";
import {
  deriveTelemetryAlerts,
  summarizeDeviceHealth,
} from "./state/dashboard-machine";
import type { ColorTheme } from "./state/dashboard-machine";
import { applyColorTheme, readStoredColorTheme } from "./theme";
import { words } from "./words";
import "./style.css";
import "./dashboard-theme.css";
import "./v1-classic.css";

const Settings = lazy(() =>
  import("./Settings").then((module) => ({ default: module.Settings })),
);
const GatewaySimulatorPage = lazy(() =>
  import("./GatewaySimulator").then((module) => ({
    default: module.GatewaySimulatorPage,
  })),
);
const MyAccount = lazy(() =>
  import("./MyAccount").then((module) => ({ default: module.MyAccount })),
);
const Activity = lazy(() => import("./Activity").then((module) => ({ default: module.Activity })));
const Charts = lazy(() =>
  import("./Charts").then((module) => ({ default: module.Charts })),
);

function TelemetryAlerts({
  room,
  language,
  now,
}: {
  room: FridgeRoomState;
  language: Language;
  now: number;
}) {
  const th = language === "th";
  if (!room.latest || now - room.latest.timeS > FRIDGE_SENSOR_STALE_S) return null;
  const alerts = deriveTelemetryAlerts(room.latest);

  return (
    <>
      {alerts.length > 0 && (
        <StatusAlert variant="warning">
          {alerts.includes("warm") && (th ? "ตู้เย็นร้อนเกินเกณฑ์ ตรวจว่าประตูปิดสนิท" : "High temperature. Check that the door is shut.")}
          {alerts.length > 1 && " "}
          {alerts.includes("spoil") && (th ? "ค่า VOC สูง ลองตรวจอาหารในตู้" : "High VOC. Check the food in the fridge.")}
        </StatusAlert>
      )}
    </>
  );
}

function DeviceHealthBar({
  base,
  room,
  now,
  language,
}: {
  base: string;
  room: FridgeRoomState;
  now: number;
  language: Language;
}) {
  const th = language === "th";
  const deviceSummary = summarizeDeviceHealth(room.heartbeat ?? null, now);
  const dotClass = deviceSummary.allOk
    ? "ok"
    : deviceSummary.degradedNodeIds.length > 0
      ? "warn"
      : "";
  const text = deviceSummary.allOk
    ? th
      ? "อุปกรณ์ทั้งหมดออนไลน์ปกติ (C0 · F0 · D0)"
      : "All 3 devices online (C0 · F0 · D0)"
    : th
      ? `สถานะอุปกรณ์: ออนไลน์ ${deviceSummary.healthyCount}/3`
      : `Devices: ${deviceSummary.healthyCount}/3 online`;

  return (
    <Link to={`${base}/devices`} className="devbar">
      <span className={`dot ${dotClass}`} aria-hidden="true" />
      <Network size={18} aria-hidden="true" />
      <span className="devbar-text">{text}</span>
      <ChevronRight size={16} aria-hidden="true" />
    </Link>
  );
}

function Dashboard({
  fridge,
  room,
  language,
}: {
  fridge: Fridge;
  room: FridgeRoomState;
  language: Language;
}) {
  const th = language === "th";
  const now = useNow();
  const t = words[language];
  const { version } = useUiVersion();
  const location = useLocation();
  const state: unknown = location.state;
  const added =
    typeof state === "object" &&
    state !== null &&
    "added" in state &&
    state.added === true;
  const base = `/fridges/${encodeURIComponent(fridge.id)}`;

  return (
    <div className="flex flex-col gap-4">
      <div className="page-head">
        <div className="page-head-copy">
          <h1>{fridge.name}</h1>
        </div>
      </div>

      {added && <output className="pill accent">{t.saved}</output>}

      <TelemetryAlerts room={room} language={language} now={now} />

      <Metrics
        latest={room.latest}
        now={now}
        language={language}
        failed={room.error}
        fridgeId={fridge.id}
        doorEvents={room.doorEvents ?? []}
      />

      {version === "v2" && (
        <DeviceHealthBar base={base} room={room} now={now} language={language} />
      )}

      {room.error ? (
        <StatusAlert
          action={
            <button type="button" className="btn sm" onClick={room.reloadAll}>
              <RotateCcw size={15} aria-hidden="true" />
              {th ? "ลองใหม่" : "Retry"}
            </button>
          }
        >
          {t.failed}
        </StatusAlert>
      ) : room.inventory ? (
        <Inventory
          fridgeId={fridge.id}
          items={room.inventory}
          onChanged={room.reloadInventory}
          language={language}
        />
      ) : (
        <output className="sub">{t.loading}</output>
      )}
      <FridgeFavorites fridgeId={fridge.id} language={language} />
    </div>
  );
}

function ItemPage({
  fridge,
  room,
  language,
}: {
  fridge: Fridge;
  room: FridgeRoomState;
  language: Language;
}) {
  const { itemId = "" } = useParams();
  const t = words[language];
  if (room.error) {
    return (
      <StatusAlert
        action={
          <button type="button" className="btn sm" onClick={room.reloadAll}>
            {language === "th" ? "ลองใหม่" : "Retry"}
          </button>
        }
      >
        {t.failed}
      </StatusAlert>
    );
  }
  if (!room.inventory) return <output className="sub">{t.loading}</output>;
  return (
    <FoodDetail
      itemId={itemId}
      items={room.inventory}
      fridgeId={fridge.id}
      language={language}
      onChanged={room.reloadInventory}
    />
  );
}

function connectionLabel(
  state: SocketConnectionState,
  language: Language,
): string {
  const t = words[language];
  switch (state) {
    case "live":
      return t.wsLive;
    case "reconnecting":
      return t.wsReconnecting;
    default:
      return t.wsConnecting;
  }
}

interface WorkspaceNavItem {
  to: string;
  end: boolean;
  icon: typeof Utensils;
  label: string;
  fullLabel: string;
}

function buildNavItems(
  fridge: Fridge,
  base: string,
  language: Language,
): WorkspaceNavItem[] {
  const th = language === "th";
  const t = words[language];
  const items: WorkspaceNavItem[] = [
    {
      to: base,
      end: true,
      icon: Utensils,
      label: th ? "อาหาร" : "Food",
      fullLabel: t.food,
    },
    {
      to: base + "/charts",
      end: false,
      icon: ChartNoAxesCombined,
      label: th ? "กราฟ" : "Charts",
      fullLabel: th ? "กราฟ" : "Charts",
    },
    {
      to: base + "/history",
      end: false,
      icon: History,
      label: th ? "ประวัติ" : "History",
      fullLabel: th ? "ประวัติ" : "History",
    },
    {
      to: base + "/devices",
      end: false,
      icon: Network,
      label: t.devices,
      fullLabel: t.devices,
    },
  ];
  if (fridge.role === "owner") {
    items.push({
      to: base + "/settings",
      end: false,
      icon: Settings2,
      label: t.settings,
      fullLabel: t.settings,
    });
  }
  return items;
}

function FridgeNavBar({
  fridge,
  fridges,
  navItems,
  connectionState,
  language,
}: {
  fridge: Fridge;
  fridges: Fridge[];
  navItems: WorkspaceNavItem[];
  connectionState: SocketConnectionState;
  language: Language;
}) {
  const th = language === "th";
  const t = words[language];
  const navigate = useNavigate();

  return (
    <div className="fridge-bar">
      <div className="fridge-bar-left">
        <Link to="/fridges" className="fridge-back">
          <ArrowLeft size={16} aria-hidden="true" />
          {th ? "ทุกตู้" : "All fridges"}
        </Link>
        {fridges.length > 1 && (
          <select
            className="fridge-select"
            aria-label={t.fridgeName}
            value={fridge.id}
            onChange={(event) =>
              navigate(`/fridges/${encodeURIComponent(event.target.value)}`)
            }
          >
            {fridges.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        )}
        <nav className="tabs" aria-label={fridge.name}>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink key={item.to} to={item.to} end={item.end}>
                <Icon size={18} aria-hidden="true" />
                {item.fullLabel}
              </NavLink>
            );
          })}
        </nav>
      </div>
      <span className={`ws-pill ws-${connectionState}`} aria-live="polite">
        <span aria-hidden="true" />
        {connectionLabel(connectionState, language)}
      </span>
    </div>
  );
}

function FridgeBottomNav({
  fridgeName,
  navItems,
}: {
  fridgeName: string;
  navItems: WorkspaceNavItem[];
}) {
  return (
    <nav className="bnav" aria-label={fridgeName}>
      {navItems.map((item) => {
        const Icon = item.icon;
        return (
          <NavLink key={item.to} to={item.to} end={item.end}>
            <span className="bnav-ic">
              <Icon size={20} aria-hidden="true" />
            </span>
            <span>{item.label}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}

function FridgeWorkspaceRoutes({
  fridge,
  base,
  room,
  language,
  onFridgesChanged,
}: {
  fridge: Fridge;
  base: string;
  room: FridgeRoomState;
  language: Language;
  onFridgesChanged: () => void;
}) {
  const t = words[language];
  const isOwner = fridge.role === "owner";

  return (
    <Routes>
      <Route
        index
        element={<Dashboard fridge={fridge} room={room} language={language} />}
      />
      <Route
        path="charts"
        element={
          <Suspense fallback={<output>{t.loading}</output>}>
            <Charts
              language={language}
              fridgeId={fridge.id}
              latest={room.latest}
            />
          </Suspense>
        }
      />
      <Route
        path="history"
        element={
          <Suspense fallback={<output>{t.loading}</output>}>
            <Activity fridgeId={fridge.id} language={language} />
          </Suspense>
        }
      />
      <Route
        path="devices"
        element={
          <Devices
            fridgeId={fridge.id}
            heartbeat={room.heartbeat}
            doorEvents={room.doorEvents}
            error={room.error}
            language={language}
          />
        }
      />
      <Route
        path="food/add"
        element={
          <AddFood
            key={fridge.id}
            fridgeId={fridge.id}
            language={language}
            onAdded={room.reloadInventory}
          />
        }
      />
      <Route
        path="food/:itemId"
        element={<ItemPage fridge={fridge} room={room} language={language} />}
      />
      <Route
        path="settings"
        element={
          isOwner ? (
            <Suspense fallback={<output>{t.loading}</output>}>
              <Settings
                fridgeId={fridge.id}
                language={language}
                onFridgesChanged={onFridgesChanged}
                hasDevices={Boolean(room.heartbeat?.nodes.length)}
              />
            </Suspense>
          ) : (
            <Navigate to={base} replace />
          )
        }
      />
      <Route
        path="sim"
        element={
          isOwner ? (
            <Suspense fallback={<output>{t.loading}</output>}>
              <GatewaySimulatorPage fridgeId={fridge.id} language={language} />
            </Suspense>
          ) : (
            <Navigate to={base} replace />
          )
        }
      />
      <Route
        path="simulator"
        element={<Navigate to={base + "/sim"} replace />}
      />
      <Route path="*" element={<Navigate to={base} replace />} />
    </Routes>
  );
}

function FridgePage({
  fridges,
  language,
  onFridgesChanged,
}: {
  fridges: Fridge[];
  language: Language;
  onFridgesChanged: () => void;
}) {
  const { fridgeId } = useParams();
  const navigate = useNavigate();
  const fridge = fridges.find((entry) => entry.id === fridgeId);
  const t = words[language];

  const handleAccessLost = useCallback(() => {
    onFridgesChanged();
    navigate("/fridges", { replace: true });
  }, [navigate, onFridgesChanged]);

  if (!fridge) {
    return (
      <StatusAlert
        action={
          <Link className="btn sm" to="/fridges">
            {language === "th" ? "กลับหน้าตู้เย็นทั้งหมด" : "All fridges"}
          </Link>
        }
      >
        {t.missingFridge}
      </StatusAlert>
    );
  }

  return (
    <FridgeWorkspace
      key={fridge.id}
      fridge={fridge}
      fridges={fridges}
      language={language}
      onFridgesChanged={onFridgesChanged}
      onAccessLost={handleAccessLost}
    />
  );
}

function FridgeWorkspace({
  fridge,
  fridges,
  language,
  onFridgesChanged,
  onAccessLost,
}: {
  fridge: Fridge;
  fridges: Fridge[];
  language: Language;
  onFridgesChanged: () => void;
  onAccessLost: () => void;
}) {
  const th = language === "th";
  const t = words[language];
  const location = useLocation();
  const room = useFridgeRoom(fridge.id, fridge.latest, onAccessLost);
  const base = "/fridges/" + encodeURIComponent(fridge.id);
  const simQuery =
    fridge.role === "owner" &&
    new URLSearchParams(location.search).get("sim") === "1";

  if (
    simQuery &&
    !location.pathname.endsWith("/sim") &&
    !location.pathname.endsWith("/simulator")
  ) {
    return <Navigate to={base + "/sim"} replace />;
  }

  const navItems = buildNavItems(fridge, base, language);
  const needsReconnect =
    room.connectionState === "reconnecting" || room.connectionState === "closed";

  return (
    <>
      {needsReconnect && (
        <StatusAlert
          action={
            <button type="button" className="btn sm" onClick={room.reloadAll}>
              <RotateCcw size={15} aria-hidden="true" />
              {th ? "เชื่อมต่อใหม่" : "Refresh"}
            </button>
          }
        >
          {t.failed} · {connectionLabel(room.connectionState, language)}
        </StatusAlert>
      )}

      <FridgeNavBar
        fridge={fridge}
        fridges={fridges}
        navItems={navItems}
        connectionState={room.connectionState}
        language={language}
      />

      <FridgeWorkspaceRoutes
        fridge={fridge}
        base={base}
        room={room}
        language={language}
        onFridgesChanged={onFridgesChanged}
      />

      <FridgeBottomNav fridgeName={fridge.name} navItems={navItems} />
    </>
  );
}

function FridgeHub({
  fridges,
  language,
  onCreated,
}: {
  fridges: Fridge[];
  language: Language;
  onCreated: () => void;
}) {
  const th = language === "th";
  const now = useNow();
  const t = words[language];
  const navigate = useNavigate();
  const [openCreate, setOpenCreate] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(false);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    setError(false);
    try {
      const res = await fetch("/api/fridges", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) throw new Error("Create failed");
      const created = (await res.json()) as { id: string };
      setName("");
      setOpenCreate(false);
      onCreated();
      navigate("/fridges/" + encodeURIComponent(created.id));
    } catch {
      setError(true);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="hub-heading">
        <h1>{t.home}</h1>
        <button
          type="button"
          className="primary"
          onClick={() => {
            setError(false);
            setOpenCreate(true);
          }}
        >
          <Plus size={19} aria-hidden="true" />
          {t.createFridge}
        </button>
      </div>

      {fridges.length === 0 ? (
        <p className="empty-state">{t.emptyFridges}</p>
      ) : (
        <div className="hub-grid">
          {fridges.map((fridge) => {
            const temp = fridge.latest?.temperature ?? null;
            const voc = fridge.latest?.voc ?? null;
            const warm = temp !== null && temp > 8;
            const spoil = voc !== null && voc > 250;
            const statusText =
              fridge.lastSeenS > 0
                ? th
                  ? "พร้อมใช้งาน"
                  : "Connected"
                : th
                  ? "รอเชื่อมต่ออุปกรณ์"
                  : "Waiting for devices";
            return (
              <Link
                key={fridge.id}
                className="fcard"
                to={"/fridges/" + encodeURIComponent(fridge.id)}
              >
                <div className="fcard-top">
                  <div>
                    <h2>{fridge.name}</h2>
                    <p className="small">{fridge.latest ? <ReadingTime timeS={fridge.latest.timeS} now={now} language={language} /> : statusText}</p>
                  </div>
                  <span className="fcard-role small">
                    {fridge.role === "owner" ? t.ownerBadge : t.memberBadge}
                  </span>
                </div>
                <div className="fcard-stats">
                  <div className="stat">
                    <span className="k">{t.temperature}</span>
                    <span className={`v${warm ? " bad" : ""}`}>
                      {temp === null ? "—" : `${temp.toFixed(1)}°C`}
                    </span>
                  </div>
                  <div className="stat">
                    <span className="k">VOC</span>
                    <span className={`v${spoil ? " warn" : ""}`}>
                      {voc === null ? "—" : Math.round(voc)}
                    </span>
                  </div>
                  <div className="stat">
                    <span className="k">{th ? "อาหารทั้งหมด" : "Food items"}</span>
                    <span className="v">{fridge.inventoryCount ?? "—"}</span>
                  </div>
                  <div className="stat">
                    <span className="k">{th ? "หมดอายุใน 3 วัน" : "Expiring within 3 days"}</span>
                    <span className={`v${fridge.expiringSoonCount ? " warn" : ""}`}>
                      {fridge.expiringSoonCount ?? "—"}
                    </span>
                  </div>
                </div>
                <ChevronRight className="fcard-chevron" size={18} aria-hidden="true" />
              </Link>
            );
          })}
        </div>
      )}

      <Sheet
        open={openCreate}
        onOpenChange={setOpenCreate}
        title={t.createFridge}
      >
        <form className="add-form" onSubmit={(event) => void handleCreate(event)}>
          {error && <StatusAlert>{t.actionFailed}</StatusAlert>}
          <fieldset disabled={creating}>
            <label>
              {t.fridgeName}
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t.fridgeNamePlaceholder}
                maxLength={80}
                required
              />
            </label>
          </fieldset>
          <div className="form-actions">
            <button className="primary big" disabled={creating} type="submit">
              {creating ? t.creating : t.createFridge}
            </button>
            <button
              type="button"
              className="btn big"
              onClick={() => setOpenCreate(false)}
            >
              {t.cancel}
            </button>
          </div>
        </form>
      </Sheet>
    </div>
  );
}

function SignedIn({
  user,
  language,
  colorTheme,
  onLanguageChange,
  onColorThemeChange,
}: {
  user: SessionUser;
  language: Language;
  colorTheme: ColorTheme;
  onLanguageChange: (next: Language) => void;
  onColorThemeChange: (next: ColorTheme) => void;
}) {
  const t = words[language];
  const live = useFridges(user.id);
  if (live.error) {
    return (
      <StatusAlert
        action={
          <button type="button" className="btn sm" onClick={live.reload}>
            <RotateCcw size={15} aria-hidden="true" />
            {language === "th" ? "ลองใหม่" : "Retry"}
          </button>
        }
      >
        {t.failed}
      </StatusAlert>
    );
  }
  if (!live.data) return <output className="sub">{t.loading}</output>;
  return (
    <Routes>
      <Route
        path="/fridges"
        element={
          <FridgeHub
            fridges={live.data}
            language={language}
            onCreated={live.reload}
          />
        }
      />
      <Route path="/fridges/:fridgeId/me" element={<Navigate to="/me" replace />} />
      <Route
        path="/fridges/:fridgeId/*"
        element={
          <FridgePage
            fridges={live.data}
            language={language}
            onFridgesChanged={live.reload}
          />
        }
      />
      <Route
        path="/me"
        element={
          <Suspense fallback={<output>{t.loading}</output>}>
            <MyAccount
              language={language}
              colorTheme={colorTheme}
              onLanguageChange={onLanguageChange}
              onColorThemeChange={onColorThemeChange}
            />
          </Suspense>
        }
      />
      <Route path="*" element={<Navigate to="/fridges" replace />} />
    </Routes>
  );
}

function SignInPanel({
  config,
  language,
  signingIn,
  onGoogle,
  onDev,
}: {
  config: AuthConfig | null;
  language: Language;
  signingIn: boolean;
  onGoogle: () => Promise<void>;
  onDev: () => Promise<void>;
}) {
  const th = language === "th";
  const t = words[language];
  const { version } = useUiVersion();
  if (!config?.googleEnabled && !config?.devLoginEnabled) {
    return <p className="panel">{t.setup}</p>;
  }

  const bullets = th
    ? [
        "รู้ทันทีว่าอาหารชิ้นไหนใกล้หมดอายุ (FEFO)",
        "ติดตามอุณหภูมิ กลิ่น และการปิดประตูแบบเรียลไทม์",
        "แจ้งเตือนผ่าน LINE ทั้งกลุ่มครอบครัวและส่วนตัว",
        "ใช้งานง่ายทั้งมือถือและคอมพิวเตอร์",
      ]
    : [
        "Spot expiring food at a glance with FEFO priority",
        "Live fridge temperature, VOC air quality, and door safety",
        "Instant family and personal LINE notifications",
        "Built for every family member on phone or desktop",
      ];

  const heroTitle = th
    ? "รู้ทันของในตู้เย็น ก่อนหมดอายุ"
    : "Know what’s fresh before it spoils";

  if (version === "v1") {
    return (
      <div className="login">
        <section className="panel flex flex-col gap-4">
          <h1>{heroTitle}</h1>
          <p className="sub">{t.welcome}</p>
          {config?.googleEnabled && (
            <button
              className="primary big"
              type="button"
              onClick={() => void onGoogle()}
              disabled={signingIn}
            >
              {signingIn ? t.loading : t.signIn}
            </button>
          )}
          {config?.devLoginEnabled && (
            <button
              className="btn big"
              type="button"
              onClick={() => void onDev()}
              disabled={signingIn}
            >
              {signingIn ? t.loading : t.devSignIn}
            </button>
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="login">
      <section className="login-hero">
        <h1>{heroTitle}</h1>
        <p className="login-lead">{t.welcome}</p>
        <ul className="login-bullets">
          {bullets.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>

      <section className="signin-card">
        <h2>{th ? "เข้าสู่ระบบเพื่อเริ่มต้น" : "Sign in to your fridge"}</h2>
        {config?.googleEnabled && (
          <button
            className="gbtn"
            type="button"
            onClick={() => void onGoogle()}
            disabled={signingIn}
          >
            {signingIn ? t.loading : t.signIn}
          </button>
        )}
        {config?.devLoginEnabled && (
          <button
            className={config?.googleEnabled ? "gbtn alt" : "gbtn"}
            type="button"
            onClick={() => void onDev()}
            disabled={signingIn}
          >
            {signingIn ? t.loading : t.devSignIn}
          </button>
        )}
        <p className="signin-note">
          {th
            ? "ใช้บัญชี Google ของคุณเพื่อเข้าถึงตู้เย็นที่แชร์ร่วมกันในบ้าน"
            : "Use your Google account to view fridges shared with your household."}
        </p>
      </section>
    </div>
  );
}

function ToolbarHint({ label, control }: { label: string; control: ReactElement }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger render={control} aria-label={label} />
      <Tooltip.Portal>
        <Tooltip.Positioner side="bottom" sideOffset={5} className="toolbar-hint-position">
          <Tooltip.Popup className="toolbar-hint">{label}</Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

function DashboardHeader({
  user,
  language,
  onLanguageChange,
  onSignOut,
}: {
  user: SessionUser | null | undefined;
  language: Language;
  onLanguageChange: () => void;
  onSignOut: () => Promise<void>;
}) {
  const t = words[language];
  const th = language === "th";
  const initial = (user?.name || user?.email || "F").slice(0, 1).toUpperCase();
  return (
    <header className="top">
      <div className="top-in">
        <Link to="/fridges" className="brand" aria-label="FoodWarden">
          <FridgeLogo />
          <span className="brand-name">FoodWarden</span>
        </Link>
        <div className="header-actions">
          {user && (
            <a href="/api/reference" className="btn sm api-ref-link">
              {th ? "เอกสาร API" : "API reference"}
            </a>
          )}
          <Tooltip.Provider>
            <ToolbarHint
              label={th ? "เปลี่ยนเป็นภาษาอังกฤษ" : "Switch to Thai"}
              control={
                <button className="toolbar-icon" type="button" onClick={onLanguageChange}>
                  <Languages size={21} aria-hidden="true" />
                </button>
              }
            />
            {user && (
              <>
                <ToolbarHint
                  label={th ? "บัญชีและการแจ้งเตือนของฉัน" : "My account and notifications"}
                  control={
                    <Link className="toolbar-icon toolbar-account" to="/me">
                      <span className="user-avatar" aria-hidden="true">{initial}</span>
                    </Link>
                  }
                />
                <ToolbarHint
                  label={t.signOut}
                  control={
                    <button className="toolbar-icon" type="button" onClick={() => void onSignOut()}>
                      <LogOut size={21} aria-hidden="true" />
                    </button>
                  }
                />
              </>
            )}
          </Tooltip.Provider>
        </div>
      </div>
    </header>
  );
}

function App() {
  const [language, setLanguage] = useState<Language>(() =>
    localStorage.getItem("foodwarden_locale") === "en" ? "en" : "th",
  );
  const [colorTheme, setColorTheme] = useState<ColorTheme>(readStoredColorTheme);
  const { version: uiVersion, locked: uiLocked, setVersion: setUiVersion } =
    useUiVersion();
  const auth = useSWR("foodwarden-auth", () => fetchAuthState(), {
    errorRetryCount: 2,
  });
  const user = auth.error
    ? null
    : auth.isLoading
      ? undefined
      : (auth.data?.user ?? null);
  const config = auth.data?.config ?? null;
  const [failed, setFailed] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const t = words[language];
  const th = language === "th";

  useEffect(() => {
    document.documentElement.lang = language;
    localStorage.setItem("foodwarden_locale", language);
  }, [language]);

  useEffect(() => {
    applyColorTheme(colorTheme);
  }, [colorTheme]);

  const refreshAuth = async () => {
    await auth.mutate();
    setFailed(false);
  };

  async function loginGoogle() {
    if (signingIn) return;
    setSigningIn(true);
    setFailed(false);
    try {
      await signInWithGoogle("/fridges");
    } catch {
      setFailed(true);
      setSigningIn(false);
    }
  }

  async function loginDev() {
    if (signingIn) return;
    setSigningIn(true);
    setFailed(false);
    try {
      await signInDevBypass();
      await refreshAuth();
    } catch {
      setFailed(true);
    } finally {
      setSigningIn(false);
    }
  }

  async function handleSignOut() {
    try {
      await signOutSession();
      await auth.mutate(
        (state) => (state ? { ...state, user: null } : undefined),
        { revalidate: false },
      );
    } catch {
      setFailed(true);
    }
  }

  return (
    <ConfirmationProvider language={language}>
      <DashboardHeader
        user={user}
        language={language}
        onLanguageChange={() => setLanguage(language === "th" ? "en" : "th")}
        onSignOut={handleSignOut}
      />
      <main className="wrap">
        {uiVersion === "v1" && !uiLocked && (
          <output className="v1-banner">
            <span>
              {th
                ? "กำลังใช้หน้าตาแบบเดิม (v1 Classic)"
                : "Using classic v1 rollback interface"}
            </span>
            <button
              type="button"
              className="btn sm"
              onClick={() => setUiVersion("v2")}
            >
              {th ? "กลับไปใช้ v2" : "Switch back to v2"}
            </button>
          </output>
        )}
        {failed && (
          <StatusAlert
            action={
              <button
                type="button"
                className="btn sm"
                onClick={() => void refreshAuth()}
              >
                <RotateCcw size={15} aria-hidden="true" />
                {th ? "ลองใหม่" : "Retry"}
              </button>
            }
          >
            {t.failed}
          </StatusAlert>
        )}
        {user === undefined ? (
          <output className="sub">{t.loading}</output>
        ) : user ? (
          <SessionCache key={user.id}>
            <SignedIn
              user={user}
              language={language}
              colorTheme={colorTheme}
              onLanguageChange={setLanguage}
              onColorThemeChange={setColorTheme}
            />
          </SessionCache>
        ) : (
          <SignInPanel
            config={config}
            language={language}
            signingIn={signingIn}
            onGoogle={loginGoogle}
            onDev={loginDev}
          />
        )}
      </main>
      <Toaster />
    </ConfirmationProvider>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Dashboard root is missing");
createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <UiVersionProvider>
        <App />
      </UiVersionProvider>
    </BrowserRouter>
  </StrictMode>,
);
