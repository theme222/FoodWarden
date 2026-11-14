import { StrictMode, useCallback, useEffect, useState } from "react";
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
import { AddFood, FoodDetail, Inventory } from "./Food";
import { Metrics } from "./Metrics";
import type { Fridge, Language } from "./model";
import { Settings } from "./Settings";
import { words } from "./words";
import "./style.css";

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
        <p role="alert">{t.failed}</p>
      ) : room.inventory ? (
        <Inventory
          fridgeId={fridge.id}
          items={room.inventory}
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
  const room = useFridgeRoom(fridge.id, fridge.latest, onAccessLost);
  const base = "/fridges/" + encodeURIComponent(fridge.id);

  return (
    <>
      <div className="fridge-bar">
        <nav className="tabs" aria-label={fridge.name}>
          <NavLink to={base} end>
            {t.food}
          </NavLink>
          <NavLink to={base + "/devices"}>{t.devices}</NavLink>
          {fridge.role === "owner" && (
            <NavLink to={base + "/settings"}>{t.settings}</NavLink>
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
              <Settings
                fridgeId={fridge.id}
                language={language}
                onFridgesChanged={onFridgesChanged}
              />
            ) : (
              <Navigate to={base} replace />
            )
          }
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
        {error && (
          <p role="alert" className="error">
            {t.actionFailed}
          </p>
        )}
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
          <button className="primary" disabled={creating}>
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
      <Route path="*" element={<Navigate to="/fridges" replace />} />
    </Routes>
  );
}

function App() {
  const [language, setLanguage] = useState<Language>(() =>
    localStorage.getItem("foodwarden_locale") === "en" ? "en" : "th",
  );
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined);
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [failed, setFailed] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const t = words[language];

  useEffect(() => {
    document.documentElement.lang = language;
    localStorage.setItem("foodwarden_locale", language);
  }, [language]);

  const refreshAuth = useCallback(async () => {
    try {
      const state = await fetchAuthState();
      setConfig(state.config);
      setUser(state.user);
      setFailed(false);
    } catch {
      setUser(null);
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void refreshAuth();
  }, [refreshAuth]);

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
      setUser(null);
    } catch {
      setFailed(true);
    }
  }

  const hasAuthMethod = Boolean(
    config?.googleEnabled || config?.devLoginEnabled,
  );

  return (
    <>
      <header className="header">
        <div className="header-inner">
          <Link to="/fridges" className="brand">
            FoodWarden
          </Link>
          <div className="header-actions">
            {user && <span className="small user-email">{user.email}</span>}
            <button
              className="secondary"
              type="button"
              onClick={() => setLanguage(language === "th" ? "en" : "th")}
              lang={language === "th" ? "en" : "th"}
            >
              {language === "th" ? "English" : "ภาษาไทย"}
            </button>
            {user && (
              <button
                className="secondary"
                type="button"
                onClick={() => void handleSignOut()}
              >
                {t.signOut}
              </button>
            )}
          </div>
        </div>
      </header>
      <main>
        {failed && (
          <p role="alert" className="error">
            {t.failed}
          </p>
        )}
        {user === undefined ? (
          <p role="status">{t.loading}</p>
        ) : user ? (
          <SignedIn key={user.id} user={user} language={language} />
        ) : !hasAuthMethod ? (
          <p className="surface">{t.setup}</p>
        ) : (
          <section className="surface welcome">
            <h1>FoodWarden</h1>
            <p>{t.welcome}</p>
            <div className="form-actions">
              {config?.googleEnabled && (
                <button
                  className="primary"
                  type="button"
                  onClick={() => void loginGoogle()}
                  disabled={signingIn}
                >
                  {signingIn ? t.loading : t.signIn}
                </button>
              )}
              {config?.devLoginEnabled && (
                <button
                  className="secondary"
                  type="button"
                  onClick={() => void loginDev()}
                  disabled={signingIn}
                >
                  {signingIn ? t.loading : t.devSignIn}
                </button>
              )}
            </div>
          </section>
        )}
      </main>
    </>
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
