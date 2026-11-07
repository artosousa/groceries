export const SECTIONS = [
  'Produce',
  'Meat & Fish',
  'Dairy & Eggs',
  'Bakery',
  'Pantry',
  'Frozen',
  'Other',
] as const;
export type Section = (typeof SECTIONS)[number];

export interface ListItem {
  id: string;
  name: string;
  /** Simple keyword for the flyer search, e.g. "chicken thighs". */
  searchTerm: string;
  amount: number | null;
  unit: string;
  /** Buying hint, e.g. "buy a dozen". */
  note: string | null;
  section: Section;
  recipes: string[];
}

export interface GroceryList {
  items: ListItem[];
  pantry: string[];
  flags: string[];
}

/** One flyer deal as the client sees it (trimmed from the Apify record). */
export interface Deal {
  dealId: number;
  name: string;
  merchant: string;
  currentPrice: number;
  originalPrice: number | null;
  priceText: string | null;
  saleStory: string | null;
  validTo: string | null;
  imageUrl: string | null;
}

/** Claude's chosen deal for one item at one store. */
export interface Match {
  store: string;
  deal: Deal;
  /** Estimated cost to buy the amount needed at this deal. */
  estCost: number;
  /** Normalized unit price, e.g. "$8.80/kg" or "$2.50 each". */
  unitPrice: string;
  /** What to buy, e.g. "1 pack (~1 kg)". */
  buy: string;
  confidence: number;
}

export interface PricedItem {
  itemId: string;
  matches: Match[];
}

export interface PricesResponse {
  postal: string;
  priced: PricedItem[];
  /** Search terms that came from cache (no Apify cost). */
  cachedTerms: number;
  fetchedTerms: number;
}

export interface ExtractRequest {
  images: { mediaType: string; data: string }[];
}

export interface PricesRequest {
  postal: string;
  items: ListItem[];
}

export interface ApiError {
  error: string;
}
