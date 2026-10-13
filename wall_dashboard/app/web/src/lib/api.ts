import { keyQuery } from './boot';

/** Bodies above this size go in pieces (reverse proxies with small body buffers answer 500 otherwise). */
const CHUNK = 6000;

async function gzip(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const cs = new CompressionStream('gzip');
    const out = new Response(new Blob([bytes]).stream().pipeThrough(cs));
    return new Uint8Array(await out.arrayBuffer());
  } catch { return null; }
}

/** Uploads a large JSON body as small chunks; returns the header value for the real request. */
async function sendChunked(json: string): Promise<string> {
  const raw = new TextEncoder().encode(json);
  const gz = await gzip(raw);
  const data = gz && gz.length < raw.length ? gz : raw, enc = data === gz ? 'gz' : 'raw';
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const n = Math.ceil(data.length / CHUNK);
  for (let i = 0; i < n; i++) {
    const r = await fetch(`api/chunk/${id}/${i}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: data.slice(i * CHUNK, (i + 1) * CHUNK) });
    if (!r.ok) throw new Error(`Błąd ${r.status} przy wysyłaniu danych (część ${i + 1}/${n})`);
  }
  return `${id}:${n}:${enc}`;
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const sep = path.includes('?') ? '&' : '?';
  const q = keyQuery();
  const url = 'api/' + path + (q ? sep + q.slice(1) : '');
  const json = body !== undefined ? JSON.stringify(body) : undefined;
  const big = !q && json !== undefined && new TextEncoder().encode(json).length > CHUNK;
  const r = await fetch(url, big
    ? { method, headers: { 'X-WD-Chunks': await sendChunked(json!) } }
    : { method, headers: json !== undefined ? { 'Content-Type': 'application/json' } : undefined, body: json });
  if (r.status === 204) return undefined as T;
  const text = await r.text();
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = undefined; }
  if (!r.ok) {
    const detail = data?.error || (text ? text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160) : r.statusText);
    throw new Error(`Błąd ${r.status}${detail ? ': ' + detail : ''}`);
  }
  if (data === undefined) throw new Error('Niepoprawna odpowiedź serwera');
  return data as T;
}

export const api = {
  get: <T>(p: string) => req<T>('GET', p),
  post: <T>(p: string, b?: unknown) => req<T>('POST', p, b ?? {}),
  put: <T>(p: string, b: unknown) => req<T>('PUT', p, b),
  del: (p: string) => req<void>('DELETE', p),
  async upload(file: File): Promise<{ url: string }> {
    const r = await fetch('api/media?name=' + encodeURIComponent(file.name), { method: 'POST', body: file });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((d as any).error || 'Nie udało się wysłać pliku');
    return d as { url: string };
  }
};

export const cameraUrl = (entity: string, bust: number) => 'api/camera/' + encodeURIComponent(entity) + keyQuery('t=' + bust);
export const longHistoryPath = (entity: string, days: number) => 'history-long/' + encodeURIComponent(entity) + '?days=' + days;
export const historyPath = (entity: string, hours: number) => 'history/' + encodeURIComponent(entity) + '?hours=' + hours;
