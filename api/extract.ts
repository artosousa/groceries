import type { ExtractRequest } from '../shared/types.js';
import { extractList } from '../server/claude.js';
import { HttpError, LIMITS, handle, json, rateLimit, readJson } from '../server/http.js';

const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export const POST = handle(async (req) => {
  const body = await readJson<ExtractRequest>(req);
  const images = Array.isArray(body.images) ? body.images : [];
  if (!images.length) throw new HttpError(400, 'Add at least one photo.');
  if (images.length > LIMITS.maxImages) throw new HttpError(400, `Up to ${LIMITS.maxImages} photos at a time.`);
  for (const img of images) {
    if (!TYPES.has(img?.mediaType) || typeof img.data !== 'string') throw new HttpError(400, 'Unsupported image.');
    if (img.data.length > LIMITS.maxImageBytes) throw new HttpError(413, 'A photo is too large.');
  }
  await rateLimit(req, 'extract', LIMITS.dailyExtract);
  return json(await extractList(images));
});
