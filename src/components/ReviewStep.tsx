import { SECTIONS, type GroceryList, type ListItem } from '../../shared/types';

interface Props {
  list: GroceryList;
  setList: (list: GroceryList) => void;
  busy: boolean;
  canPrice: boolean;
  onPrice: () => void;
}

const input =
  'rounded-md border border-stone-200 bg-white px-2 py-1.5 text-base focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/30';

export function ReviewStep({ list, setList, busy, canPrice, onPrice }: Props) {
  const update = (id: string, patch: Partial<ListItem>) =>
    setList({ ...list, items: list.items.map((it) => (it.id === id ? { ...it, ...patch } : it)) });
  const remove = (id: string) => setList({ ...list, items: list.items.filter((it) => it.id !== id) });
  const add = () =>
    setList({
      ...list,
      items: [
        ...list.items,
        {
          id: crypto.randomUUID(),
          name: '',
          searchTerm: '',
          amount: null,
          unit: '',
          note: null,
          section: 'Other',
          recipes: [],
        },
      ],
    });

  const valid = list.items.filter((it) => it.name.trim());

  return (
    <section className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">2. Check your list</h2>
        <span className="text-sm text-stone-500">{valid.length} items</span>
      </div>

      {list.flags.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-semibold">Double-check:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {list.flags.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </div>
      )}

      {SECTIONS.map((section) => {
        const items = list.items.filter((it) => it.section === section);
        if (!items.length) return null;
        return (
          <div key={section}>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-stone-500">{section}</h3>
            <ul className="divide-y divide-stone-100 rounded-xl bg-white shadow-sm ring-1 ring-stone-200">
              {items.map((it) => (
                <li key={it.id} className="px-2 py-2">
                  <div className="flex items-center gap-2">
                  <input
                    aria-label="Item"
                    value={it.name}
                    placeholder="Item"
                    onChange={(e) => update(it.id, { name: e.target.value, searchTerm: e.target.value.toLowerCase() })}
                    className={`${input} min-w-0 flex-1`}
                  />
                  <input
                    aria-label="Amount"
                    inputMode="decimal"
                    value={it.amount ?? ''}
                    placeholder="#"
                    onChange={(e) => {
                      const v = e.target.value.replace(',', '.');
                      update(it.id, { amount: v === '' || isNaN(Number(v)) ? null : Number(v) });
                    }}
                    className={`${input} w-14 text-right`}
                  />
                  <input
                    aria-label="Unit"
                    value={it.unit}
                    placeholder="unit"
                    onChange={(e) => update(it.id, { unit: e.target.value })}
                    className={`${input} w-16`}
                  />
                  <button
                    onClick={() => remove(it.id)}
                    aria-label={`Remove ${it.name || 'item'}`}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xl text-stone-400 active:bg-stone-100"
                  >
                    ×
                  </button>
                  </div>
                  {it.note && <p className="mt-0.5 pl-1 text-xs text-stone-500">{it.note}</p>}
                </li>
              ))}
            </ul>
          </div>
        );
      })}

      <button onClick={add} className="w-full rounded-xl border border-stone-300 py-2.5 font-medium text-stone-700 active:bg-stone-100">
        + Add item
      </button>

      {list.pantry.length > 0 && (
        <p className="text-sm text-stone-600">
          <span className="font-semibold">Check pantry:</span> {list.pantry.join(', ')}
        </p>
      )}

      <button
        disabled={!valid.length || busy || !canPrice}
        onClick={onPrice}
        className="w-full rounded-xl bg-emerald-600 py-3.5 text-lg font-semibold text-white shadow-sm active:bg-emerald-700 disabled:bg-stone-300"
      >
        {busy ? 'Checking flyers…' : 'Find best prices'}
      </button>
      {!canPrice && <p className="text-center text-sm text-stone-500">Set your postal code above first.</p>}
      {busy && <p className="text-center text-sm text-stone-500">Searching this week's flyers. About 30–60 seconds.</p>}
    </section>
  );
}
