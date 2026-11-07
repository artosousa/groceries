import { incr } from './store.js';

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  return (fwd?.split(',')[0] ?? req.headers.get('x-real-ip') ?? 'local').trim();
}

const envInt = (name: string, fallback: number) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const LIMITS = {
  maxImages: envInt('MAX_IMAGES', 6),
  maxImageBytes: 2_500_000, // base64 length per image
  maxItems: envInt('MAX_ITEMS', 40),
  dailyExtract: envInt('DAILY_EXTRACT_LIMIT', 15),
  dailyPrices: envInt('DAILY_PRICES_LIMIT', 15),
  dailyGeocode: envInt('DAILY_GEOCODE_LIMIT', 30),
  dealsPerQuery: envInt('DEALS_PER_QUERY', 15),
};

/** Per-IP daily cap. Throws 429 when exceeded. */
export async function rateLimit(req: Request, route: string, perDay: number) {
  const day = new Date().toISOString().slice(0, 10);
  const n = await incr(`rl:${route}:${clientIp(req)}:${day}`, 60 * 60 * 26);
  if (n > perDay) {
    throw new HttpError(429, `Daily limit reached (${perDay} per day). Try again tomorrow.`);
  }
}

/** Wrap a handler with JSON error handling. */
export function handle(fn: (req: Request) => Promise<Response>) {
  return async (req: Request) => {
    try {
      return await fn(req);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: 'Something went wrong. Please try again.' }, 500);
    }
  };
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, 'Invalid JSON body');
  }
}

/** "L9G 3L1" / "l9g" -> "L9G", or null if not a Canadian FSA. */
export function toFsa(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const m = input.trim().toUpperCase().match(/^([ABCEGHJ-NPRSTVXY]\d[A-Z])/);
  return m ? m[1] : null;
}
