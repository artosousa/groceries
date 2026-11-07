import { useCallback, useEffect, useState } from 'react';
import type { GroceryList, PricesResponse } from '../shared/types';
import { LocationBar } from './components/LocationBar';
import { ResultsStep } from './components/ResultsStep';
import { ReviewStep } from './components/ReviewStep';
import { UploadStep } from './components/UploadStep';
import * as api from './lib/api';
import type { PreparedImage } from './lib/images';
import { load, save } from './lib/storage';

export default function App() {
  const [postal, setPostal] = useState<string | null>(() => load('postal', null));
  const [images, setImages] = useState<PreparedImage[]>([]);
  const [list, setList] = useState<GroceryList | null>(() => load('list', null));
  const [prices, setPrices] = useState<PricesResponse | null>(() => load('prices', null));
  const [maxStores, setMaxStores] = useState<number>(() => load('maxStores', 2));
  const [excluded, setExcluded] = useState<string[]>(() => load('excludedStores', []));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => save('postal', postal), [postal]);
  useEffect(() => save('list', list), [list]);
  useEffect(() => save('prices', prices), [prices]);
  useEffect(() => save('maxStores', maxStores), [maxStores]);
  useEffect(() => save('excludedStores', excluded), [excluded]);

  const changePostal = useCallback(
    (fsa: string) => {
      if (fsa !== postal) setPrices(null);
      setPostal(fsa);
    },
    [postal],
  );

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try {
      await fn();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const build = () =>
    run(async () => {
      const result = await api.extract(images.map(({ mediaType, data }) => ({ mediaType, data })));
      setList(result);
      setPrices(null);
      images.forEach((i) => URL.revokeObjectURL(i.preview));
      setImages([]);
    });

  const findPrices = () =>
    run(async () => {
      if (!list || !postal) return;
      const items = list.items.filter((it) => it.name.trim());
      setPrices(await api.prices(postal, items));
    });

  const startOver = () => {
    if (list && !confirm('Start a new list? This clears the current one.')) return;
    setList(null);
    setPrices(null);
    setError(null);
  };

  return (
    <div className="min-h-dvh bg-stone-50 text-stone-900">
      <div className="mx-auto max-w-xl space-y-5 px-4 pb-10 pt-[max(1rem,env(safe-area-inset-top))]">
        <header className="space-y-2">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold">🛒 Grocery Deals</h1>
            {list && (
              <button onClick={startOver} className="text-sm font-medium text-stone-500 underline underline-offset-2">
                New list
              </button>
            )}
          </div>
          <LocationBar postal={postal} onChange={changePostal} />
        </header>

        {error && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {!list && <UploadStep images={images} setImages={setImages} busy={busy} onBuild={build} />}

        {list && !prices && (
          <ReviewStep list={list} setList={setList} busy={busy} canPrice={Boolean(postal)} onPrice={findPrices} />
        )}

        {list && prices && (
          <>
            <button onClick={() => setPrices(null)} className="text-sm font-medium text-emerald-700">
              ← Edit list
            </button>
            <ResultsStep
              list={list}
              prices={prices}
              maxStores={maxStores}
              setMaxStores={setMaxStores}
              excluded={excluded}
              setExcluded={setExcluded}
            />
          </>
        )}
      </div>
    </div>
  );
}
