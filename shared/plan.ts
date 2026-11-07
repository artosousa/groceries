import { SECTIONS, type ListItem, type Match, type PricedItem, type StoreLocation } from './types';

export interface StorePlan {
  stores: string[];
  /** What you pay for the on-sale items in this plan. */
  total: number;
  /**
   * Comparable cost of the whole list: items this plan has no deal for are
   * counted at the highest flyer price found for them elsewhere.
   */
  score: number;
  /** itemId -> chosen match */
  assignment: Map<string, Match>;
  covered: number;
}

export interface PlanSummary extends StorePlan {
  /** Estimated savings vs the best 1-store plan, across the whole list. */
  savingsVsOne: number;
  /** Items on sale in this plan that the 1-store plan doesn't have. */
  extraItems: number;
}

/** Per item, the cheapest match per store (input should already be one per store). */
function costTable(priced: PricedItem[]) {
  const stores = new Set<string>();
  const table = new Map<string, Map<string, Match>>();
  for (const p of priced) {
    const byStore = new Map<string, Match>();
    for (const m of p.matches) {
      const prev = byStore.get(m.store);
      if (!prev || m.estCost < prev.estCost) byStore.set(m.store, m);
      stores.add(m.store);
    }
    table.set(p.itemId, byStore);
  }
  return { stores: [...stores], table };
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

function evaluate(
  stores: string[],
  table: Map<string, Map<string, Match>>,
  fallback: Map<string, number>,
): StorePlan {
  const assignment = new Map<string, Match>();
  let total = 0;
  let score = 0;
  for (const [itemId, byStore] of table) {
    let best: Match | undefined;
    for (const s of stores) {
      const m = byStore.get(s);
      if (m && (!best || m.estCost < best.estCost)) best = m;
    }
    if (best) {
      assignment.set(itemId, best);
      total += best.estCost;
      score += best.estCost;
    } else {
      score += fallback.get(itemId) ?? 0;
    }
  }
  return { stores, total, score, assignment, covered: assignment.size };
}

/**
 * Cheapest plan for each store count 1..maxStores, compared on the whole
 * list (see StorePlan.score) so plans covering different items are fair.
 * A plan only counts as k-store if every store in it is actually used.
 */
export function bestPlans(priced: PricedItem[], maxStores: number): PlanSummary[] {
  const { stores, table } = costTable(priced);
  // No regular prices yet: an item bought off-plan costs at least its
  // most expensive flyer price.
  const fallback = new Map<string, number>();
  for (const [itemId, byStore] of table) {
    const costs = [...byStore.values()].map((m) => m.estCost);
    if (costs.length) fallback.set(itemId, Math.max(...costs));
  }
  const plans: StorePlan[] = [];
  for (let k = 1; k <= Math.min(maxStores, stores.length); k++) {
    let best: StorePlan | undefined;
    for (const combo of combinations(stores, k)) {
      const plan = evaluate(combo, table, fallback);
      const used = new Set([...plan.assignment.values()].map((m) => m.store));
      if (used.size < k) continue;
      if (
        !best ||
        plan.score < best.score - 0.005 ||
        (Math.abs(plan.score - best.score) <= 0.005 && plan.covered > best.covered)
      ) {
        best = plan;
      }
    }
    if (best) {
      // Order stores by how many items they carry in this plan.
      const counts = new Map<string, number>();
      for (const m of best.assignment.values()) counts.set(m.store, (counts.get(m.store) ?? 0) + 1);
      best.stores.sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0));
      plans.push(best);
    }
  }

  const one = plans[0];
  return plans.map((p) => {
    let extraItems = 0;
    if (one && p !== one) {
      for (const itemId of p.assignment.keys()) if (!one.assignment.has(itemId)) extraItems++;
    }
    const savingsVsOne = one && p !== one ? one.score - p.score : 0;
    return { ...p, savingsVsOne, extraItems };
  });
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
  plan: StorePlan | undefined,
  stores: Record<string, StoreLocation> = {},
): string {
  const order = [...(plan?.stores ?? []), 'Any store'];
  const lines = items.map((item) => {
    const store = plan?.assignment.get(item.id)?.store ?? 'Any store';
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
