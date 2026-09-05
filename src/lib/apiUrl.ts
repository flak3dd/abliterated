import type { ClientSettings, InferenceProvider } from '../types';

type EndpointSettings = {
  baseUrl: string;
  sparkViaProxy?: boolean;
  featherlessViaProxy?: boolean;
  inferenceProvider?: InferenceProvider;
};

function isLocalSparkHost(hostname: string, port: string): boolean {
  const local = hostname === '127.0.0.1' || hostname === 'localhost';
  return local && port === '8000';
}

function isLocalFeatherlessHost(hostname: string, port: string): boolean {
  const local = hostname === '127.0.0.1' || hostname === 'localhost';
  return local && port === '3000';
}

function shouldRewriteSpark(settings: EndpointSettings, url: URL): boolean {
  if (!import.meta.env.DEV) return false;
  const port = url.port || (url.protocol === 'https:' ? '443' : '80');
  const localSpark = isLocalSparkHost(url.hostname, port);
  if (settings.sparkViaProxy === true) return localSpark || settings.inferenceProvider === 'dgx-spark';
  if (localSpark) return true;
  return false;
}

function isCloudFeatherlessHost(hostname: string): boolean {
  return hostname === 'api.featherless.ai';
}

function shouldRewriteFeatherless(settings: EndpointSettings, url: URL): boolean {
  if (!import.meta.env.DEV) return false;
  const port = url.port || (url.protocol === 'https:' ? '443' : '80');
  const local = isLocalFeatherlessHost(url.hostname, port);
  if (local) return settings.featherlessViaProxy !== false;
  // Cloud API: always rewrite in DEV to avoid browser CORS (like api.abliteration.ai -> /v1).
  if (isCloudFeatherlessHost(url.hostname)) return true;
  return false;
}

function sparkProxyPath(pathname: string, search: string): string {
  let path = pathname;
  if (path.startsWith("/v1")) {
    path = "/spark-v1" + path.slice(3);
  } else if (path === "/" || path === "") {
    path = "/spark-v1";
  } else {
    path = "/spark-v1" + (path.startsWith("/") ? path : "/" + path);
  }
  return path + search;
}

function featherlessLocalProxyPath(pathname: string, search: string): string {
  let path = pathname;
  if (path.startsWith("/v1")) {
    path = "/featherless-v1" + path.slice(3);
  } else if (path === "/" || path === "") {
    path = "/featherless-v1";
  } else {
    path = "/featherless-v1" + (path.startsWith("/") ? path : "/" + path);
  }
  return path + search;
}

/** DEV path for https://api.featherless.ai -> Vite /featherless-api (CORS bypass). */
function featherlessCloudProxyPath(pathname: string, search: string): string {
  return "/featherless-api" + pathname + search;
}

/** Build chat/models URL; in DEV rewrite Abliteration + local Spark/Featherless through Vite proxies. */
export function endpointUrl(settings: EndpointSettings | Pick<ClientSettings, "baseUrl">, suffix: string): string {
  const base = settings.baseUrl.replace(/\/$/, "");
  const pathSuffix = suffix.startsWith("/") ? suffix : "/" + suffix;
  const joined = base + pathSuffix;

  if (import.meta.env.DEV) {
    try {
      const url = new URL(joined);
      if (url.hostname === "api.abliteration.ai") {
        return url.pathname + url.search;
      }
      const full: EndpointSettings = {
        baseUrl: settings.baseUrl,
        sparkViaProxy: "sparkViaProxy" in settings ? (settings as EndpointSettings).sparkViaProxy : undefined,
        featherlessViaProxy:
          "featherlessViaProxy" in settings ? (settings as EndpointSettings).featherlessViaProxy : undefined,
        inferenceProvider: "inferenceProvider" in settings ? (settings as EndpointSettings).inferenceProvider : undefined,
      };
      if (shouldRewriteFeatherless(full, url)) {
        const port = url.port || (url.protocol === "https:" ? "443" : "80");
        if (isCloudFeatherlessHost(url.hostname)) {
          return featherlessCloudProxyPath(url.pathname, url.search);
        }
        const local = isLocalFeatherlessHost(url.hostname, port);
        if (local || full.featherlessViaProxy === true) {
          return featherlessLocalProxyPath(url.pathname, url.search);
        }
      }
      if (shouldRewriteSpark(full, url)) {
        const port = url.port || (url.protocol === "https:" ? "443" : "80");
        const localSpark = isLocalSparkHost(url.hostname, port);
        if (localSpark || full.sparkViaProxy === true) {
          return sparkProxyPath(url.pathname, url.search);
        }
      }
    } catch {
      // relative or invalid -- keep joined
    }
  }

  return joined;
}

export function formatFetchError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
