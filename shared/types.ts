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

/** Claude's chosen product for one item at one store (flyer deal or shelf price). */
export interface Match {
  store: string;
  /** For shelf prices this is synthesized from the product (negative dealId, no validTo). */
  deal: Deal;
  /** Where the price came from: this week's flyer, or the store's own website. */
  source?: 'flyer' | 'shelf';
  /** True for flyer deals and shelf products marked on sale. */
  onSale?: boolean;
  /** Estimated cost to buy the amount needed at this price. */
  estCost: number;
  /** The same purchase at the regular price, when the store states it (was-price). */
  regularCost?: number | null;
  /** Normalized unit price, e.g. "$8.80/kg" or "$2.50 each". */
  unitPrice: string;
  /** What to buy, e.g. "1 pack (~1 kg)". */
  buy: string;
  confidence: number;
}

export interface PricedItem {
  itemId: string;
  /** Real prices, at most one per store, cheapest first. */
  matches: Match[];
  /** Claude's estimate of the typical regular cost (Ontario) of the amount needed. */
  estRegularCost?: number | null;
}

/** Nearest location of a flyer merchant inside the shopper's city. */
export interface StoreLocation {
  name: string;
  /** "71 Wilson Street West, Ancaster" (may be just the city if unknown). */
  address: string;
  lat: number;
  lon: number;
  /** From the centre of the shopper's postal area. */
  distanceKm: number;
}

export interface PricesResponse {
  postal: string;
  /** Municipality used to filter stores, e.g. "Hamilton". */
  city?: string | null;
  /** merchant -> its nearest in-city location. Only these stores are in `priced`. */
  stores?: Record<string, StoreLocation>;
  /** False when the location lookup failed and deals were not filtered by city. */
  storesChecked?: boolean;
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
