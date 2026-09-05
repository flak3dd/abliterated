/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ABLITERATED_TOKEN?: string;
  readonly VITE_ABLITERATED_BASE_URL?: string;
  readonly VITE_ABLITERATED_MODEL?: string;
  readonly VITE_ABLITERATED_ADMIN_USER?: string;
  readonly VITE_ABLITERATED_ADMIN_PASSWORD?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface AblitDesktopApi {
  getLicense: () => Promise<string>;
  setLicense: (key: string) => Promise<boolean>;
  getVersion: () => Promise<string>;
  webSearch: (opts: {
    query: string;
    count?: number;
    braveKey?: string;
    searxUrl?: string;
  }) => Promise<string>;
  platform: string;
}

interface Window {
  ablitDesktop?: AblitDesktopApi;
}
