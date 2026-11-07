import { useMemo, useState } from 'react';
import { bestPlans, formatAmount, remindersText, withoutStores, type PlanSummary } from '../../shared/plan';
import {
  SECTIONS,
  type GroceryList,
  type ListItem,
  type Match,
  type PricesResponse,
  type StoreLocation,
} from '../../shared/types';

interface Props {
  list: GroceryList;
  prices: PricesResponse;
  maxStores: number;
  setMaxStores: (n: number) => void;
  /** Stores the shopper turned off (merchant names). */
  excluded: string[];
  setExcluded: (s: string[]) => void;
}

const money = (n: number) => `$${n.toFixed(2)}`;
const endDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' }) : null;

const SHORTCUT_NAME = 'Add to Groceries';

const mapsUrl = (store: string, loc: StoreLocation) =>
  `https://maps.apple.com/?q=${encodeURIComponent(store)}&ll=${loc.lat},${loc.lon}`;

export function ResultsStep({ list, prices, maxStores, setMaxStores, excluded, setExcluded }: Props) {
  const stores = prices.stores ?? {};
  const off = useMemo(() => new Set(excluded), [excluded]);
  const priced = useMemo(() => withoutStores(prices.priced, off), [prices, off]);
  const plans = useMemo(() => bestPlans(priced, maxStores), [priced, maxStores]);
  const [picked, setPicked] = useState<number | null>(null);
  const planIdx = Math.min(picked ?? plans.length - 1, plans.length - 1);
  const plan: PlanSummary | undefined = plans[planIdx];

  const items = list.items.filter((it) => it.name.trim());
  const matchesById = useMemo(
    () => new Map(priced.map((p) => [p.itemId, p.matches])),
    [priced],
  );
  const unassigned = items.filter((it) => !plan?.assignment.has(it.id));
  const text = remindersText(items, plan, stores);

  // Every store with at least one deal on this list, nearest first.
  const dealCounts = new Map<string, number>();
  for (const p of prices.priced) for (const m of p.matches) dealCounts.set(m.store, (dealCounts.get(m.store) ?? 0) + 1);
  const allStores = [...dealCounts.keys()].sort(
    (a, b) => (stores[a]?.distanceKm ?? 999) - (stores[b]?.distanceKm ?? 999) || a.localeCompare(b),
  );
  const toggle = (store: string) => {
    setExcluded(off.has(store) ? excluded.filter((s) => s !== store) : [...excluded, store]);
    setPicked(null);
  };
  const where = prices.city ?? prices.postal;

  return (
    <section className="space-y-5 pb-28">
      <h2 className="text-lg font-semibold">3. Where to shop</h2>

      {prices.storesChecked === false && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Couldn't check store locations right now, so some of these stores may not be in your city.
        </p>
      )}

      {allStores.length > 0 && (
        <details className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-stone-200" open={excluded.length > 0 || undefined}>
          <summary className="cursor-pointer text-sm font-medium">
            Stores in {where}{' '}
            <span className="text-stone-500">
              ({allStores.length - allStores.filter((s) => off.has(s)).length} of {allStores.length} on)
            </span>
          </summary>
          <ul className="mt-2 divide-y divide-stone-100">
            {allStores.map((store) => {
              const loc = stores[store];
              return (
                <li key={store}>
                  <label className="flex cursor-pointer items-center gap-3 py-2">
                    <input
                      type="checkbox"
                      checked={!off.has(store)}
                      onChange={() => toggle(store)}
                      className="size-5 shrink-0 accent-emerald-600"
                    />
                    <span className="min-w-0 flex-1">
                      <span className={`font-medium ${off.has(store) ? 'text-stone-400 line-through' : ''}`}>{store}</span>
                      {loc && (
                        <span className="block truncate text-xs text-stone-500">
                          {loc.address} · {loc.distanceKm} km
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-xs text-stone-500">
                      {dealCounts.get(store)} deal{dealCounts.get(store) === 1 ? '' : 's'}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          {prices.storesChecked && (
            <p className="mt-1 text-xs text-stone-500">
              Stores without a location in {where} are hidden. Locations from OpenStreetMap.
            </p>
          )}
        </details>
      )}

      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-stone-700">Max stores</span>
        <div className="inline-flex rounded-lg bg-stone-200 p-1" role="radiogroup" aria-label="Max stores">
          {[1, 2, 3].map((n) => (
            <button
              key={n}
              role="radio"
              aria-checked={maxStores === n}
              onClick={() => {
                setMaxStores(n);
                setPicked(null);
              }}
              className={`w-11 rounded-md py-1.5 text-sm font-semibold ${maxStores === n ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-600'}`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      {plans.length === 0 ? (
        <p className="rounded-xl bg-white p-4 text-stone-600 shadow-sm ring-1 ring-stone-200">
          {excluded.length && allStores.length
            ? 'Nothing on your list is on sale at the stores you have turned on.'
            : `Nothing on your list is in this week's flyers at stores in ${where}.`}
        </p>
      ) : (
        <div className="grid gap-2" role="radiogroup" aria-label="Store plans">
          {plans.map((p, i) => (
            <button
              key={p.stores.join('+')}
              role="radio"
              aria-checked={i === planIdx}
              onClick={() => setPicked(i)}
              className={`rounded-xl bg-white p-3 text-left shadow-sm ring-2 ${i === planIdx ? 'ring-emerald-600' : 'ring-stone-200'}`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-semibold">
                  {p.stores.length} store{p.stores.length > 1 ? 's' : ''}
                </span>
                <span className="text-xl font-bold tabular-nums">{money(p.total)}</span>
              </div>
              <div className="text-sm text-stone-600">{p.stores.join(' + ')}</div>
              <div className="mt-1 flex flex-wrap gap-x-3 text-sm">
                <span className="text-stone-500">
                  {p.covered} of {items.length} on sale
                </span>
                {i > 0 && p.savingsVsOne > 0.005 && (
                  <span className="font-semibold text-emerald-700">saves ~{money(p.savingsVsOne)} vs 1 store</span>
                )}
                {i > 0 && p.extraItems > 0 && (
                  <span className="font-semibold text-emerald-700">+{p.extraItems} more on sale</span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      {plan?.stores.map((store) => {
        const storeItems = items.filter((it) => plan.assignment.get(it.id)?.store === store);
        const subtotal = storeItems.reduce((s, it) => s + plan.assignment.get(it.id)!.estCost, 0);
        return (
          <div key={store}>
            <div className="mb-2 border-b-2 border-stone-800 pb-1">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-lg font-bold">{store}</h3>
                <span className="shrink-0 text-sm text-stone-600">
                  {storeItems.length} item{storeItems.length === 1 ? '' : 's'} ·{' '}
                  <span className="font-semibold text-stone-900">{money(subtotal)}</span>
                </span>
              </div>
              {stores[store] && (
                <a
                  href={mapsUrl(store, stores[store])}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm text-emerald-700 underline underline-offset-2"
                >
                  📍 {stores[store].address} · {stores[store].distanceKm} km
                </a>
              )}
            </div>
            <BySection items={storeItems} render={(it) => <DealLine item={it} match={plan.assignment.get(it.id)!} />} />
          </div>
        );
      })}

      {unassigned.length > 0 && (
        <div>
          <div className="mb-2 border-b-2 border-stone-400 pb-1">
            <h3 className="text-lg font-bold text-stone-600">
              {plans.length ? 'Not on sale at these stores' : 'Not on sale anywhere'}
            </h3>
          </div>
          <BySection
            items={unassigned}
            render={(it) => {
              const elsewhere = matchesById.get(it.id)?.[0];
              return (
                <div className="flex justify-between gap-3">
                  <span>
                    <span className="font-medium">{it.name}</span>{' '}
                    <span className="text-stone-500">{formatAmount(it)}</span>
                  </span>
                  {elsewhere && (
                    <span className="shrink-0 text-right text-xs text-stone-500">
                      on sale at {elsewhere.store}
                      <br />
                      {money(elsewhere.estCost)}
                    </span>
                  )}
                </div>
              );
            }}
          />
        </div>
      )}

      {list.pantry.length > 0 && (
        <div className="rounded-xl bg-stone-100 p-3 text-sm">
          <span className="font-semibold">Check pantry:</span> {list.pantry.join(', ')}
        </div>
      )}

      <p className="text-xs text-stone-500">
        Flyer prices only; totals cover the on-sale items. "Saves" compares the whole list, counting items a plan
        doesn't have on sale at the highest flyer price we found for them.
      </p>

      <RemindersHelp />
      <ActionBar text={text} />
    </section>
  );
}

function BySection({ items, render }: { items: ListItem[]; render: (it: ListItem) => React.ReactNode }) {
  return (
    <div className="space-y-3">
      {SECTIONS.map((section) => {
        const group = items.filter((it) => it.section === section);
        if (!group.length) return null;
        return (
          <div key={section}>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-stone-500">{section}</h4>
            <ul className="divide-y divide-stone-100 rounded-xl bg-white shadow-sm ring-1 ring-stone-200">
              {group.map((it) => (
                <li key={it.id} className="px-3 py-2.5">
                  {render(it)}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function DealLine({ item, match }: { item: ListItem; match: Match }) {
  const { deal } = match;
  const sale = [deal.priceText && !/^each$/i.test(deal.priceText) ? deal.priceText : null, deal.saleStory]
    .filter(Boolean)
    .join(' · ');
  const ends = endDate(deal.validTo);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span>
          <span className="font-medium">{item.name}</span>{' '}
          <span className="text-stone-500">{formatAmount(item)}</span>
        </span>
        <span className="shrink-0 font-semibold tabular-nums">{money(match.estCost)}</span>
      </div>
      <div className="mt-0.5 text-xs leading-snug text-stone-500">
        <span className="text-stone-700">{deal.name}</span> · ${deal.currentPrice}
        {deal.priceText && /\//.test(deal.priceText) ? deal.priceText : ''} · {match.unitPrice}
        <br />
        Buy {match.buy}
        {sale && <span className="text-emerald-700"> · {sale.length > 70 ? `${sale.slice(0, 70)}…` : sale}</span>}
        {ends && <span> · ends {ends}</span>}
      </div>
    </div>
  );
}

function ActionBar({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  const shortcutUrl = `shortcuts://run-shortcut?name=${encodeURIComponent(SHORTCUT_NAME)}&input=text&text=${encodeURIComponent(text)}`;

  return (
    <div className="fixed inset-x-0 bottom-0 border-t border-stone-200 bg-white/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
      <div className="mx-auto flex max-w-xl gap-2">
        <a
          href={shortcutUrl}
          className="flex-1 rounded-xl bg-emerald-600 py-3 text-center font-semibold text-white active:bg-emerald-700"
        >
          Send to Reminders
        </a>
        <button
          onClick={copy}
          className="w-28 rounded-xl border border-stone-300 py-3 font-semibold text-stone-800 active:bg-stone-100"
        >
          {copied ? 'Copied ✓' : 'Copy list'}
        </button>
      </div>
    </div>
  );
}

function RemindersHelp() {
  return (
    <details className="rounded-xl bg-white p-3 text-sm shadow-sm ring-1 ring-stone-200">
      <summary className="cursor-pointer font-medium">First time? Set up the Reminders shortcut</summary>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-stone-700">
        <li>
          Open the <b>Shortcuts</b> app and tap <b>+</b>. Name it <b>{SHORTCUT_NAME}</b> (exact spelling).
        </li>
        <li>
          Add <b>Split Text</b> and set it to split <i>Shortcut Input</i> by <b>New Lines</b>.
        </li>
        <li>
          Add <b>Repeat with Each</b> (item in Split Text).
        </li>
        <li>
          Inside the repeat, add <b>Add New Reminder</b> with <i>Repeat Item</i>, list <b>Groceries</b>.
        </li>
        <li>Make a list called Groceries in Reminders if you don't have one.</li>
      </ol>
      <p className="mt-2 text-stone-500">
        No iPhone? Use <b>Copy list</b> and paste it anywhere. Each line is "Store (street) · Item – amount".
      </p>
    </details>
  );
}
