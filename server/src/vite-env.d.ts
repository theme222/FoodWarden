/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_UI_VERSION?: string;
  readonly VITE_WORKER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
