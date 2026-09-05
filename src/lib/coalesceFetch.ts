/** In-flight coalesce for identical GETs (overlapping /models or health probes). */
type Cached = {
  status: number;
  statusText: string;
  headers: Headers;
  buffer: ArrayBuffer;
};

const inflight = new Map<string, Promise<Cached>>();

function authKeyFrom(init?: RequestInit): string {
  const headers = init?.headers;
  if (!headers) return '';
  if (headers instanceof Headers) {
    return headers.get('Authorization') || headers.get('authorization') || '';
  }
  if (Array.isArray(headers)) {
    for (const [k, v] of headers) {
      if (k.toLowerCase() === 'authorization') return v;
    }
    return '';
  }
  const h = headers as Record<string, string>;
  return h.Authorization || h.authorization || '';
}

function toResponse(cached: Cached): Response {
  return new Response(cached.buffer.slice(0), {
    status: cached.status,
    statusText: cached.statusText,
    headers: cached.headers,
  });
}

export function coalesceFetch(url: string, init?: RequestInit): Promise<Response> {
  const method = (init?.method || 'GET').toUpperCase();
  if (method !== 'GET' || init?.body) {
    return fetch(url, init);
  }
  const key = `${method} ${url} ${authKeyFrom(init)}`;
  let pending = inflight.get(key);
  if (!pending) {
    pending = fetch(url, init)
      .then(async (res) => {
        const buffer = await res.arrayBuffer();
        return {
          status: res.status,
          statusText: res.statusText,
          headers: res.headers,
          buffer,
        };
      })
      .finally(() => {
        inflight.delete(key);
      });
    inflight.set(key, pending);
  }
  return pending.then(toResponse);
}
