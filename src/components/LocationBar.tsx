import { useEffect, useRef, useState } from 'react';
import { geocode } from '../lib/api';
import { toFsa } from '../lib/storage';

interface Props {
  postal: string | null;
  onChange: (fsa: string) => void;
}

type Status = 'idle' | 'locating' | 'editing';

export function LocationBar({ postal, onChange }: Props) {
  const [status, setStatus] = useState<Status>(postal ? 'idle' : 'locating');
  const [draft, setDraft] = useState(postal ?? '');
  const [error, setError] = useState<string | null>(null);
  const tried = useRef(false);

  useEffect(() => {
    if (postal || tried.current) return;
    tried.current = true;
    if (!('geolocation' in navigator)) return setStatus('editing');
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        try {
          const { postal: fsa } = await geocode(coords.latitude, coords.longitude);
          onChange(fsa);
          setStatus('idle');
        } catch (e) {
          setError((e as Error).message);
          setStatus('editing');
        }
      },
      () => setStatus('editing'),
      { timeout: 10000, maximumAge: 3600_000 },
    );
  }, [postal, onChange]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const fsa = toFsa(draft);
    if (!fsa) return setError('Enter a Canadian postal code, like L9G 3L1.');
    setError(null);
    onChange(fsa);
    setStatus('idle');
  };

  if (status === 'locating') {
    return <p className="text-sm text-stone-500">📍 Finding your area…</p>;
  }

  if (status === 'editing' || !postal) {
    return (
      <form onSubmit={submit} className="space-y-1">
        <label htmlFor="postal" className="block text-sm font-medium text-stone-700">
          Your postal code (for local flyers)
        </label>
        <div className="flex gap-2">
          <input
            id="postal"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="L9G 3L1"
            autoComplete="postal-code"
            autoCapitalize="characters"
            className="w-32 rounded-lg border border-stone-300 bg-white px-3 py-2 text-base uppercase focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/30"
          />
          <button className="rounded-lg bg-emerald-600 px-4 py-2 font-medium text-white active:bg-emerald-700">
            Save
          </button>
          {postal && (
            <button type="button" onClick={() => setStatus('idle')} className="px-2 text-sm text-stone-500">
              Cancel
            </button>
          )}
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>
    );
  }

  return (
    <p className="text-sm text-stone-600">
      📍 Flyers near <span className="font-semibold text-stone-900">{postal}</span>{' '}
      <button
        onClick={() => {
          setDraft(postal);
          setStatus('editing');
        }}
        className="ml-1 font-medium text-emerald-700 underline underline-offset-2"
      >
        Change
      </button>
    </p>
  );
}
