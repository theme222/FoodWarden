import { betterAuth } from "better-auth";
import { getCookies } from "better-auth/cookies";
import { makeSignature } from "better-auth/crypto";
import type { AppBindings } from "../types";

const DEV_FALLBACK_SECRET =
  "foodwarden-local-dev-secret-change-in-production-32";

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  image: string | null;
}

export function isDevBypassEnabled(env: AppBindings): boolean {
  return (
    env.APP_ENV === "development" && Boolean(env.DEV_AUTH_BYPASS_EMAIL?.trim())
  );
}

export function isGoogleAuthEnabled(env: AppBindings): boolean {
  return Boolean(
    env.GOOGLE_CLIENT_ID?.trim() && env.GOOGLE_CLIENT_SECRET?.trim(),
  );
}

function resolveSecret(env: AppBindings): string {
  const secret = env.BETTER_AUTH_SECRET?.trim();
  if (!secret && env.APP_ENV !== "development") {
    throw new Error(
      "BETTER_AUTH_SECRET must be configured outside development.",
    );
  }
  return secret || DEV_FALLBACK_SECRET;
}

const DEV_TRUSTED_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:8787",
  "http://127.0.0.1:8787",
];

export function createAuth(env: AppBindings, requestUrl: string) {
  const origin = env.BETTER_AUTH_URL?.trim() || new URL(requestUrl).origin;
  const secret = resolveSecret(env);
  const trustedOrigins =
    env.APP_ENV === "development"
      ? Array.from(new Set([origin, ...DEV_TRUSTED_ORIGINS]))
      : [origin];

  return betterAuth({
    appName: "FoodWarden",
    baseURL: origin,
    basePath: "/api/auth",
    trustedOrigins,
    secret,
    database: env.DB,
    socialProviders: isGoogleAuthEnabled(env)
      ? {
          google: {
            clientId: env.GOOGLE_CLIENT_ID!.trim(),
            clientSecret: env.GOOGLE_CLIENT_SECRET!.trim(),
          },
        }
      : undefined,
    advanced: {
      ipAddress: {
        ipAddressHeaders: ["cf-connecting-ip"],
      },
    },
  });
}

export async function getAuthenticatedUser(
  env: AppBindings,
  request: Request,
): Promise<AuthenticatedUser | null> {
  const auth = createAuth(env, request.url);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user?.email || !session.user.emailVerified) {
    return null;
  }

  const normalizedEmail = session.user.email.trim().toLowerCase();
  if (!normalizedEmail) return null;

  return {
    id: session.user.id,
    email: normalizedEmail,
    name: session.user.name,
    image: session.user.image ?? null,
  };
}

export async function createSignedSessionForEmail(
  env: AppBindings,
  requestUrl: string,
  options: {
    email: string;
    name?: string;
    emailVerified?: boolean;
    expiresInMs?: number;
  },
): Promise<{ cookieHeader: string; userId: string }> {
  const normalizedEmail = options.email.trim().toLowerCase();
  const nowIso = new Date().toISOString();
  const expiresIso = new Date(
    Date.now() + (options.expiresInMs ?? 7 * 86_400_000),
  ).toISOString();
  const secret = resolveSecret(env);

  let userRow = await env.DB.prepare("SELECT id FROM user WHERE email = ?")
    .bind(normalizedEmail)
    .first<{ id: string }>();

  const userId = userRow?.id ?? crypto.randomUUID();
  if (!userRow) {
    await env.DB.prepare(
      "INSERT INTO user (id, name, email, emailVerified, image, createdAt, updatedAt) VALUES (?, ?, ?, ?, NULL, ?, ?)",
    )
      .bind(
        userId,
        options.name?.trim() ||
          normalizedEmail.split("@")[0] ||
          "FoodWarden User",
        normalizedEmail,
        options.emailVerified === false ? 0 : 1,
        nowIso,
        nowIso,
      )
      .run();
  }

  const token =
    crypto.randomUUID().replace(/-/g, "") +
    crypto.randomUUID().replace(/-/g, "");
  await env.DB.prepare(
    "INSERT INTO session (id, expiresAt, token, createdAt, updatedAt, ipAddress, userAgent, userId) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)",
  )
    .bind(crypto.randomUUID(), expiresIso, token, nowIso, nowIso, userId)
    .run();

  const auth = createAuth(env, requestUrl);
  const cookies = getCookies(auth.options);
  const signature = await makeSignature(token, secret);
  const signedValue = encodeURIComponent(`${token}.${signature}`);
  const attrs = cookies.sessionToken.attributes;
  const parts = [
    `${cookies.sessionToken.name}=${signedValue}`,
    `Path=${attrs.path}`,
    "HttpOnly",
    `SameSite=${attrs.sameSite}`,
  ];
  if (attrs.secure) parts.push("Secure");

  return { cookieHeader: parts.join("; "), userId };
}
