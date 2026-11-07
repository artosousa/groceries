import type { PricesRequest, PricesResponse } from '../shared/types.js';
import { dealsByTerm } from '../server/apify.js';
import { matchDeals } from '../server/claude.js';
import { HttpError, LIMITS, handle, json, rateLimit, readJson, toFsa } from '../server/http.js';

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

  const { byTerm, cached, fetched } = await dealsByTerm(fsa, items.map((it) => it.searchTerm));
  const now = Date.now();
  const candidates = items.map((it) =>
    (byTerm.get(it.searchTerm.trim().toLowerCase()) ?? []).filter(
      (d) => !d.validTo || Date.parse(d.validTo) > now,
    ),
  );
  const matches = await matchDeals(items, candidates);

  const res: PricesResponse = {
    postal: fsa,
    priced: items.map((it) => ({ itemId: it.id, matches: matches.get(it.id) ?? [] })),
    cachedTerms: cached,
    fetchedTerms: fetched,
  };
  return json(res);
});
