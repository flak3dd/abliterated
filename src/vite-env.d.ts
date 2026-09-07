/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ABLITERATED_TOKEN?: string;
  readonly VITE_ABLITERATED_BASE_URL?: string;
  readonly VITE_ABLITERATED_MODEL?: string;
  readonly VITE_ABLITERATED_ADMIN_USER?: string;
  readonly VITE_ABLITERATED_ADMIN_PASSWORD?: string;
  readonly VITE_PLATFORM_GATEWAY_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface AblitDesktopApi {
  getLicense: () => Promise<string>;
  setLicense: (key: string) => Promise<boolean>;
  /** Stable per-install device id (userData). */
  getDeviceId?: () => Promise<string>;
  getVersion: () => Promise<string>;
  openExternal: (url: string) => Promise<boolean>;
  /** Subscribe to abliterated://license?key=… deep links; returns unsubscribe. */
  onLicenseDeepLink?: (cb: (key: string) => void) => () => void;
  webSearch: (opts: {
    query: string;
    count?: number;
    braveKey?: string;
    searxUrl?: string;
  }) => Promise<string>;
  sparkInstallPath?: () => Promise<string>;
  revealSparkInstall?: () => Promise<{ ok: boolean; path: string }>;
  platform: string;
}

interface Window {
  ablitDesktop?: AblitDesktopApi;
}
