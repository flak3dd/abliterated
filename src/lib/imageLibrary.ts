import { bridge } from './bridgeClient';
import { uid } from './storage';

/** Workspace-relative library root (path-jailed writes only under here). */
export const IMAGE_LIBRARY_DIR = '.ablit/images';
export const IMAGE_LIBRARY_INDEX = `${IMAGE_LIBRARY_DIR}/index.json`;
/** Keep newest N entries; older ones are pruned. */
export const IMAGE_LIBRARY_MAX = 50;

export type StoredImageMeta = {
  id: string;
  prompt: string;
  size: string;
  model: string;
  createdAt: number;
  /** Relative path under workspace, e.g. `.ablit/images/img_….png` (disk) or id key (idb). */
  file: string;
  storage: 'disk' | 'idb';
};

export type SaveGeneratedImageInput = {
  prompt: string;
  size: string;
  model: string;
  b64?: string;
  url?: string;
};

const IDB_NAME = 'ablit_image_library';
const IDB_STORE = 'images';
const IDB_VERSION = 1;

type IdbRecord = {
  meta: StoredImageMeta;
  /** PNG bytes as base64 (no data: prefix). */
  b64: string;
};

function assertLibraryPath(rel: string): string {
  const cleaned = rel.replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/^\/+/, '');
  if (cleaned.includes('..')) throw new Error('path jail: .. not allowed');
  if (cleaned !== IMAGE_LIBRARY_DIR && !cleaned.startsWith(`${IMAGE_LIBRARY_DIR}/`)) {
    throw new Error(`path jail: only ${IMAGE_LIBRARY_DIR}/`);
  }
  return cleaned;
}

function metaPathFor(id: string): string {
  return assertLibraryPath(`${IMAGE_LIBRARY_DIR}/${id}.json`);
}

function pngPathFor(id: string): string {
  return assertLibraryPath(`${IMAGE_LIBRARY_DIR}/${id}.png`);
}

async function b64FromInput(input: SaveGeneratedImageInput): Promise<string> {
  if (input.b64 && input.b64.trim()) {
    let s = input.b64.trim();
    const m = /^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/s.exec(s);
    if (m) s = m[1];
    return s.replace(/\s+/g, '');
  }
  if (input.url && input.url.trim()) {
    const url = input.url.trim();
    if (url.startsWith('data:image/')) {
      const m = /^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/s.exec(url);
      if (m) return m[1].replace(/\s+/g, '');
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to download image URL (HTTP ${res.status})`);
    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  }
  throw new Error('No image data to save');
}

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: 'meta.id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
}

async function idbPut(record: IdbRecord): Promise<void> {
  const db = await openIdb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('idb put failed'));
      tx.objectStore(IDB_STORE).put(record);
    });
  } finally {
    db.close();
  }
}

async function idbGetAll(): Promise<IdbRecord[]> {
  const db = await openIdb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).getAll();
      req.onsuccess = () => resolve((req.result || []) as IdbRecord[]);
      req.onerror = () => reject(req.error || new Error('idb getAll failed'));
    });
  } finally {
    db.close();
  }
}

async function idbGet(id: string): Promise<IdbRecord | null> {
  const db = await openIdb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(id);
      req.onsuccess = () => resolve((req.result as IdbRecord | undefined) || null);
      req.onerror = () => reject(req.error || new Error('idb get failed'));
    });
  } finally {
    db.close();
  }
}

async function idbDelete(id: string): Promise<void> {
  const db = await openIdb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('idb delete failed'));
      tx.objectStore(IDB_STORE).delete(id);
    });
  } finally {
    db.close();
  }
}

async function readDiskIndex(): Promise<StoredImageMeta[]> {
  try {
    const raw = await bridge.readFile(assertLibraryPath(IMAGE_LIBRARY_INDEX));
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x): x is StoredImageMeta => !!x && typeof x === 'object' && typeof (x as StoredImageMeta).id === 'string')
      .map((x) => ({ ...x, storage: 'disk' as const }));
  } catch {
    return [];
  }
}

async function writeDiskIndex(entries: StoredImageMeta[]): Promise<void> {
  const path = assertLibraryPath(IMAGE_LIBRARY_INDEX);
  const body = JSON.stringify(entries, null, 2);
  const ok = await bridge.writeFile(path, body, { encoding: 'utf8', eol: '\n' });
  if (!ok) throw new Error('Failed to write image library index');
}

async function pruneDisk(entries: StoredImageMeta[]): Promise<StoredImageMeta[]> {
  if (entries.length <= IMAGE_LIBRARY_MAX) return entries;
  const keep = entries.slice(0, IMAGE_LIBRARY_MAX);
  const drop = entries.slice(IMAGE_LIBRARY_MAX);
  for (const e of drop) {
    try {
      await bridge.deleteFile(assertLibraryPath(e.file));
    } catch {
      /* ignore */
    }
    try {
      await bridge.deleteFile(metaPathFor(e.id));
    } catch {
      /* ignore */
    }
  }
  return keep;
}

async function pruneIdb(records: IdbRecord[]): Promise<IdbRecord[]> {
  const sorted = [...records].sort((a, b) => b.meta.createdAt - a.meta.createdAt);
  if (sorted.length <= IMAGE_LIBRARY_MAX) return sorted;
  const keep = sorted.slice(0, IMAGE_LIBRARY_MAX);
  for (const r of sorted.slice(IMAGE_LIBRARY_MAX)) {
    await idbDelete(r.meta.id);
  }
  return keep;
}

async function saveToDisk(meta: StoredImageMeta, b64: string): Promise<StoredImageMeta> {
  const png = pngPathFor(meta.id);
  const side = metaPathFor(meta.id);
  const diskMeta: StoredImageMeta = { ...meta, file: png, storage: 'disk' };
  const wrotePng = await bridge.writeFile(png, b64, { encoding: 'base64' });
  if (!wrotePng) throw new Error('Failed to write PNG via bridge');
  const wroteMeta = await bridge.writeFile(side, JSON.stringify(diskMeta, null, 2), {
    encoding: 'utf8',
    eol: '\n',
  });
  if (!wroteMeta) throw new Error('Failed to write image sidecar');
  let index = await readDiskIndex();
  index = [diskMeta, ...index.filter((e) => e.id !== diskMeta.id)];
  index.sort((a, b) => b.createdAt - a.createdAt);
  index = await pruneDisk(index);
  await writeDiskIndex(index);
  return diskMeta;
}

async function saveToIdb(meta: StoredImageMeta, b64: string): Promise<StoredImageMeta> {
  const idbMeta: StoredImageMeta = { ...meta, file: meta.id, storage: 'idb' };
  await idbPut({ meta: idbMeta, b64 });
  const all = await idbGetAll();
  await pruneIdb(all);
  return idbMeta;
}

/**
 * Persist a generated image. Prefers workspace `.ablit/images/` when bridge is connected;
 * falls back to IndexedDB (blob + metadata) when disconnected.
 */
export async function saveGeneratedImage(input: SaveGeneratedImageInput): Promise<StoredImageMeta> {
  const b64 = await b64FromInput(input);
  const id = uid('img');
  const meta: StoredImageMeta = {
    id,
    prompt: input.prompt.slice(0, 2000),
    size: input.size || '1024x1024',
    model: (input.model || '').slice(0, 200),
    createdAt: Date.now(),
    file: pngPathFor(id),
    storage: 'disk',
  };
  // Never persist tokens — model/prompt/size/createdAt/file only.
  if (bridge.connected) {
    try {
      return await saveToDisk(meta, b64);
    } catch (err) {
      console.warn('disk image save failed, falling back to IndexedDB', err);
      return saveToIdb(meta, b64);
    }
  }
  return saveToIdb(meta, b64);
}

/** List library entries, newest first. */
export async function listLibraryImages(): Promise<StoredImageMeta[]> {
  if (bridge.connected) {
    try {
      const disk = await readDiskIndex();
      if (disk.length) return disk;
    } catch {
      /* fall through */
    }
  }
  const records = await idbGetAll();
  return records
    .map((r) => ({ ...r.meta, storage: 'idb' as const }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** Return a `data:image/png;base64,…` URL for preview/download. */
export async function getLibraryImageDataUrl(entry: StoredImageMeta): Promise<string | null> {
  if (entry.storage === 'disk' && bridge.connected) {
    try {
      const b64 = await bridge.readFile(assertLibraryPath(entry.file), { encoding: 'base64' });
      if (b64) return `data:image/png;base64,${b64}`;
    } catch {
      /* try idb fallback below */
    }
  }
  const rec = await idbGet(entry.id);
  if (rec?.b64) return `data:image/png;base64,${rec.b64}`;
  return null;
}

export async function deleteLibraryImage(entry: StoredImageMeta): Promise<void> {
  if (entry.storage === 'disk' && bridge.connected) {
    try {
      await bridge.deleteFile(assertLibraryPath(entry.file));
    } catch {
      /* ignore missing png */
    }
    try {
      await bridge.deleteFile(metaPathFor(entry.id));
    } catch {
      /* ignore */
    }
    let index = await readDiskIndex();
    index = index.filter((e) => e.id !== entry.id);
    await writeDiskIndex(index);
    return;
  }
  await idbDelete(entry.id);
}

/** Asymptotic estimate toward ~95% based on elapsed time (no server stream). */
export function estimateImageProgress(elapsedMs: number, expectedMs = 45000): number {
  const tau = Math.max(8000, expectedMs * 0.45);
  const p = 95 * (1 - Math.exp(-elapsedMs / tau));
  return Math.min(95, Math.max(0, Math.round(p)));
}
