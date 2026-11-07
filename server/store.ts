/**
 * Tiny KV used for rate limits and flyer caching.
 * Upstash Redis (REST) when configured, otherwise an in-memory Map
 * (per serverless instance — fine for local dev, weak in production).
 */

const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;

export const hasRedis = Boolean(url && token);

async function redis<T>(command: (string | number)[]): Promise<T> {
  const res = await fetch(url!, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  if (!res.ok) throw new Error(`Redis ${command[0]} failed: ${res.status}`);
  const body = (await res.json()) as { result: T };
  return body.result;
}

const mem = new Map<string, { value: string; expires: number }>();
function memGet(key: string) {
  const hit = mem.get(key);
  if (!hit) return null;
  if (hit.expires < Date.now()) {
    mem.delete(key);
    return null;
  }
  return hit.value;
}

export async function getJSON<T>(key: string): Promise<T | null> {
  try {
    const raw = hasRedis ? await redis<string | null>(['GET', key]) : memGet(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch (e) {
    console.warn('cache get failed', e);
    return null;
  }
}

export async function setJSON(key: string, value: unknown, ttlSeconds: number) {
  const raw = JSON.stringify(value);
  const ttl = Math.max(60, Math.floor(ttlSeconds));
  try {
    if (hasRedis) await redis(['SET', key, raw, 'EX', ttl]);
    else mem.set(key, { value: raw, expires: Date.now() + ttl * 1000 });
  } catch (e) {
    console.warn('cache set failed', e);
  }
}

/** Increment a counter, setting its TTL on first use. Returns the new count. */
export async function incr(key: string, ttlSeconds: number): Promise<number> {
  if (hasRedis) {
    const n = await redis<number>(['INCR', key]);
    if (n === 1) await redis(['EXPIRE', key, ttlSeconds]);
    return n;
  }
  const n = Number(memGet(key) ?? 0) + 1;
  const prev = mem.get(key);
  mem.set(key, { value: String(n), expires: prev?.expires ?? Date.now() + ttlSeconds * 1000 });
  return n;
}
