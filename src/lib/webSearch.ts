import { bridge } from './bridgeClient';

export type WebSearchOpts = {
  query: string;
  count?: number;
  braveKey?: string;
  searxUrl?: string;
};

function payload(opts: WebSearchOpts): { query: string; count?: number; braveKey?: string; searxUrl?: string } {
  const query = (opts.query || '').trim();
  if (!query) throw new Error('missing query');
  return {
    query,
    count: opts.count,
    braveKey: opts.braveKey?.trim() || undefined,
    searxUrl: opts.searxUrl?.trim() || undefined,
  };
}

/** Desktop IPC → DEV /web-search → localhost bridge. */
export async function runWebSearch(opts: WebSearchOpts): Promise<string> {
  const body = payload(opts);
  const desktop = window.ablitDesktop;
  if (desktop?.webSearch) {
    return desktop.webSearch(body);
  }
  if (import.meta.env.DEV) {
    const res = await fetch('/web-search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(text || `web_search HTTP ${res.status}`);
    return text;
  }
  if (bridge.connected) return bridge.webSearch(body);
  throw new Error('web_search requires the desktop app or the local bridge');
}
