import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";
import type { User } from "firebase/auth";
import type { Firestore } from "firebase/firestore";
import {
  BrowserRouter, Link, Navigate, NavLink, Route, Routes, useLocation, useParams,
} from "react-router-dom";
import { useFridges, useHistory, useInventory, useNow } from "./data";
import { Devices } from "./Devices";
import { services } from "./firebase";
import { AddFood, FoodDetail, Inventory } from "./Food";
import { Metrics } from "./Metrics";
import type { Fridge, Language } from "./model";
import { words } from "./words";
import "./style.css";

function Dashboard({ db, fridge, language }: { db: Firestore; fridge: Fridge; language: Language }) {
  const history = useHistory(db, fridge.id);
  const inventory = useInventory(db, fridge.id, true);
  const now = useNow();
  const t = words[language];
  const location = useLocation();
  const state: unknown = location.state;
  const latest = (history.data ?? []).reduce<Fridge["latest"]>(
    (previous, sample) => !previous || sample.timeS > previous.timeS ? sample : previous,
    fridge.latest,
  );
  const added = typeof state === "object" && state !== null && "added" in state && state.added === true;
  return <>
    <h1>{fridge.name}</h1>
    {added && <p role="status" className="notice">{t.saved}</p>}
    <Metrics latest={latest} history={history.data ?? []} now={now} language={language} failed={history.error} />
    {inventory.error ? <p role="alert">{t.failed}</p> : inventory.data
      ? <Inventory fridgeId={fridge.id} items={inventory.data} language={language} />
      : <p role="status">{t.loading}</p>}
  </>;
}

function ItemPage({ db, fridge, user, language }: { db: Firestore; fridge: Fridge; user: User; language: Language }) {
  const inventory = useInventory(db, fridge.id, true);
  const { itemId = "" } = useParams();
  const t = words[language];
  if (inventory.error) return <p role="alert">{t.failed}</p>;
  if (!inventory.data) return <p role="status">{t.loading}</p>;
  return <FoodDetail itemId={itemId} items={inventory.data} fridgeId={fridge.id} language={language} user={user} />;
}

function FridgePage({ db, fridges, user, language }: { db: Firestore; fridges: Fridge[]; user: User; language: Language }) {
  const { fridgeId } = useParams();
  const fridge = fridges.find((entry) => entry.id === fridgeId);
  const t = words[language];
  if (!fridge) return <p role="alert">{t.missingFridge}</p>;

  const base = "/fridges/" + encodeURIComponent(fridge.id);
  return <>
    <nav className="tabs" aria-label={fridge.name}>
      <NavLink to={base} end>{t.food}</NavLink>
      <NavLink to={base + "/devices"}>{t.devices}</NavLink>
    </nav>
    <Routes>
      <Route index element={<Dashboard db={db} fridge={fridge} language={language} />} />
      <Route path="devices" element={<Devices db={db} fridgeId={fridge.id} language={language} />} />
      <Route path="food/add" element={<AddFood key={fridge.id} user={user} fridgeId={fridge.id} language={language} />} />
      <Route path="food/:itemId" element={<ItemPage db={db} fridge={fridge} user={user} language={language} />} />
      <Route path="*" element={<Navigate to={base} replace />} />
    </Routes>
  </>;
}

function FridgeHub({ fridges, language }: { fridges: Fridge[]; language: Language }) {
  const t = words[language];
  return <>
    <h1>{t.home}</h1>
    {fridges.length === 0 ? <p className="surface">{t.emptyFridges}</p> :
      <ul className="food-list">{fridges.map((fridge) => <li key={fridge.id}>
        <Link to={"/fridges/" + encodeURIComponent(fridge.id)}>
          <strong>{fridge.name}</strong><span className="chevron" aria-hidden="true">›</span>
        </Link>
      </li>)}</ul>}
  </>;
}

function SignedIn({ db, user, language }: { db: Firestore; user: User; language: Language }) {
  const t = words[language];
  const live = useFridges(user);
  if (live.error) return <p role="alert">{t.failed}</p>;
  if (!live.data) return <p role="status">{t.loading}</p>;
  return <Routes>
    <Route path="/fridges" element={<FridgeHub fridges={live.data} language={language} />} />
    <Route path="/fridges/:fridgeId/*" element={<FridgePage db={db} fridges={live.data} user={user} language={language} />} />
    <Route path="*" element={<Navigate to="/fridges" replace />} />
  </Routes>;
}

function App() {
  const [language, setLanguage] = useState<Language>(() => localStorage.getItem("foodwarden_locale") === "en" ? "en" : "th");
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const t = words[language];

  useEffect(() => {
    document.documentElement.lang = language;
    localStorage.setItem("foodwarden_locale", language);
  }, [language]);

  useEffect(() => {
    if (!services) return;
    return onAuthStateChanged(services.auth, setUser, () => {
      setUser(null);
      setFailed(true);
    });
  }, []);

  async function login() {
    if (!services || signingIn) return;
    setSigningIn(true);
    setFailed(false);
    try {
      await signInWithPopup(services.auth, new GoogleAuthProvider());
    } catch {
      setFailed(true);
    } finally {
      setSigningIn(false);
    }
  }

  return <>
    <header className="header"><div className="header-inner">
      <Link to="/fridges" className="brand">FoodWarden</Link>
      <div className="header-actions">
        <button className="secondary" type="button" onClick={() => setLanguage(language === "th" ? "en" : "th")}
          lang={language === "th" ? "en" : "th"}>{language === "th" ? "English" : "ภาษาไทย"}</button>
        {user && services && <button className="secondary" onClick={() => {
          if (services) void signOut(services.auth).catch(() => setFailed(true));
        }}>{t.signOut}</button>}
      </div>
    </div></header>
    <main>
      {failed && <p role="alert" className="error">{t.failed}</p>}
      {!services ? <p className="surface">{t.setup}</p> :
        user === undefined ? <p role="status">{t.loading}</p> :
        user ? <SignedIn key={user.uid} db={services.db} user={user} language={language} /> :
        <section className="surface welcome">
          <h1>FoodWarden</h1><p>{t.welcome}</p>
          <button className="primary" onClick={() => void login()} disabled={signingIn}>
            {signingIn ? t.loading : t.signIn}
          </button>
        </section>}
    </main>
  </>;
}

const root = document.getElementById("root");
if (!root) throw new Error("Dashboard root is missing");
createRoot(root).render(<StrictMode><BrowserRouter><App /></BrowserRouter></StrictMode>);
