import type { StoreLocation } from '../shared/types.js';
import { getJSON, setJSON } from './store.js';

/**
 * Where the flyer stores actually are. Flipp flyers cover a wide area, so a
 * chain can show up with no location in the shopper's city. We use
 * OpenStreetMap (free, no key) to find each chain's nearest location inside
 * the shopper's municipality, and drop chains that have none.
 */

const UA = 'grocery-best-prices/1.0';
const VERSION = 'v1';
const WEEK = 7 * 24 * 3600;
const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

interface City {
  id: number | null;
  name: string | null;
  lat: number;
  lon: number;
}

export interface LocalStores {
  city: string | null;
  /** merchant -> nearest in-city location; merchants missing here have none. */
  stores: Record<string, StoreLocation>;
}

/** "Longo's" -> "longos", "M&M Food Market" -> "m m food market". */
export const normStore = (s: string) =>
  s
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

function storeMatches(merchant: string, tag: string | undefined): boolean {
  if (!tag) return false;
  const m = normStore(merchant);
  const t = normStore(tag);
  if (!m || !t) return false;
  // "Food Basics & Pharmacy" is a Food Basics; "Walmart Supercentre" (flyer) is a Walmart.
  return t === m || t.startsWith(`${m} `) || (t.length >= 4 && m.startsWith(`${t} `));
}

/** Public Overpass servers are often slow or 502: race the mirrors, keep the first good answer. */
async function overpass<T>(query: string): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45_000);
  try {
    return await Promise.any(
      OVERPASS.map(async (url) => {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ data: query }),
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(`Overpass ${res.status} from ${url}`);
        return (await res.json()) as T;
      }),
    );
  } finally {
    clearTimeout(timer);
    ctrl.abort();
  }
}

const toRad = (d: number) => (d * Math.PI) / 180;
function km(aLat: number, aLon: number, bLat: number, bLon: number) {
  const h =
    Math.sin(toRad(bLat - aLat) / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(toRad(bLon - aLon) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

/** FSA -> centre point and the municipality it sits in. */
async function cityFor(fsa: string): Promise<City | null> {
  const key = `city:${VERSION}:${fsa}`;
  const hit = await getJSON<City>(key);
  if (hit) return hit;

  const res = await fetch(`https://api.zippopotam.us/ca/${fsa}`, { headers: { 'User-Agent': UA } });
  if (!res.ok) return null;
  const data = (await res.json()) as { places?: { latitude: string; longitude: string }[] };
  const p = data.places?.[0];
  if (!p) return null;
  const lat = Number(p.latitude);
  const lon = Number(p.longitude);

  // Most specific municipal boundary around the point (Ontario: 6 = single-tier
  // city like Hamilton or a region, 8 = lower-tier like Burlington).
  const areas = await overpass<{ elements: { id: number; tags: Record<string, string> }[] }>(
    `[out:json][timeout:25];is_in(${lat},${lon})->.a;area.a[boundary=administrative][admin_level~"^[5-8]$"];out tags;`,
  );
  const best = areas.elements
    .filter((e) => e.tags.name)
    .sort((a, b) => Number(b.tags.admin_level) - Number(a.tags.admin_level))[0];
  const city: City = { id: best?.id ?? null, name: best?.tags.name ?? null, lat, lon };
  await setJSON(key, city, 30 * 24 * 3600);
  return city;
}

interface OsmEl {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags: Record<string, string>;
}

/** Street address for a point via Photon (OSM), used when the shop has no addr tags. */
async function reverseAddress(lat: number, lon: number): Promise<string | null> {
  try {
    const res = await fetch(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lon}&limit=1`, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { features?: { properties: Record<string, string> }[] };
    const p = data.features?.[0]?.properties;
    if (!p?.street) return null;
    return [[p.housenumber, p.street].filter(Boolean).join(' '), p.city].filter(Boolean).join(', ');
  } catch {
    return null;
  }
}

/** Compact shop record, cached per city. */
interface Shop {
  id: string;
  brand?: string;
  name?: string;
  lat: number;
  lon: number;
  /** From OSM addr:* tags, if present. */
  address?: string;
}

const SHOP_TYPES =
  'supermarket|greengrocer|butcher|convenience|deli|wholesale|department_store|chemist|variety_store|frozen_food|health_food|farm|seafood|general';

/** Every branded shop/pharmacy (Shoppers is amenity=pharmacy) and food shop in the city (one Overpass query, cached a week). */
async function cityShops(city: City): Promise<Shop[]> {
  const key = `shops:${VERSION}:${city.id ?? `${city.lat.toFixed(2)},${city.lon.toFixed(2)}`}`;
  const hit = await getJSON<Shop[]>(key);
  if (hit) return hit;

  const scope = city.id ? '(area.c)' : `(around:15000,${city.lat},${city.lon})`;
  const { elements } = await overpass<{ elements: OsmEl[] }>(
    `[out:json][timeout:60];${city.id ? `area(${city.id})->.c;` : ''}` +
      `(nwr[shop][brand]${scope};nwr[amenity=pharmacy][brand]${scope};nwr[shop~"^(${SHOP_TYPES})$"][name]${scope};);out center tags;`,
  );
  const shops: Shop[] = [];
  for (const el of elements) {
    const t = el.tags;
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (lat == null || lon == null || (!t.brand && !t.name)) continue;
    const street = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ');
    shops.push({
      id: `${el.type[0]}${el.id}`,
      brand: t.brand,
      name: t.name,
      lat: +lat.toFixed(5),
      lon: +lon.toFixed(5),
      address: t['addr:street'] ? [street, t['addr:city'] ?? city.name].filter(Boolean).join(', ') : undefined,
    });
  }
  await setJSON(key, shops, WEEK);
  return shops;
}

async function addressFor(shop: Shop, city: City): Promise<string> {
  if (shop.address) return shop.address;
  const key = `addr:${VERSION}:${shop.id}`;
  const hit = await getJSON<string>(key);
  if (hit) return hit;
  const addr = await reverseAddress(shop.lat, shop.lon);
  if (addr) await setJSON(key, addr, 30 * 24 * 3600);
  return addr ?? city.name ?? '';
}

/**
 * Nearest in-city location for each flyer merchant. Returns null when the
 * lookup itself fails, so the caller can still show (unfiltered) deals.
 */
export async function localStores(fsa: string, merchants: string[]): Promise<LocalStores | null> {
  try {
    const city = await cityFor(fsa);
    if (!city) return null;
    const shops = await cityShops(city);
    const stores: Record<string, StoreLocation> = {};
    await Promise.all(
      merchants.map(async (merchant) => {
        let best: { shop: Shop; d: number } | undefined;
        for (const shop of shops) {
          if (!storeMatches(merchant, shop.brand) && !storeMatches(merchant, shop.name)) continue;
          const d = km(city.lat, city.lon, shop.lat, shop.lon);
          if (!best || d < best.d) best = { shop, d };
        }
        if (!best) return;
        stores[merchant] = {
          name: best.shop.name ?? merchant,
          address: await addressFor(best.shop, city),
          lat: best.shop.lat,
          lon: best.shop.lon,
          distanceKm: Math.round(best.d * 10) / 10,
        };
      }),
    );
    return { city: city.name, stores };
  } catch (e) {
    console.error('Store location lookup failed', e);
    return null;
  }
}
