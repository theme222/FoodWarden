import {
  Utensils,
  ChartNoAxesCombined,
  Network,
  UserRound,
  Settings2,
} from "lucide-react";
import useSWR from "swr";
import { SessionCache } from "./components/session-cache";
import { ConfirmationProvider } from "./components/confirmation";
import { StatusAlert } from "./components/status-alert";
import { Toaster } from "./components/ui/sonner";
import {
  StrictMode,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useState,
} from "react";
import type { FormEvent } from "react";
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
import { Inventory } from "./Inventory";
import { FridgeLogo } from "./icons";
import { Metrics } from "./Metrics";
import type { Fridge, Language } from "./model";

import { words } from "./words";
import "./style.css";
import "./dashboard-theme.css";
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
const Charts = lazy(() =>
  import("./Charts").then((module) => ({ default: module.Charts })),
);

function Dashboard({
  fridge,
  room,
  language,
}: {
  fridge: Fridge;
  room: FridgeRoomState;
  language: Language;
}) {
  const now = useNow();
  const t = words[language];
  const location = useLocation();
  const state: unknown = location.state;
  const added =
    typeof state === "object" &&
    state !== null &&
    "added" in state &&
    state.added === true;

  return (
    <>
      <h1>{fridge.name}</h1>
      {added && (
        <p role="status" className="notice">
          {t.saved}
        </p>
      )}
      <Metrics
        latest={room.latest}
        history={room.history ?? []}
        now={now}
        language={language}
        failed={room.error}
      />
      {room.error ? (
        <StatusAlert>{t.failed}</StatusAlert>
      ) : room.inventory ? (
        <Inventory
          fridgeId={fridge.id}
          items={room.inventory}
          onChanged={room.reloadInventory}
          language={language}
        />
      ) : (
        <p role="status">{t.loading}</p>
      )}
    </>
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
  if (room.error) return <p role="alert">{t.failed}</p>;
  if (!room.inventory) return <p role="status">{t.loading}</p>;
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

  if (!fridge) return <p role="alert">{t.missingFridge}</p>;

  return (
    <FridgeWorkspace
      key={fridge.id}
      fridge={fridge}
      language={language}
      onFridgesChanged={onFridgesChanged}
      onAccessLost={handleAccessLost}
    />
  );
}

function FridgeWorkspace({
  fridge,
  language,
  onFridgesChanged,
  onAccessLost,
}: {
  fridge: Fridge;
  language: Language;
  onFridgesChanged: () => void;
  onAccessLost: () => void;
}) {
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

  return (
    <>
      {(room.connectionState === "reconnecting" ||
        room.connectionState === "closed") && (
        <StatusAlert>
          {t.failed} · {connectionLabel(room.connectionState, language)}
        </StatusAlert>
      )}
      <div className="fridge-bar">
        <nav className="tabs" aria-label={fridge.name}>
          <NavLink to={base} end>
            <Utensils size={18} aria-hidden="true" />
            {t.food}
          </NavLink>
          <NavLink to={base + "/charts"}>
            <ChartNoAxesCombined size={18} aria-hidden="true" />
            {language === "th" ? "กราฟ" : "Charts"}
          </NavLink>
          <NavLink to={base + "/devices"}>
            <Network size={18} aria-hidden="true" />
            {t.devices}
          </NavLink>
          <NavLink to={base + "/me"}>
            <UserRound size={18} aria-hidden="true" />
            {language === "th" ? "ของฉัน" : "Me"}
          </NavLink>
          {fridge.role === "owner" && (
            <NavLink to={base + "/settings"}>
              <Settings2 size={18} aria-hidden="true" />
              {t.settings}
            </NavLink>
          )}
        </nav>
        <span
          className={`ws-pill ws-${room.connectionState}`}
          aria-live="polite"
        >
          <span aria-hidden="true" />
          {connectionLabel(room.connectionState, language)}
        </span>
      </div>
      <Routes>
        <Route
          index
          element={
            <Dashboard fridge={fridge} room={room} language={language} />
          }
        />
        <Route
          path="me"
          element={
            <Suspense fallback={<output>{t.loading}</output>}>
              <MyAccount language={language} fridgeId={fridge.id} />
            </Suspense>
          }
        />
        <Route
          path="charts"
          element={
            <Suspense fallback={<output>{t.loading}</output>}>
              <Charts
                language={language}
                fridgeId={fridge.id}
                latest={room.latest}
                doorEvents={room.doorEvents ?? []}
              />
            </Suspense>
          }
        />
        <Route
          path="devices"
          element={
            <Devices
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
            fridge.role === "owner" ? (
              <Suspense fallback={<output>{t.loading}</output>}>
                <Settings
                  fridgeId={fridge.id}
                  language={language}
                  onFridgesChanged={onFridgesChanged}
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
            fridge.role === "owner" ? (
              <Suspense fallback={<output>{t.loading}</output>}>
                <GatewaySimulatorPage
                  fridgeId={fridge.id}
                  language={language}
                />
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
  const t = words[language];
  const navigate = useNavigate();
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
      onCreated();
      navigate("/fridges/" + encodeURIComponent(created.id));
    } catch {
      setError(true);
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <h1>{t.home}</h1>
      {fridges.length === 0 ? (
        <p className="surface">{t.emptyFridges}</p>
      ) : (
        <ul className="food-list">
          {fridges.map((fridge) => (
            <li key={fridge.id}>
              <Link to={"/fridges/" + encodeURIComponent(fridge.id)}>
                <div>
                  <strong>{fridge.name}</strong>
                  <span className="small">
                    {fridge.role === "owner" ? t.ownerBadge : t.memberBadge}
                  </span>
                </div>
                <span className="chevron" aria-hidden="true">
                  ›
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <section className="surface create-fridge" aria-labelledby="create-title">
        <h2 id="create-title">{t.createFridge}</h2>
        {error && <StatusAlert>{t.actionFailed}</StatusAlert>}
        <form
          className="create-fridge-form"
          onSubmit={(event) => void handleCreate(event)}
        >
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t.fridgeNamePlaceholder}
            aria-label={t.fridgeName}
            maxLength={80}
            required
            disabled={creating}
          />
          <button className="primary" disabled={creating} type="submit">
            {creating ? t.creating : t.createFridge}
          </button>
        </form>
      </section>
    </>
  );
}

function SignedIn({
  user,
  language,
}: {
  user: SessionUser;
  language: Language;
}) {
  const t = words[language];
  const live = useFridges(user.id);
  if (live.error) return <p role="alert">{t.failed}</p>;
  if (!live.data) return <p role="status">{t.loading}</p>;
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
            <MyAccount language={language} />
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
  const t = words[language];
  if (!config?.googleEnabled && !config?.devLoginEnabled)
    return <p className="surface">{t.setup}</p>;
  return (
    <section className="surface welcome">
      <h1>FoodWarden</h1>
      <p>{t.welcome}</p>
      <div className="form-actions">
        {config?.googleEnabled && (
          <button
            className="primary"
            type="button"
            onClick={() => void onGoogle()}
            disabled={signingIn}
          >
            {signingIn ? t.loading : t.signIn}
          </button>
        )}
        {config?.devLoginEnabled && (
          <button
            className="secondary"
            type="button"
            onClick={() => void onDev()}
            disabled={signingIn}
          >
            {signingIn ? t.loading : t.devSignIn}
          </button>
        )}
      </div>
    </section>
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
  return (
    <header className="header">
      <div className="header-inner">
        <Link to="/fridges" className="brand">
          <FridgeLogo /> FoodWarden
        </Link>
        <div className="header-actions">
          {user && (
            <Link
              className="user-link"
              to="/me"
              aria-label={
                language === "th"
                  ? "บัญชีและการแจ้งเตือนของฉัน"
                  : "My account and notifications"
              }
            >
              {user.name || user.email}
            </Link>
          )}
          {user && (
            <a href="/api/reference" className="small">
              {language === "th" ? "เอกสาร API" : "API reference"}
            </a>
          )}
          <button
            className="secondary"
            type="button"
            onClick={onLanguageChange}
            lang={language === "th" ? "en" : "th"}
          >
            {language === "th" ? "English" : "ภาษาไทย"}
          </button>
          {user && (
            <button
              className="secondary"
              type="button"
              onClick={() => void onSignOut()}
            >
              {t.signOut}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

function App() {
  const [language, setLanguage] = useState<Language>(() =>
    localStorage.getItem("foodwarden_locale") === "en" ? "en" : "th",
  );
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

  useEffect(() => {
    document.documentElement.lang = language;
    localStorage.setItem("foodwarden_locale", language);
  }, [language]);

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
      <main>
        {failed && <StatusAlert>{t.failed}</StatusAlert>}
        {user === undefined ? (
          <p role="status">{t.loading}</p>
        ) : user ? (
          <SessionCache key={user.id}>
            <SignedIn user={user} language={language} />
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
      <App />
    </BrowserRouter>
  </StrictMode>,
);
