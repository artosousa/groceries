import { HttpError, LIMITS, handle, json, rateLimit, toFsa } from '../server/http.js';

/** Coordinates -> Canadian FSA via OpenStreetMap Nominatim. */
export const GET = handle(async (req) => {
  const url = new URL(req.url);
  const lat = Number(url.searchParams.get('lat'));
  const lon = Number(url.searchParams.get('lon'));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new HttpError(400, 'Missing coordinates.');
  await rateLimit(req, 'geocode', LIMITS.dailyGeocode);

  const q = new URL('https://nominatim.openstreetmap.org/reverse');
  q.search = new URLSearchParams({
    format: 'jsonv2',
    lat: lat.toFixed(5),
    lon: lon.toFixed(5),
    zoom: '18',
    addressdetails: '1',
  }).toString();
  const res = await fetch(q, {
    headers: { 'User-Agent': 'grocery-best-prices/1.0', 'Accept-Language': 'en-CA' },
  });
  if (!res.ok) throw new HttpError(502, 'Location lookup failed.');
  const data = (await res.json()) as { address?: { postcode?: string; country_code?: string } };
  const fsa = data.address?.country_code === 'ca' ? toFsa(data.address.postcode) : null;
  if (!fsa) throw new HttpError(404, 'No Canadian postal code found for this location.');
  return json({ postal: fsa });
});
