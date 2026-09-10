/** IndexedDB backing for bulky localStorage keys (threads, messages, jobs, agent runs). */

const DB_NAME = 'ablit_durable';
const DB_VERSION = 1;
const STORE = 'kv';

export const DURABLE_KEYS = [
  'ablit_threads',
  'ablit_messages',
  'ablit_jobs',
  'ablit_agent_runs',
  'ablit_apply_inbox',
] as const;

const BULKY: readonly string[] = DURABLE_KEYS;

function canUseIdb(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!canUseIdb()) {
      reject(new Error('indexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('idb open failed'));
  });
}

export async function durableGet<T>(key: string): Promise<T | undefined> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return undefined;
  }
}

export async function durableSet(key: string, value: unknown): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* quota / private mode — localStorage remains the fallback */
  }
}

export async function durableDelete(key: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* ignore */
  }
}

export function isBulkyStorageKey(key: string): boolean {
  return BULKY.includes(key);
}

/**
 * First launch after upgrade: prefer IDB if present, else copy localStorage → IDB.
 * Returns true when IDB was used.
 */
export async function hydrateDurableStore(): Promise<boolean> {
  if (!canUseIdb() || typeof localStorage === 'undefined') return false;
  let used = false;
  for (const key of BULKY) {
    const fromIdb = await durableGet<unknown>(key);
    if (fromIdb != null) {
      try {
        localStorage.setItem(key, JSON.stringify(fromIdb));
        used = true;
      } catch {
        /* quota — keep IDB as source of truth; reads still hit LS cache when possible */
      }
      continue;
    }
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        await durableSet(key, JSON.parse(raw));
        used = true;
      }
    } catch {
      /* corrupt LS */
    }
  }
  return used;
}

export async function wipeDurableStore(): Promise<void> {
  await Promise.all(BULKY.map((k) => durableDelete(k)));
}
