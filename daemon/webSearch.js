/**
 * Keyless web search for the agent `web_search` tool.
 * Primary: Brave HTML SERP. Fallback: Bing HTML. Last resort: Wikipedia opensearch.
 * Optional: Brave Search API key, SearxNG JSON endpoint.
 */
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const FETCH_MS = 12_000;
const DEFAULT_COUNT = 8;
const MAX_COUNT = 12;
const MAX_SNIPPET = 240;

export function clampCount(n) {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return DEFAULT_COUNT;
  return Math.min(MAX_COUNT, Math.max(1, Math.floor(v)));
}

export function decodeEntities(s) {
  return String(s || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

export function stripTags(s) {
  return decodeEntities(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

export function isBlockedHost(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0') return true;
    if (host === '169.254.169.254' || host.endsWith('.localhost')) return true;
    if (/^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return true;
    return false;
  } catch {
    return true;
  }
}

function isHttpUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function unwrapBingUrl(href) {
  try {
    const u = new URL(href, 'https://www.bing.com');
    let raw = u.searchParams.get('u');
    if (!raw) return href;
    if (raw.startsWith('a1')) raw = raw.slice(2);
    const pad = raw.length % 4 === 0 ? '' : '='.repeat(4 - (raw.length % 4));
    const decoded = Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64').toString('utf8');
    if (/^https?:\/\//i.test(decoded)) return decoded;
  } catch {
    /* keep original */
  }
  return href;
}

export function unwrapDdgUrl(href) {
  try {
    const u = new URL(href, 'https://duckduckgo.com');
    const uddg = u.searchParams.get('uddg');
    if (uddg) return decodeURIComponent(uddg);
  } catch {
    /* keep original */
  }
  return href;
}

function pushResult(out, seen, item) {
  const url = String(item.url || '').trim();
  if (!isHttpUrl(url) || isBlockedHost(url)) return;
  if (seen.has(url)) return;
  seen.add(url);
  const title = stripTags(item.title || url).slice(0, 200) || url;
  const snippet = stripTags(item.snippet || '').slice(0, MAX_SNIPPET);
  out.push({ title, url, snippet });
}

export function parseBraveHtml(html) {
  const out = [];
  const seen = new Set();
  const blocks = String(html || '').split(/data-type="web"/);
  for (let i = 1; i < blocks.length; i++) {
    const chunk = blocks[i].slice(0, 8000);
    const hrefM = chunk.match(/<a href="(https?:\/\/[^"]+)"/i);
    if (!hrefM) continue;
    const url = hrefM[1];
    if (/search\.brave\.com/i.test(url) || /brave\.com\/search/i.test(url)) continue;
    const titleM =
      chunk.match(/search-snippet-title[^>]*\stitle="([^"]+)"/i) ||
      chunk.match(/search-snippet-title[^>]*>([\s\S]*?)<\/div>/i);
    const snipM = chunk.match(/generic-snippet[\s\S]{0,400}?line-clamp-dynamic[^>]*>([\s\S]*?)<\/div>/i);
    pushResult(out, seen, {
      url,
      title: titleM ? titleM[1] : '',
      snippet: snipM ? snipM[1] : '',
    });
  }
  return out;
}

export function parseBingHtml(html) {
  const out = [];
  const seen = new Set();
  const re = /<li class="b_algo"[\s\S]*?<\/li>/gi;
  let m;
  const src = String(html || '');
  while ((m = re.exec(src)) !== null) {
    const block = m[0];
    const h2 = block.match(/<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!h2) continue;
    const url = unwrapBingUrl(decodeEntities(h2[1]));
    const cite = block.match(/<cite>([\s\S]*?)<\/cite>/i);
    const finalUrl =
      isHttpUrl(url) && !/bing\.com\/ck\//i.test(url)
        ? url
        : cite
          ? String(stripTags(cite[1]).replace(/\s*[›>]\s*/g, '/').replace(/\s+/g, ''))
          : url;
    const snip = block.match(/<p class="b_lineclamp\d+"[^>]*>([\s\S]*?)<\/p>/i);
    pushResult(out, seen, { url: finalUrl, title: h2[2], snippet: snip ? snip[1] : '' });
  }
  return out;
}

export function parseDdgHtml(html) {
  const out = [];
  const seen = new Set();
  const re = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  const src = String(html || '');
  while ((m = re.exec(src)) !== null) {
    const url = unwrapDdgUrl(decodeEntities(m[1]));
    const after = src.slice(m.index, m.index + 1200);
    const snip = after.match(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|td|div)>/i);
    pushResult(out, seen, { url, title: m[2], snippet: snip ? snip[1] : '' });
  }
  return out;
}

export function parseBraveApi(json) {
  const out = [];
  const seen = new Set();
  const web = json && json.web && Array.isArray(json.web.results) ? json.web.results : [];
  for (const r of web) {
    pushResult(out, seen, { url: r.url, title: r.title, snippet: r.description || r.extra_snippets?.[0] || '' });
  }
  return out;
}

export function parseSearxJson(json) {
  const out = [];
  const seen = new Set();
  const results = json && Array.isArray(json.results) ? json.results : [];
  for (const r of results) {
    pushResult(out, seen, { url: r.url, title: r.title, snippet: r.content || r.snippet || '' });
  }
  return out;
}

export function parseWikiOpensearch(json) {
  const out = [];
  const seen = new Set();
  if (!Array.isArray(json) || json.length < 4) return out;
  const titles = json[1] || [];
  const descs = json[2] || [];
  const urls = json[3] || [];
  for (let i = 0; i < urls.length; i++) {
    pushResult(out, seen, { url: urls[i], title: titles[i], snippet: descs[i] });
  }
  return out;
}

export function formatResults(query, results, provider) {
  const rows = results || [];
  if (!rows.length) return `web_search ${JSON.stringify(query)} via ${provider}: no results`;
  const lines = [`web_search ${JSON.stringify(query)} via ${provider} (${rows.length} results)`];
  rows.forEach((r, i) => {
    lines.push(`${i + 1}. ${r.title}`);
    lines.push(`   ${r.url}`);
    if (r.snippet) lines.push(`   ${r.snippet}`);
  });
  lines.push('Follow with web_fetch on the URLs you need.');
  return lines.join('\n');
}

async function fetchText(url, headers = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'user-agent': UA,
        accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
        ...headers,
      },
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  } finally {
    clearTimeout(t);
  }
}

function looksBotWall(html) {
  return /anomaly-modal|unfortunately, bots use|select all squares containing a duck/i.test(
    String(html || ''),
  );
}

/**
 * @param {{ query: string, count?: number, braveKey?: string, searxUrl?: string }} opts
 * @returns {Promise<string>}
 */
export async function searchWeb(opts) {
  const query = String(opts?.query || '').trim();
  if (!query) throw new Error('missing query');
  const count = clampCount(opts?.count);
  const braveKey = String(opts?.braveKey || '').trim();
  const searxUrl = String(opts?.searxUrl || '').trim();
  const errors = [];

  if (braveKey) {
    try {
      const u = new URL('https://api.search.brave.com/res/v1/web/search');
      u.searchParams.set('q', query);
      u.searchParams.set('count', String(count));
      const { ok, status, text } = await fetchText(u.toString(), {
        accept: 'application/json',
        'x-subscription-token': braveKey,
      });
      if (!ok) throw new Error(`Brave API HTTP ${status}`);
      const results = parseBraveApi(JSON.parse(text)).slice(0, count);
      if (results.length) return formatResults(query, results, 'brave-api');
      errors.push('Brave API: empty');
    } catch (e) {
      errors.push(`Brave API: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (searxUrl) {
    try {
      const base = searxUrl.replace(/\/+$/, '');
      const u = new URL(base.includes('?') ? base : `${base}/search`);
      u.searchParams.set('q', query);
      u.searchParams.set('format', 'json');
      u.searchParams.set('categories', 'general');
      const { ok, status, text } = await fetchText(u.toString(), { accept: 'application/json' });
      if (!ok) throw new Error(`SearxNG HTTP ${status}`);
      const results = parseSearxJson(JSON.parse(text)).slice(0, count);
      if (results.length) return formatResults(query, results, 'searx');
      errors.push('SearxNG: empty');
    } catch (e) {
      errors.push(`SearxNG: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  try {
    const u = `https://search.brave.com/search?q=${encodeURIComponent(query)}&source=web`;
    const { ok, status, text } = await fetchText(u);
    if (!ok) throw new Error(`HTTP ${status}`);
    if (looksBotWall(text)) throw new Error('bot wall');
    const results = parseBraveHtml(text).slice(0, count);
    if (results.length) return formatResults(query, results, 'brave');
    errors.push('Brave HTML: empty');
  } catch (e) {
    errors.push(`Brave HTML: ${e instanceof Error ? e.message : String(e)}`);
  }

  try {
    const u = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=en`;
    const { ok, status, text } = await fetchText(u);
    if (!ok) throw new Error(`HTTP ${status}`);
    const results = parseBingHtml(text).slice(0, count);
    if (results.length) return formatResults(query, results, 'bing');
    errors.push('Bing: empty');
  } catch (e) {
    errors.push(`Bing: ${e instanceof Error ? e.message : String(e)}`);
  }

  try {
    const u = new URL('https://en.wikipedia.org/w/api.php');
    u.searchParams.set('action', 'opensearch');
    u.searchParams.set('search', query);
    u.searchParams.set('limit', String(Math.min(count, 8)));
    u.searchParams.set('namespace', '0');
    u.searchParams.set('format', 'json');
    u.searchParams.set('origin', '*');
    const { ok, status, text } = await fetchText(u.toString(), { accept: 'application/json' });
    if (!ok) throw new Error(`HTTP ${status}`);
    const results = parseWikiOpensearch(JSON.parse(text)).slice(0, count);
    if (results.length) return formatResults(query, results, 'wikipedia');
    errors.push('Wikipedia: empty');
  } catch (e) {
    errors.push(`Wikipedia: ${e instanceof Error ? e.message : String(e)}`);
  }

  throw new Error(`web_search failed (${errors.join('; ')})`);
}
