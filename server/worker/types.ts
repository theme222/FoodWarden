export interface AppBindings {
  DB: D1Database;
  PHOTOS: R2Bucket;
  ASSETS: Fetcher;
  FRIDGE_ROOM: DurableObjectNamespace;
  APP_ENV: string;
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
  | "INTERNAL_ERROR";

export interface ApiErrorEnvelope {
  error: ApiErrorCode;
  message: string;
}
