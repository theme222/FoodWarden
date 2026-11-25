import { RotateCcw } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import useSWR from "swr";
import {
  fetchAuthState,
  signInDestination,
  signInDevBypass,
  signInWithGoogle,
  signOutSession,
} from "./auth";
import type { SessionUser } from "./auth";
import { ConfirmationProvider } from "./components/confirmation";
import { DashboardHeader } from "./components/DashboardHeader";
import { PageErrorBoundary } from "./components/page-error-boundary";
import { SessionCache } from "./components/session-cache";
import { StatusAlert } from "./components/status-alert";
import { Toaster } from "./components/ui/sonner";
import { useFridges } from "./data";
import type { Language } from "./model";
import { SignInPanel } from "./pages/SignInPage";
import type { ColorTheme } from "./state/dashboard-machine";
import { applyColorTheme, readStoredColorTheme } from "./theme";
import { words } from "./words";

const MyAccount = lazy(() =>
  import("./MyAccount").then((module) => ({ default: module.MyAccount })),
);
const FridgeHub = lazy(() =>
  import("./pages/FridgeHubPage").then((module) => ({
    default: module.FridgeHub,
  })),
);
const FridgePage = lazy(() =>
  import("./pages/FridgeWorkspace").then((module) => ({
    default: module.FridgePage,
  })),
);
const ComponentGalleryPage = lazy(() =>
  import("./pages/ComponentGalleryPage").then((module) => ({
    default: module.ComponentGalleryPage,
  })),
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
  const warning = live.error ? (
    <StatusAlert
      action={
        <button type="button" className="btn sm" onClick={live.reload}>
          <RotateCcw size={15} aria-hidden="true" />
          {language === "th" ? "ลองใหม่" : "Retry"}
        </button>
      }
    >
      {live.data
        ? language === "th"
          ? "อัปเดตรายการตู้เย็นไม่สำเร็จ กำลังแสดงข้อมูลล่าสุดที่มี"
          : "Could not refresh fridges. Showing the last available data."
        : t.failed}
    </StatusAlert>
  ) : null;
  if (!live.data)
    return warning ?? <output className="sub">{t.loading}</output>;
  return (
    <>
      {warning}
      <Suspense fallback={<output className="sub">{t.loading}</output>}>
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
            path="/fridges/:fridgeId/me"
            element={<Navigate to="/me" replace />}
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
      </Suspense>
    </>
  );
}

export function App() {
  const location = useLocation();
  const [language, setLanguage] = useState<Language>(() =>
    localStorage.getItem("foodwarden_locale") === "en" ? "en" : "th",
  );
  const [colorTheme, setColorTheme] =
    useState<ColorTheme>(readStoredColorTheme);
  const auth = useSWR("foodwarden-auth", () => fetchAuthState(), {
    errorRetryCount: 2,
  });
  const user = auth.data?.user ?? (auth.data || auth.error ? null : undefined);
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
      await signInWithGoogle(signInDestination(location));
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
      <p className="narrow-screen-message">
        <strong>FoodWarden</strong>
        {th
          ? "พื้นที่แสดงผลแคบเกินไป ลองขยายหน้าต่างหรือลดการซูม"
          : "This window is too narrow. Widen it or zoom out to continue."}
      </p>
      <a className="skip-to-content" href="#main-content">
        {th ? "ข้ามไปยังเนื้อหาหลัก" : "Skip to main content"}
      </a>
      <DashboardHeader
        user={user}
        language={language}
        onLanguageChange={() => setLanguage(language === "th" ? "en" : "th")}
        onSignOut={handleSignOut}
      />
      <main id="main-content" tabIndex={-1} className="wrap">
        <PageErrorBoundary key={location.pathname} language={language}>
          {(failed || auth.error) && (
            <StatusAlert
              action={
                <button
                  type="button"
                  className="btn sm"
                  onClick={() =>
                    void refreshAuth().catch(() => setFailed(true))
                  }
                >
                  <RotateCcw size={15} aria-hidden="true" />
                  {th ? "ลองใหม่" : "Retry"}
                </button>
              }
            >
              {t.failed}
            </StatusAlert>
          )}
          {location.pathname === "/components" ? (
            <Suspense fallback={<output className="sub">{t.loading}</output>}>
              <ComponentGalleryPage
                language={language}
                colorTheme={colorTheme}
                onLanguageChange={setLanguage}
                onColorThemeChange={setColorTheme}
              />
            </Suspense>
          ) : auth.error && !auth.data ? null : user === undefined ? (
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
        </PageErrorBoundary>
      </main>
      <Toaster />
    </ConfirmationProvider>
  );
}
