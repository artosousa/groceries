import type { Deal, PricesRequest, PricesResponse, StoreLocation } from '../shared/types.js';
import { dealsByTerm } from '../server/apify.js';
import { matchPrices, type Candidate } from '../server/claude.js';
import { HttpError, LIMITS, handle, json, rateLimit, readJson, toFsa } from '../server/http.js';
import { localStores } from '../server/locations.js';
import { BANNERS, shelfByTerm, storeKey, type ShelfProduct } from '../server/shelf.js';

const SHELF_PER_ITEM = 10;

/** Regular prices for the Loblaw chains that have a location in the shopper's city. */
async function shelfPrices(fsa: string, terms: string[]) {
  const local = await localStores(fsa, Object.keys(BANNERS));
  if (!local) return [];
  return Promise.all(
    Object.entries(local.stores).map(async ([store, loc]) => ({
      store,
      loc,
      byTerm: await shelfByTerm(BANNERS[store], fsa, terms).catch((e) => {
        console.error('Shelf prices failed', store, e);
        return new Map<string, ShelfProduct[]>();
      }),
    })),
  );
}

export const POST = handle(async (req) => {
  const body = await readJson<PricesRequest>(req);
  const fsa = toFsa(body.postal);
  if (!fsa) throw new HttpError(400, 'Enter a valid Canadian postal code.');
  const items = (Array.isArray(body.items) ? body.items : []).filter(
    (it) => it && typeof it.id === 'string' && typeof it.name === 'string',
  );
  if (!items.length) throw new HttpError(400, 'The list is empty.');
  if (items.length > LIMITS.maxItems) throw new HttpError(400, `Up to ${LIMITS.maxItems} items at a time.`);
  for (const it of items) it.searchTerm = String(it.searchTerm || it.name).slice(0, 60);

  await rateLimit(req, 'prices', LIMITS.dailyPrices);

  const terms = items.map((it) => it.searchTerm);
  const [{ byTerm, cached, fetched }, shelf] = await Promise.all([dealsByTerm(fsa, terms), shelfPrices(fsa, terms)]);

  const now = Date.now();
  const live = items.map((it) =>
    (byTerm.get(it.searchTerm.trim().toLowerCase()) ?? []).filter((d) => !d.validTo || Date.parse(d.validTo) > now),
  );
  // Flyers cover a wide area: keep only chains with a location in the shopper's city.
  const local = await localStores(fsa, [...new Set(live.flat().map((d) => d.merchant))]);
  const stores: Record<string, StoreLocation> = { ...local?.stores };

  // Call a chain by its flyer name when it has one ("NOFRILLS" vs "No Frills").
  const flyerName = new Map(Object.keys(stores).map((m) => [storeKey(m), m]));
  let nextShelfId = -1;
  const shelfCandidates = items.map(() => [] as Candidate[]);
  for (const { store: canonical, loc, byTerm: products } of shelf) {
    const store = flyerName.get(storeKey(canonical)) ?? canonical;
    stores[store] ??= loc;
    items.forEach((it, i) => {
      for (const p of (products.get(it.searchTerm.trim().toLowerCase()) ?? []).slice(0, SHELF_PER_ITEM)) {
        const dealId = nextShelfId--;
        const deal: Deal = {
          dealId,
          name: p.name,
          merchant: store,
          currentPrice: p.price,
          originalPrice: p.onSale ? p.wasPrice : null,
          priceText: null,
          saleStory: p.multiBuy,
          validTo: null,
          imageUrl: p.imageUrl,
        };
        shelfCandidates[i].push({
          ref: `S${-dealId}`,
          store,
          source: 'shelf',
          deal,
          extra: p.unitPrice ?? p.packageSize ?? undefined,
          onSale: p.onSale,
        });
      }
    });
  }

  const candidates: Candidate[][] = items.map((_, i) => [
    ...live[i]
      .filter((d) => !local || d.merchant in local.stores)
      .map((d): Candidate => ({ ref: `F${d.dealId}`, store: d.merchant, source: 'flyer', deal: d, onSale: true })),
    ...shelfCandidates[i],
  ]);
  const results = await matchPrices(items, candidates);

  const res: PricesResponse = {
    postal: fsa,
    city: local?.city ?? null,
    stores,
    storesChecked: Boolean(local),
    priced: items.map((it) => ({
      itemId: it.id,
      matches: results.get(it.id)?.matches ?? [],
      estRegularCost: results.get(it.id)?.estRegularCost ?? null,
    })),
    cachedTerms: cached,
    fetchedTerms: fetched,
  };
  return json(res);
});
