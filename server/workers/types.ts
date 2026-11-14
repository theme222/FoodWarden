export interface AppBindings {
  DB: D1Database;
  PHOTOS: R2Bucket;
  ASSETS: Fetcher;
  FRIDGE_ROOM: DurableObjectNamespace;
  APP_ENV: string;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  DEV_AUTH_BYPASS_EMAIL?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  GEMINI_FALLBACK_MODEL?: string;
  GEMINI_API_BASE_URL?: string;
  LINE_CHANNEL_ACCESS_TOKEN?: string;
  LINE_API_BASE_URL?: string;
}

declare global {
  namespace Cloudflare {
    interface Env extends AppBindings {}
    interface GlobalProps {
      mainModule: typeof import("./index");
      durableNamespaces: "FridgeRoom";
    }
  }
}

export type ApiErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "INVALID_TOKEN"
  | "INVALID_PAYLOAD"
  | "PAYLOAD_TOO_LARGE"
  | "UNIDENTIFIABLE"
  | "NOT_FOUND"
  | "METHOD_NOT_ALLOWED"
  | "CONFLICT"
  | "PHOTO_NOT_FOUND"
  | "SERVICE_UNAVAILABLE"
  | "INTERNAL_ERROR";

export interface ApiErrorEnvelope {
  error: ApiErrorCode;
  message: string;
}
