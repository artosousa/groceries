/** localStorage wrappers that never throw (private mode, blocked storage). */
export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export const FSA_RE = /^[ABCEGHJ-NPRSTVXY]\d[A-Z]/;
export const toFsa = (s: string) => s.trim().toUpperCase().replace(/\s+/g, '').match(FSA_RE)?.[0] ?? null;
