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

// ---------- Deal matching ----------

const MatchSchema = z.object({
  results: z.array(
    z.object({
      item: z.number().int(),
      matches: z.array(
        z.object({
          dealId: z.number().int(),
          confidence: z.number(),
          estCost: z.number(),
          unitPrice: z.string(),
          buy: z.string(),
        }),
      ),
    }),
  ),
});

const MATCH_PROMPT = `You match a grocery list to flyer deals. For each list item you get candidate deals from several stores ("id | store | product | price | price hint | sale text").

For each item, pick at most ONE deal per store: the cheapest deal that is a real match for the item.
- Reject wrong products. "flour" must not match cake mix, "milk" must not match chocolate milk or almond milk unless asked, "chicken thighs" must not match chicken wings or breaded nuggets, "onions" must not match onion rings.
- A deal listing several products ("carrots or yellow onions") matches if one of them is the item.
- Multi-buy prices: the hint gives the per-unit price. Points/rewards text is not a discount.
- "estCost": your best estimate in CAD of what the shopper pays at this deal to get the amount needed (they may need to buy a whole pack or several units; at per-weight prices, use the weight needed, with a sensible minimum). If the needed amount is unknown, use the cost of one typical unit.
- "unitPrice": normalized price for comparing stores, like "$8.80/kg", "$1.99/L" or "$2.50 each".
- "buy": what to put in the cart, short ("2 cans", "1 pack ~1 kg", "1 bag 3 lb").
- "confidence": 0 to 1, how sure you are this is the right product (and that the estimate is sensible).
Return every item index, with an empty matches array when nothing fits.`;

export async function matchDeals(
  items: ListItem[],
  candidates: Deal[][],
): Promise<Map<string, Match[]>> {
  const blocks: string[] = [];
  const dealIndex = new Map<number, Deal>();
  items.forEach((item, i) => {
    const deals = candidates[i];
    if (!deals.length) return;
    const need = [item.amount ?? '', item.unit, item.note ? `(${item.note})` : ''].join(' ').trim();
    const lines = deals.map((d) => {
      dealIndex.set(d.dealId, d);
      return [d.dealId, d.merchant, d.name, `$${d.currentPrice}`, priceHint(d), d.saleStory ?? ''].join(' | ');
    });
    blocks.push(`## Item ${i}: ${item.name} — need ${need || 'unspecified amount'}\n${lines.join('\n')}`);
  });

  const result = new Map<string, Match[]>(items.map((it) => [it.id, []]));
  if (!blocks.length) return result;

  const msg = await anthropic().beta.messages.parse({
    ...base,
    output_config: { effort: 'medium', format: betaZodOutputFormat(MatchSchema) },
    messages: [{ role: 'user', content: `${MATCH_PROMPT}\n\n${blocks.join('\n\n')}` }],
  });
  checkStop(msg);
  const out = msg.parsed_output;
  if (!out) throw new HttpError(502, 'Could not compare prices. Please try again.');

  for (const r of out.results) {
    const item = items[r.item];
    if (!item) continue;
    const allowed = new Set(candidates[r.item].map((d) => d.dealId));
    const byStore = new Map<string, Match>();
    for (const m of r.matches) {
      const deal = dealIndex.get(m.dealId);
      if (!deal || !allowed.has(m.dealId) || m.confidence < MIN_CONFIDENCE || !(m.estCost > 0)) continue;
      const match: Match = {
        store: deal.merchant,
        deal,
        estCost: Math.round(m.estCost * 100) / 100,
        unitPrice: m.unitPrice,
        buy: m.buy,
        confidence: m.confidence,
      };
      const prev = byStore.get(deal.merchant);
      if (!prev || match.estCost < prev.estCost) byStore.set(deal.merchant, match);
    }
    result.set(
      item.id,
      [...byStore.values()].sort((a, b) => a.estCost - b.estCost),
    );
  }
  return result;
}
