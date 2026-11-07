import { HttpError } from './http.js';
import { normStore } from './locations.js';
import { getJSON, setJSON } from './store.js';

/**
 * Regular shelf prices for Loblaw-owned chains (No Frills, Zehrs, Fortinos,
 * Superstore, Loblaws, ...) from their shared PC Express catalogue, via an
 * Apify actor. Other chains have no shelf data; Claude estimates those.
 */

const ACTOR = 'sunny_eternity~loblaws-grocery-scraper';
const CACHE_VERSION = 'v1';

const envNum = (name: string, fallback: number) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
/** Search terms per actor run (runs go in parallel). */
const TERMS_PER_RUN = envNum('SHELF_TERMS_PER_RUN', 5);
/** Max products kept per term; caps the dataset (and cost) of each run. */
const PER_TERM = envNum('SHELF_RESULTS_PER_TERM', 15);
/** Hard spending cap per actor run, USD. */
const MAX_USD_PER_RUN = envNum('SHELF_MAX_USD_PER_RUN', 0.08);

/** Flyer/OSM chain name -> actor banner id. */
export const BANNERS: Record<string, string> = {
  'No Frills': 'nofrills',
  Zehrs: 'zehrs',
  Fortinos: 'fortinos',
  'Real Canadian Superstore': 'superstore',
  Loblaws: 'loblaw',
  'Valu-mart': 'valumart',
  "Your Independent Grocer": 'independent',
  'Independent City Market': 'independentcitymarket',
  Provigo: 'provigo',
  Maxi: 'maxi',
  'Real Canadian Wholesale Club': 'wholesaleclub',
  'Atlantic Superstore': 'rass',
};

/** "NOFRILLS", "No Frills", "no-frills" all -> "nofrills". */
export const storeKey = (s: string) => normStore(s).replace(/ /g, '');

const BANNER_BY_KEY = new Map(Object.entries(BANNERS).map(([name, id]) => [storeKey(name), id]));
export const bannerFor = (store: string) => BANNER_BY_KEY.get(storeKey(store)) ?? null;

export interface ShelfProduct {
  name: string;
  price: number;
  wasPrice: number | null;
  onSale: boolean;
  unitPrice: string | null;
  packageSize: string | null;
  multiBuy: string | null;
  imageUrl: string | null;
}

interface RawProduct {
  name?: string;
  price?: string | number | null;
  was_price?: string | number | null;
  is_on_sale?: boolean;
  unit_price?: string | null;
  package_size?: string | null;
  multi_buy_deal?: string | null;
  image_url?: string | null;
  // Not documented, but use them if the actor ever returns them.
  search_term?: string;
  query?: string;
}

const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};

const stem = (w: string) => w.replace(/(ies)$/, 'y').replace(/(es|s)$/, '');
const words = (s: string) => normStore(s).split(' ').filter((w) => w.length > 1).map(stem);

/**
 * The actor doesn't say which search term produced a product, so attribute
 * by name: every word of the term must appear in the product name.
 */
function belongsTo(term: string, productName: string): boolean {
  const name = new Set(words(productName));
  const t = words(term);
  return t.length > 0 && t.every((w) => name.has(w));
}

function trim(r: RawProduct): ShelfProduct | null {
  const price = num(r.price);
  if (!r.name || !price) return null;
  return {
    name: r.name,
    price,
    wasPrice: num(r.was_price),
    onSale: Boolean(r.is_on_sale),
    unitPrice: r.unit_price ?? null,
    packageSize: r.package_size ?? null,
    multiBuy: r.multi_buy_deal ?? null,
    imageUrl: r.image_url ?? null,
  };
}

const cacheKey = (banner: string, fsa: string, term: string) =>
  `shelf:${CACHE_VERSION}:${banner}:${fsa}:${term.trim().toLowerCase()}`;

async function runChunk(banner: string, fsa: string, terms: string[], token: string) {
  const q = new URLSearchParams({
    timeout: '150',
    memory: '1024',
    maxItems: String(terms.length * PER_TERM),
    maxTotalChargeUsd: String(MAX_USD_PER_RUN),
  });
  const res = await fetch(`https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?${q}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      banner,
      search_terms: terms,
      // Same placeholder trick as the flyer actor: the FSA picks the area.
      postal_code: `${fsa} 1A1`,
    }),
  });
  if (!res.ok) throw new Error(`Shelf actor ${res.status}: ${await res.text().catch(() => '')}`);
  return (await res.json()) as RawProduct[];
}

/**
 * Shelf products per search term for one banner near an FSA. Cached per term
 * for 24h. Never throws: on failure the affected terms just have no data.
 */
export async function shelfByTerm(banner: string, fsa: string, terms: string[]): Promise<Map<string, ShelfProduct[]>> {
  const unique = [...new Set(terms.map((t) => t.trim().toLowerCase()).filter(Boolean))];
  const byTerm = new Map<string, ShelfProduct[]>();
  const missing: string[] = [];
  await Promise.all(
    unique.map(async (t) => {
      const hit = await getJSON<ShelfProduct[]>(cacheKey(banner, fsa, t));
      if (hit) byTerm.set(t, hit);
      else missing.push(t);
    }),
  );
  if (!missing.length) return byTerm;

  const token = process.env.APIFY_TOKEN;
  if (!token) throw new HttpError(500, 'Server is missing APIFY_TOKEN');

  const chunks: string[][] = [];
  for (let i = 0; i < missing.length; i += TERMS_PER_RUN) chunks.push(missing.slice(i, i + TERMS_PER_RUN));

  await Promise.all(
    chunks.map(async (chunk) => {
      let raw: RawProduct[];
      try {
        raw = await runChunk(banner, fsa, chunk, token);
      } catch (e) {
        console.error('Shelf prices failed', banner, chunk, e);
        return; // not cached, so the next search retries
      }
      const products = raw.map((r) => ({ r, p: trim(r) })).filter((x) => x.p);
      for (const t of chunk) {
        const own = products
          .filter(({ r, p }) => {
            const q = (r.search_term ?? r.query)?.trim().toLowerCase();
            return q ? q === t : belongsTo(t, p!.name);
          })
          .map(({ p }) => p!)
          .slice(0, PER_TERM);
        byTerm.set(t, own);
        await setJSON(cacheKey(banner, fsa, t), own, 24 * 3600);
      }
    }),
  );
  return byTerm;
}
