import type { Deal } from '../shared/types.js';
import { HttpError, LIMITS } from './http.js';
import { getJSON, setJSON } from './store.js';

const ACTOR = 'gratifying_graph~canada-grocery-deals';
const CACHE_VERSION = 'v1';

interface RawDeal {
  dealId: number;
  query: string;
  name: string;
  merchant: string;
  currentPrice: number | null;
  originalPrice: number | null;
  priceText: string | null;
  saleStory: string | null;
  validTo: string | null;
  imageUrl: string | null;
}

const normName = (s: string) =>
  s
    .toLowerCase()
    .replace(/\b(or|and)\b|&/g, ' ')
    .replace(/[^a-z0-9]/g, '');

/** Flyers repeat the same offer under slightly different names. Keep one. */
export function dedupe(deals: Deal[]): Deal[] {
  const seen = new Set<string>();
  return deals.filter((d) => {
    const key = [d.merchant, d.currentPrice, d.validTo, normName(d.name)].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function trim(r: RawDeal): Deal | null {
  if (r.currentPrice == null || !r.name || !r.merchant) return null;
  return {
    dealId: r.dealId,
    name: r.name,
    merchant: r.merchant,
    currentPrice: r.currentPrice,
    originalPrice: r.originalPrice,
    priceText: r.priceText,
    saleStory: r.saleStory,
    validTo: r.validTo,
    imageUrl: r.imageUrl,
  };
}

const cacheKey = (fsa: string, term: string) =>
  `deals:${CACHE_VERSION}:${fsa}:${term.trim().toLowerCase()}`;

/** Cache until the earliest deal expires, capped at 24h. */
function ttlFor(deals: Deal[]): number {
  const now = Date.now();
  const day = 24 * 3600;
  const ends = deals
    .map((d) => (d.validTo ? Date.parse(d.validTo) : NaN))
    .filter((t) => Number.isFinite(t) && t > now);
  if (!ends.length) return deals.length ? day : 12 * 3600;
  return Math.min(day, (Math.min(...ends) - now) / 1000);
}

/**
 * Deals per search term for a postal prefix. Cached terms skip Apify;
 * all uncached terms go in one actor run.
 */
export async function dealsByTerm(
  fsa: string,
  terms: string[],
): Promise<{ byTerm: Map<string, Deal[]>; cached: number; fetched: number }> {
  const unique = [...new Set(terms.map((t) => t.trim().toLowerCase()).filter(Boolean))];
  const byTerm = new Map<string, Deal[]>();
  const missing: string[] = [];

  await Promise.all(
    unique.map(async (t) => {
      const hit = await getJSON<Deal[]>(cacheKey(fsa, t));
      if (hit) byTerm.set(t, hit);
      else missing.push(t);
    }),
  );

  if (missing.length) {
    const token = process.env.APIFY_TOKEN;
    if (!token) throw new HttpError(500, 'Server is missing APIFY_TOKEN');
    // The actor needs a full postal code; the flyer area is set by the FSA,
    // so pad with a placeholder LDU (tested: same deals as a real L9G code).
    const res = await fetch(
      `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?timeout=180`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          postalCode: `${fsa} 1A1`,
          queries: missing,
          locale: 'en-ca',
          maxItemsPerQuery: LIMITS.dealsPerQuery,
          onlyWithPrice: true,
        }),
      },
    );
    if (!res.ok) {
      console.error('Apify error', res.status, await res.text().catch(() => ''));
      throw new HttpError(502, 'Could not load flyer deals right now. Please try again.');
    }
    const raw = (await res.json()) as RawDeal[];
    const grouped = new Map<string, Deal[]>(missing.map((t) => [t, []]));
    for (const r of raw) {
      const d = trim(r);
      const key = r.query?.trim().toLowerCase();
      if (d && key && grouped.has(key)) grouped.get(key)!.push(d);
    }
    await Promise.all(
      [...grouped].map(async ([t, deals]) => {
        const clean = dedupe(deals);
        byTerm.set(t, clean);
        await setJSON(cacheKey(fsa, t), clean, ttlFor(clean));
      }),
    );
  }

  return { byTerm, cached: unique.length - missing.length, fetched: missing.length };
}

/**
 * Plain-language price hint for Claude, from priceText / saleStory.
 * Handles multi-buys ("2 for $5", "2/$5") and per-weight prices.
 */
export function priceHint(d: Deal): string {
  const text = `${d.priceText ?? ''} ${d.saleStory ?? ''}`;
  const multi = text.match(/(\d+)\s*(?:for|\/)\s*\$\s*(\d+(?:\.\d{1,2})?)/i);
  if (multi) {
    const n = Number(multi[1]);
    const total = Number(multi[2]);
    if (n > 1) return `multi-buy: ${n} for $${total} = $${(total / n).toFixed(2)} each`;
  }
  if (d.currentPrice && /^\s*\d+\s*for\s*$/i.test(d.priceText ?? '')) {
    const n = Number(d.priceText!.match(/\d+/)![0]);
    if (n > 1) return `multi-buy: ${n} for $${d.currentPrice} = $${(d.currentPrice / n).toFixed(2)} each`;
  }
  const pt = (d.priceText ?? '').toLowerCase();
  if (/\/\s*lb/.test(pt)) return `$${d.currentPrice}/lb = $${(d.currentPrice * 2.20462).toFixed(2)}/kg`;
  if (/\/\s*100\s*g/.test(pt)) return `$${d.currentPrice}/100g = $${(d.currentPrice * 10).toFixed(2)}/kg`;
  if (/\/\s*kg/.test(pt)) return `$${d.currentPrice}/kg`;
  return `$${d.currentPrice} each`;
}
