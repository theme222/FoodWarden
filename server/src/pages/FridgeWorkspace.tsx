import {
  Utensils,
  ChartNoAxesCombined,
  Network,
  Settings2,
  RotateCcw,
  ArrowLeft,
  History,
} from "lucide-react";
import { lazy, Suspense, useCallback } from "react";
import {
  Link,
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import { StatusAlert } from "../components/status-alert";
import { useFridgeRoom } from "../data";
import type { FridgeRoomState, SocketConnectionState } from "../data";
import { Devices } from "../Devices";
import { AddFood } from "../Food";
import type { Fridge, Language } from "../model";
import { words } from "../words";
import { Dashboard, ItemPage } from "./DashboardPage";

const Settings = lazy(() =>
  import("../Settings").then((module) => ({ default: module.Settings })),
);
const GatewaySimulatorPage = lazy(() =>
  import("../GatewaySimulator").then((module) => ({
    default: module.GatewaySimulatorPage,
  })),
);
const Activity = lazy(() =>
  import("../Activity").then((module) => ({ default: module.Activity })),
);
const Charts = lazy(() =>
  import("../Charts").then((module) => ({ default: module.Charts })),
);

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
              void navigate(`/fridges/${encodeURIComponent(event.target.value)}`)
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

export function FridgePage({
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
    void navigate("/fridges", { replace: true });
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
