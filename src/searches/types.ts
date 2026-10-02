/** One classified ad in a marketplace search result. */
export interface Listing {
  /** The marketplace's own ad id — the key used to remember what was seen. */
  id: string;
  title: string;
  price: string | null;
  url: string;
}

export interface SearchSnapshot {
  /** Which marketplace this reading came from, e.g. "finn.no". Named in alerts. */
  siteLabel: string;
  listings: Listing[];
  /** Results the marketplace returned but that were dropped as not really matching. */
  ignored: number;
}

/**
 * A second-hand marketplace. Unlike a shop, there is no single page that comes
 * "back in stock": what matters is a new listing turning up in a saved search.
 */
export interface SearchAdapter {
  id: string;
  label: string;
  acceptLanguage: string;
  matches(url: string): boolean;
  /** Throws when the page carries no readable results, so that is never mistaken for "no hits". */
  parse(html: string): SearchSnapshot;
}
