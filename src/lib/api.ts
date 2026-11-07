import type { GroceryList, ListItem, PricesResponse } from '../../shared/types';

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new Error('No connection. Check your internet and try again.');
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
  return body as T;
}

const post = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const extract = (images: { mediaType: string; data: string }[]) =>
  call<GroceryList>('/api/extract', post({ images }));

export const prices = (postal: string, items: ListItem[]) =>
  call<PricesResponse>('/api/prices', post({ postal, items }));

export const geocode = (lat: number, lon: number) =>
  call<{ postal: string }>(`/api/geocode?lat=${lat}&lon=${lon}`);
