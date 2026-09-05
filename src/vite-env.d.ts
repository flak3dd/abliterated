/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ABLITERATED_TOKEN?: string;
  readonly VITE_ABLITERATED_BASE_URL?: string;
  readonly VITE_ABLITERATED_MODEL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
