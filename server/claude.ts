import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { SECTIONS, type Deal, type GroceryList, type ListItem, type Match } from '../shared/types.js';
import { priceHint } from './apify.js';
import { HttpError } from './http.js';

const MODEL = 'claude-sonnet-5-5';
const MIN_CONFIDENCE = 0.6;

let client: Anthropic | undefined;
function anthropic() {
  if (!process.env.ANTHROPIC_API_KEY) throw new HttpError(500, 'Server is missing ANTHROPIC_API_KEY');
  client ??= new Anthropic({ maxRetries: 2 });
  return client;
}

/** Shared request options: Sonnet 5.5, medium effort, server-side refusal fallback. */
const base = {
  model: MODEL,
  max_tokens: 16000,
  betas: ['server-side-fallback-2026-07-01'],
  fallbacks: 'default' as const,
};

function checkStop(msg: { stop_reason: string | null }) {
  if (msg.stop_reason === 'refusal') throw new HttpError(422, 'The request was declined. Try different photos.');
  if (msg.stop_reason === 'max_tokens') throw new HttpError(502, 'The list was too long to process. Try fewer photos.');
}

// ---------- Extraction ----------

const ExtractSchema = z.object({
  items: z.array(
    z.object({
      name: z.string(),
      searchTerm: z.string(),
      amount: z.number().nullable(),
      unit: z.string(),
      note: z.string().nullable(),
      section: z.enum(SECTIONS),
      recipes: z.array(z.string()),
    }),
  ),
  pantry: z.array(z.string()),
  flags: z.array(z.string()),
});

const EXTRACT_PROMPT = `These photos are recipes, recipe cards or ingredient lists. Build ONE combined grocery list for all of them.

Rules:
- Merge the same ingredient across recipes and add the amounts. Treat obvious variants as one item ("yellow onion" + "onion, diced"). Keep genuinely different items separate ("red onion" vs "green onions", salted vs unsalted butter).
- Convert compatible units before adding (tsp/tbsp/cup, g/kg, ml/L, oz/lb). Use buyable units and put the buying hint in "note" (e.g. amount 7, unit "", note "buy a dozen" for eggs).
- When units can't be combined, convert to a shoppable amount ("2 cloves + 1 tbsp minced garlic" -> 1 head garlic).
- Strip prep words (diced, chopped, softened, minced, room temperature) from names.
- Pantry basics (salt, pepper, cooking oil, water) go in "pantry" only, not in "items".
- Add a short entry to "flags" for any quantity you couldn't read or had to guess, naming the item.
- "name": short and capitalized, as a shopper would write it ("Chicken thighs").
- "searchTerm": the simple keyword for a grocery flyer search ("chicken thighs", "cheddar cheese", "flour"). No brands, no amounts.
- "amount": a number, or null when there is no quantity (e.g. "to taste").
- "unit": "", "lb", "kg", "g", "ml", "L", "cup", "tbsp", "can", "bunch", "head", "pack", etc.
- "section": one of ${SECTIONS.join(', ')}.
- "recipes": the recipe titles the item came from (use "Photo 1", "Photo 2" if a photo has no title).
If a photo contains no recipe or ingredients, add a flag saying so.`;

export async function extractList(images: { mediaType: string; data: string }[]): Promise<GroceryList> {
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  images.forEach((img, i) => {
    content.push({ type: 'text', text: `Photo ${i + 1}:` });
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: img.mediaType as 'image/jpeg', data: img.data },
    });
  });
  content.push({ type: 'text', text: EXTRACT_PROMPT });

  const msg = await anthropic().beta.messages.parse({
    ...base,
    output_config: { effort: 'medium', format: betaZodOutputFormat(ExtractSchema) },
    messages: [{ role: 'user', content }],
  });
  checkStop(msg);
  const out = msg.parsed_output;
  if (!out) throw new HttpError(502, 'Could not read the list. Please try again.');

  return {
    items: out.items.map((it, i) => ({ ...it, id: `i${i}-${Math.random().toString(36).slice(2, 7)}` })),
    pantry: out.pantry,
    flags: out.flags,
  };
}

// ---------- Price matching ----------

/** A real price candidate for one item: a flyer deal or a shelf product. */
export interface Candidate {
  /** Unique within one request, e.g. "F123" (flyer deal id) or "S7". */
  ref: string;
  store: string;
  source: 'flyer' | 'shelf';
  deal: Deal;
  /** Shelf only: "454 g, $0.15/100g" etc. */
  extra?: string;
  onSale: boolean;
}

const MatchSchema = z.object({
  results: z.array(
    z.object({
      item: z.number().int(),
      typicalRegularCost: z.number().nullable(),
      matches: z.array(
        z.object({
          ref: z.string(),
          confidence: z.number(),
          estCost: z.number(),
          regularCost: z.number().nullable(),
          unitPrice: z.string(),
          buy: z.string(),
        }),
      ),
    }),
  ),
});

const MATCH_PROMPT = `You price a grocery list for a shopper in Ontario, Canada. For each list item you get candidate products from several stores, one per line:
"ref | store | source | product | price | price hint | sale/was text"
source is "flyer" (this week's flyer deal) or "shelf" (the store's own website price, which may also be on sale).

For each item:
1. Pick at most ONE candidate per store: the cheapest one that is a real match for the item.
   - Reject wrong products. "flour" must not match cake mix, "milk" must not match chocolate or almond milk unless asked, "chicken thighs" must not match wings or breaded nuggets, "onions" must not match onion rings.
   - A deal listing several products ("carrots or yellow onions") matches if one of them is the item.
   - Multi-buy prices: the hint gives the per-unit price. Points/rewards text is not a discount.
   - "estCost": your best estimate in CAD of what the shopper pays at this price to get the amount needed (they may need to buy a whole pack or several units; at per-weight prices, use the weight needed, with a sensible minimum). If the amount is unknown, use the cost of one typical unit.
   - "regularCost": the same purchase at the regular (non-sale) price, ONLY when the candidate states it (a "was" / original / regular price). Otherwise null. For a shelf product that is not on sale, regularCost = estCost.
   - "unitPrice": normalized price for comparing stores, like "$8.80/kg", "$1.99/L" or "$2.50 each".
   - "buy": what to put in the cart, short ("2 cans", "1 pack ~1 kg", "1 bag 3 lb").
   - "confidence": 0 to 1, how sure you are this is the right product (and that the estimate is sensible).
2. "typicalRegularCost": your estimate in CAD of what the amount needed typically costs at regular price at a mainstream Ontario supermarket (not a sale price, not premium/organic unless asked). Use the shelf prices you were given as a guide when there are some. Null only if you truly cannot tell what the item is.
Return every item index, with an empty matches array when nothing fits.`;

export interface PricedResult {
  matches: Match[];
  estRegularCost: number | null;
}

export async function matchPrices(
  items: ListItem[],
  candidates: Candidate[][],
): Promise<Map<string, PricedResult>> {
  const blocks: string[] = [];
  const byRef = new Map<string, Candidate>();
  items.forEach((item, i) => {
    const need = [item.amount ?? '', item.unit, item.note ? `(${item.note})` : ''].join(' ').trim();
    const lines = candidates[i].map((c) => {
      byRef.set(c.ref, c);
      const d = c.deal;
      const sale = [
        c.onSale && c.source === 'shelf' ? 'ON SALE' : '',
        d.originalPrice ? `was $${d.originalPrice}` : '',
        d.saleStory ?? '',
      ]
        .filter(Boolean)
        .join(', ');
      return [c.ref, c.store, c.source, d.name, `$${d.currentPrice}`, c.extra ?? priceHint(d), sale].join(' | ');
    });
    blocks.push(
      `## Item ${i}: ${item.name} — need ${need || 'unspecified amount'}\n${lines.join('\n') || '(no candidates)'}`,
    );
  });

  const result = new Map<string, PricedResult>(items.map((it) => [it.id, { matches: [], estRegularCost: null }]));
  if (!blocks.length) return result;

  const msg = await anthropic().beta.messages.parse({
    ...base,
    max_tokens: 20000, // non-streaming calls must stay under ~21.3k (SDK limit)
    output_config: { effort: 'medium', format: betaZodOutputFormat(MatchSchema) },
    messages: [{ role: 'user', content: `${MATCH_PROMPT}\n\n${blocks.join('\n\n')}` }],
  });
  checkStop(msg);
  const out = msg.parsed_output;
  if (!out) throw new HttpError(502, 'Could not compare prices. Please try again.');

  const money = (n: number | null | undefined) => (n != null && n > 0 ? Math.round(n * 100) / 100 : null);
  for (const r of out.results) {
    const item = items[r.item];
    if (!item) continue;
    const allowed = new Set(candidates[r.item].map((c) => c.ref));
    const byStore = new Map<string, Match>();
    for (const m of r.matches) {
      const c = byRef.get(m.ref);
      const estCost = money(m.estCost);
      if (!c || !allowed.has(m.ref) || m.confidence < MIN_CONFIDENCE || !estCost) continue;
      let regularCost = money(m.regularCost);
      // A "regular" price below the sale price is noise.
      if (regularCost != null && regularCost < estCost) regularCost = c.onSale ? null : estCost;
      const match: Match = {
        store: c.store,
        deal: c.deal,
        source: c.source,
        onSale: c.onSale,
        estCost,
        regularCost: c.onSale ? regularCost : estCost,
        unitPrice: m.unitPrice,
        buy: m.buy,
        confidence: m.confidence,
      };
      const prev = byStore.get(c.store);
      if (!prev || match.estCost < prev.estCost) byStore.set(c.store, match);
    }
    result.set(item.id, {
      matches: [...byStore.values()].sort((a, b) => a.estCost - b.estCost),
      estRegularCost: money(r.typicalRegularCost),
    });
  }
  return result;
}
