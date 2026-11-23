import { RotateCcw } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import useSWR from "swr";
import {
  fetchAuthState,
  signInDevBypass,
  signInWithGoogle,
  signOutSession,
} from "./auth";
import type { SessionUser } from "./auth";
import { ConfirmationProvider } from "./components/confirmation";
import { DashboardHeader } from "./components/DashboardHeader";
import { SessionCache } from "./components/session-cache";
import { StatusAlert } from "./components/status-alert";
import { Toaster } from "./components/ui/sonner";
import { useFridges } from "./data";
import type { Language } from "./model";
import { FridgeHub } from "./pages/FridgeHubPage";
import { FridgePage } from "./pages/FridgeWorkspace";
import { SignInPanel } from "./pages/SignInPage";
import type { ColorTheme } from "./state/dashboard-machine";
import { applyColorTheme, readStoredColorTheme } from "./theme";
import { words } from "./words";

const MyAccount = lazy(() =>
  import("./MyAccount").then((module) => ({ default: module.MyAccount })),
);

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

export function App() {
  const [language, setLanguage] = useState<Language>(() =>
    localStorage.getItem("foodwarden_locale") === "en" ? "en" : "th",
  );
  const [colorTheme, setColorTheme] = useState<ColorTheme>(readStoredColorTheme);
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
