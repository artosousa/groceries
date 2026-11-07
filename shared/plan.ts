import { SECTIONS, type ListItem, type Match, type PricedItem, type StoreLocation } from './types';

/** How one item is bought in a plan. */
export interface PlanLine {
  /** null only when no store has any data and we fall back to an estimate. */
  store: string | null;
  /** sale: flyer/website sale; regular: the store's own shelf price; estimate: Claude's typical price. */
  kind: 'sale' | 'regular' | 'estimate';
  cost: number;
  /** The same purchase at regular price (sale lines only). */
  regular: number | null;
  /** True when `regular` is Claude's estimate rather than the store's stated price. */
  regularEstimated: boolean;
  match?: Match;
}

export interface PlanSummary {
  stores: string[];
  /** itemId -> line. Items with no price at all are missing. */
  lines: Map<string, PlanLine>;
  /** Everything priced, sale + regular + estimated. */
  total: number;
  /** Part of `total` that is estimated. */
  estimatedTotal: number;
  /** Sum over sale lines of (regular - sale). */
  savings: number;
  /** True when some of the savings use an estimated regular price. */
  savingsEstimated: boolean;
  saleCount: number;
  /** Cheaper than the best 1-store plan by this much. */
  savingsVsOne: number;
}

function combinations<T>(arr: T[], k: number): T[][] {
  const out: T[][] = [];
  const rec = (start: number, acc: T[]) => {
    if (acc.length === k) return void out.push([...acc]);
    for (let i = start; i < arr.length; i++) {
      acc.push(arr[i]);
      rec(i + 1, acc);
      acc.pop();
    }
  };
  rec(0, []);
  return out;
}

function lineFor(m: Match, est: number | null): PlanLine {
  const onSale = m.onSale ?? true; // older saved results only had flyer deals
  if (!onSale) return { store: m.store, kind: 'regular', cost: m.estCost, regular: null, regularEstimated: false, match: m };
  const stated = m.regularCost ?? null;
  const regular = stated ?? (est != null && est > m.estCost ? est : null);
  return {
    store: m.store,
    kind: 'sale',
    cost: m.estCost,
    regular,
    regularEstimated: stated == null && regular != null,
    match: m,
  };
}

function evaluate(stores: string[], priced: PricedItem[]): PlanSummary {
  const lines = new Map<string, PlanLine>();
  const pending: { itemId: string; lacking: string[] }[] = [];
  for (const p of priced) {
    const est = p.estRegularCost ?? null;
    let best: PlanLine | undefined;
    for (const s of stores) {
      const m = p.matches.find((x) => x.store === s);
      if (!m) continue;
      const line = lineFor(m, est);
      if (!best || line.cost < best.cost - 0.005 || (Math.abs(line.cost - best.cost) <= 0.005 && line.kind === 'sale'))
        best = line;
    }
    // A plan store with no data for this item: assume the typical price there.
    const lacking = stores.filter((s) => !p.matches.some((x) => x.store === s));
    if (est != null && (lacking.length || !stores.length) && (!best || est < best.cost - 0.005)) {
      lines.set(p.itemId, { store: null, kind: 'estimate', cost: est, regular: null, regularEstimated: false });
      pending.push({ itemId: p.itemId, lacking });
    } else if (best) {
      lines.set(p.itemId, best);
    }
  }
  // Put estimated items at the plan store already carrying the most.
  const counts = new Map<string, number>();
  for (const l of lines.values()) if (l.store) counts.set(l.store, (counts.get(l.store) ?? 0) + 1);
  for (const { itemId, lacking } of pending) {
    if (!lacking.length) continue;
    const store = [...lacking].sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0))[0];
    lines.get(itemId)!.store = store;
    counts.set(store, (counts.get(store) ?? 0) + 1);
  }

  let total = 0;
  let estimatedTotal = 0;
  let savings = 0;
  let savingsEstimated = false;
  let saleCount = 0;
  for (const l of lines.values()) {
    total += l.cost;
    if (l.kind === 'estimate') estimatedTotal += l.cost;
    if (l.kind === 'sale') {
      saleCount++;
      if (l.regular != null && l.regular > l.cost) {
        savings += l.regular - l.cost;
        if (l.regularEstimated) savingsEstimated = true;
      }
    }
  }
  const ordered = [...stores].sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0));
  return { stores: ordered, lines, total, estimatedTotal, savings, savingsEstimated, saleCount, savingsVsOne: 0 };
}

/**
 * Cheapest plan for each store count 1..maxStores over the whole list.
 * A plan only counts as k-store if every store in it is actually used.
 */
export function bestPlans(priced: PricedItem[], maxStores: number): PlanSummary[] {
  const stores = [...new Set(priced.flatMap((p) => p.matches.map((m) => m.store)))];
  if (!stores.length) {
    const plan = evaluate([], priced);
    return plan.lines.size ? [plan] : [];
  }
  const plans: PlanSummary[] = [];
  for (let k = 1; k <= Math.min(maxStores, stores.length); k++) {
    let best: PlanSummary | undefined;
    for (const combo of combinations(stores, k)) {
      const plan = evaluate(combo, priced);
      const used = new Set([...plan.lines.values()].map((l) => l.store));
      if (combo.some((s) => !used.has(s))) continue;
      if (
        !best ||
        plan.total < best.total - 0.005 ||
        (Math.abs(plan.total - best.total) <= 0.005 && plan.saleCount > best.saleCount)
      ) {
        best = plan;
      }
    }
    if (best) plans.push(best);
  }
  const one = plans[0];
  for (const p of plans) p.savingsVsOne = one && p !== one ? one.total - p.total : 0;
  return plans;
}

export function formatAmount(item: Pick<ListItem, 'amount' | 'unit' | 'note'>): string {
  const n =
    item.amount == null ? '' : Number.isInteger(item.amount) ? String(item.amount) : String(+item.amount.toFixed(2));
  const base = [n, item.unit].filter(Boolean).join(' ');
  return item.note ? (base ? `${base} (${item.note})` : item.note) : base;
}

/** First part of an address, e.g. "71 Wilson Street West". */
export const streetOf = (loc: StoreLocation | undefined) => loc?.address.split(',')[0].trim() || '';

/** Drop matches at stores the shopper turned off. */
export function withoutStores(priced: PricedItem[], excluded: Set<string>): PricedItem[] {
  if (!excluded.size) return priced;
  return priced.map((p) => ({ ...p, matches: p.matches.filter((m) => !excluded.has(m.store)) }));
}

/** Lines for the Reminders shortcut: "Store (street) · Item – amount", by store, then category. */
export function remindersText(
  items: ListItem[],
  plan: PlanSummary | undefined,
  stores: Record<string, StoreLocation> = {},
): string {
  const order = [...(plan?.stores ?? []), 'Any store'];
  const lines = items.map((item) => {
    const store = plan?.lines.get(item.id)?.store ?? 'Any store';
    const street = streetOf(stores[store]);
    const amt = formatAmount(item);
    return {
      rank: order.indexOf(store) * 100 + SECTIONS.indexOf(item.section),
      line: `${street ? `${store} (${street})` : store} · ${item.name}${amt ? ` – ${amt}` : ''}`,
    };
  });
  lines.sort((a, b) => a.rank - b.rank);
  return lines.map((l) => l.line).join('\n');
}
