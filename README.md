# Grocery Deals

Recipe photos → one merged grocery list → best flyer prices near you → iPhone Reminders.

Vite + React + TypeScript + Tailwind v4 SPA, with Vercel functions in `api/`.

## Layout

| Path | What |
|---|---|
| `api/extract.ts` | `POST` images → merged list (Claude Sonnet 5.5, vision, structured output) |
| `api/prices.ts` | `POST` list + postal → flyer deals (Apify/Flipp) → Claude matching → per-item matches |
| `api/geocode.ts` | `GET ?lat&lon` → FSA (OpenStreetMap Nominatim) |
| `server/` | Claude prompts, Apify client + cache, store locations (OpenStreetMap), KV (Upstash or in-memory), rate limits |
| `shared/` | Types and the store-plan optimizer (runs client-side so "max stores" is instant and free) |
| `src/` | UI |

## Setup

```bash
cp .env.example .env   # fill ANTHROPIC_API_KEY, APIFY_TOKEN
npm install
npm run dev            # Vite serves api/*.ts too, via a small dev middleware
```

Deploy: import into Vercel, set the same env vars. Add Upstash Redis (Vercel Marketplace) so rate limits and the flyer cache persist across function instances; without it they're in-memory per instance.

## Notes

- **Postal code**: only the FSA (`L9G`) is stored. The Apify actor requires a full code, so the server sends `L9G 1A1`; tested to return the same deals as a real L9G code.
- **Cost**: Apify is ~$0.002/deal + $0.0005/run. With `DEALS_PER_QUERY=15`, a 25-item list can cost up to ~$0.75 uncached. Flyer results are cached per FSA + search term until the earliest deal ends (max 24h).
- **Limits** (env-tunable): 6 photos, 40 items, 15 extract + 15 price runs per IP per day.
- **Store locations**: flyers cover a wide area, so `server/locations.ts` finds the shopper's municipality (FSA centre via zippopotam.us → OSM admin boundary) and loads every branded shop in it from Overpass (cached a week per city). Chains with no location in the city are dropped before matching; the rest get their nearest address (Photon reverse-geocode when OSM has no `addr:*`). If the lookup fails, deals are shown unfiltered with a warning. Public Overpass servers can take 20–60s, so the mirrors are raced.
- **Store toggles**: shoppers can turn stores off on the results page; this is client-side (saved in localStorage) and re-runs the plan instantly.
- **Plan ranking**: plans are compared on the whole list; items a plan has no deal for are counted at the highest flyer price found for them (no shelf prices until v2).
- **Reminders**: opens `shortcuts://run-shortcut?name=Add%20to%20Groceries&input=text&text=…`, one `Store (street) · Item – amount` line per item, ordered by store, then category.
