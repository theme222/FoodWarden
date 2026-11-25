import { clearStoredPairings } from "./line-data";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  image: string | null;
}

export interface AuthConfig {
  googleEnabled: boolean;
  devLoginEnabled: boolean;
}

export interface AuthState {
  user: SessionUser | null;
  config: AuthConfig;
}

export async function fetchAuthState(): Promise<AuthState> {
  const [configRes, sessionRes] = await Promise.all([
    fetch("/api/auth/config", { credentials: "same-origin" }),
    fetch("/api/auth/get-session", { credentials: "same-origin" }),
  ]);

  if (!configRes.ok) {
    throw new Error("Auth configuration unavailable");
  }
  const config = (await configRes.json()) as AuthConfig;

  if (!sessionRes.ok) {
    if (sessionRes.status === 401) return { user: null, config };
    throw new Error("Session check unavailable");
  }

  const sessionData: unknown = await sessionRes.json();
  if (
    typeof sessionData !== "object" ||
    sessionData === null ||
    !("user" in sessionData) ||
    typeof sessionData.user !== "object" ||
    sessionData.user === null
  ) {
    return { user: null, config };
  }

  const rawUser = sessionData.user as Record<string, unknown>;
  const email =
    typeof rawUser.email === "string" ? rawUser.email.trim().toLowerCase() : "";
  const emailVerified =
    rawUser.emailVerified === true || rawUser.emailVerified === 1;
  if (!email || !emailVerified) {
    return { user: null, config };
  }

  return {
    user: {
      id: typeof rawUser.id === "string" ? rawUser.id : email,
      email,
      name:
        typeof rawUser.name === "string" && rawUser.name.trim()
          ? rawUser.name.trim()
          : email,
      image: typeof rawUser.image === "string" ? rawUser.image : null,
    },
    config,
  };
}

export function signInDestination(location: {
  pathname: string;
  search: string;
  hash: string;
}): string {
  const { pathname, search, hash } = location;
  if (
    pathname === "/me" ||
    /^\/fridges(?:\/[a-z0-9_-]+(?:\/[a-z0-9_-]+)*)?\/?$/i.test(pathname)
  )
    return pathname + search + hash;
  return "/fridges";
}

export async function signInWithGoogle(
  callbackURL = "/fridges",
): Promise<void> {
  const res = await fetch("/api/auth/sign-in/social", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "google", callbackURL }),
  });
  if (!res.ok) {
    throw new Error("Google sign-in failed");
  }
  const payload = (await res.json()) as { url?: string };
  if (!payload.url) {
    throw new Error("Missing OAuth redirect URL");
  }
  window.location.assign(payload.url);
}

export async function signInDevBypass(): Promise<void> {
  const res = await fetch("/api/auth/dev-login", {
    method: "POST",
    credentials: "same-origin",
  });
  if (!res.ok) {
    throw new Error("Dev login failed");
  }
}

export async function signOutSession(): Promise<void> {
  const res = await fetch("/api/auth/sign-out", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!res.ok) {
    throw new Error("Sign-out failed");
  }
  clearStoredPairings();
}
