import {
  Utensils,
  ChartNoAxesCombined,
  Network,
  Settings2,
  RotateCcw,
  ArrowLeft,
} from "lucide-react";
import { lazy, Suspense, useCallback, useRef, useState } from "react";
import type { PointerEvent } from "react";
import {
  Link,
  Navigate,
  NavLink,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import { StatusAlert } from "../components/status-alert";
import { buttonVariants } from "../components/ui/button-variants";
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
      to: base + "/monitoring",
      end: false,
      icon: ChartNoAxesCombined,
      label: th ? "ติดตาม" : "Monitor",
      fullLabel: th ? "ติดตาม" : "Monitor",
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
              void navigate(
                `/fridges/${encodeURIComponent(event.target.value)}`,
              )
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
  const navigate = useNavigate();
  const gesture = useRef<{
    pointerId: number;
    x: number;
    y: number;
    dragging: boolean;
  } | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  function targetAt(event: PointerEvent<HTMLElement>) {
    const link = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLAnchorElement>("a[data-nav-target]");
    return link && event.currentTarget.contains(link)
      ? link.dataset.navTarget
      : undefined;
  }

  function startGesture(event: PointerEvent<HTMLElement>) {
    if (
      !event.isPrimary ||
      event.button !== 0 ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    gesture.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      dragging: false,
    };
  }

  function moveGesture(event: PointerEvent<HTMLElement>) {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (!current.dragging) {
      const horizontal = Math.abs(event.clientX - current.x);
      const vertical = Math.abs(event.clientY - current.y);
      if (vertical > 8 && vertical >= horizontal) {
        gesture.current = null;
        return;
      }
      if (horizontal <= 8) return;
      current.dragging = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    setPreview(targetAt(event) ?? null);
  }

  function clearGesture(event: PointerEvent<HTMLElement>) {
    if (gesture.current?.pointerId !== event.pointerId) return;
    gesture.current = null;
    setPreview(null);
  }

  function finishGesture(event: PointerEvent<HTMLElement>) {
    if (gesture.current?.pointerId !== event.pointerId) return;
    const destination = gesture.current.dragging ? targetAt(event) : undefined;
    clearGesture(event);
    if (destination) void navigate(destination);
  }

  return (
    <nav
      className="bnav"
      aria-label={fridgeName}
      data-previewing={preview !== null ? "" : undefined}
      onPointerDown={startGesture}
      onPointerMove={moveGesture}
      onPointerUp={finishGesture}
      onPointerCancel={clearGesture}
      onLostPointerCapture={(event) => {
        if (event.target === event.currentTarget) clearGesture(event);
      }}
      onPointerLeave={(event) => {
        if (!gesture.current?.dragging) clearGesture(event);
      }}
    >
      {navItems.map((item) => {
        const Icon = item.icon;
        return (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            aria-label={item.label}
            data-nav-target={item.to}
            data-preview={preview === item.to ? "" : undefined}
            draggable={false}
          >
            <span className="bnav-ic">
              <Icon size={20} aria-hidden="true" />
            </span>
            <span className="bnav-label" aria-hidden="true">
              {item.label}
            </span>
          </NavLink>
        );
      })}
    </nav>
  );
}

function MonitoringLayout({
  base,
  language,
}: {
  base: string;
  language: Language;
}) {
  const th = language === "th";
  const monitoring = base + "/monitoring";
  const { search } = useLocation();
  return (
    <>
      <nav
        className="flex w-fit max-w-full flex-wrap gap-1 rounded-lg border border-border bg-card p-1"
        aria-label={th ? "หน้าติดตามตู้เย็น" : "Monitoring views"}
      >
        <NavLink
          to={{ pathname: monitoring, search }}
          end
          className={({ isActive }) =>
            buttonVariants({
              variant: isActive ? "secondary" : "ghost",
              className: "min-w-20 no-underline pointer-coarse:min-h-11",
            })
          }
        >
          {th ? "กราฟ" : "Charts"}
        </NavLink>
        <NavLink
          to={{ pathname: monitoring + "/history", search }}
          end
          className={({ isActive }) =>
            buttonVariants({
              variant: isActive ? "secondary" : "ghost",
              className: "min-w-20 no-underline pointer-coarse:min-h-11",
            })
          }
        >
          {th ? "ประวัติ" : "History"}
        </NavLink>
      </nav>
      <Suspense fallback={<output>{words[language].loading}</output>}>
        <Outlet />
      </Suspense>
    </>
  );
}

function MonitoringRedirect({ to }: { to: string }) {
  const { search, hash } = useLocation();
  return <Navigate to={{ pathname: to, search, hash }} replace />;
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
        path="monitoring"
        element={<MonitoringLayout base={base} language={language} />}
      >
        <Route
          index
          element={
            <Charts
              language={language}
              fridgeId={fridge.id}
              latest={room.latest}
            />
          }
        />
        <Route
          path="history"
          element={<Activity fridgeId={fridge.id} language={language} />}
        />
      </Route>
      <Route
        path="charts"
        element={<MonitoringRedirect to={base + "/monitoring"} />}
      />
      <Route
        path="history"
        element={<MonitoringRedirect to={base + "/monitoring/history"} />}
      />
      <Route
        path="devices"
        element={
          <Devices
            fridgeId={fridge.id}
            heartbeat={room.heartbeat}
            doorEvents={room.doorEvents}
            error={room.errors.status}
            onRetryStatus={room.reloadStatus}
            doorError={room.errors.doors}
            onRetryDoors={room.reloadDoors}
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
    room.connectionState === "reconnecting" ||
    room.connectionState === "closed";

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
