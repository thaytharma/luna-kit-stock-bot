/**
 * Parsing of finn.no Torget search result pages.
 *
 * The page is server-rendered and embeds its search response as react-query
 * state: a base64-encoded JSON blob in
 *   `<script type="application/json" data-react-query-state>`.
 * The query whose key has `scope: "search"` carries `docs`, one per ad, with
 * the ad id, heading, price and canonical URL.
 *
 * The trap: alongside real keyword hits, finn.no mixes in loose "semantic"
 * matches. A search for "luna ombyggingssett" returned 53 docs, 52 of them hole
 * saws, wool sweaters and the like, tagged `metadata.source: "semantic"`. Those
 * are dropped, otherwise nearly every alert would be junk. Real hits are tagged
 * `"keyword"` or `"both"`.
 *
 * A page with no search state at all (layout change, error page, an ad page
 * instead of a search) throws, so the broken-bot warning catches it. An empty
 * result list is a valid reading, not an error.
 */

import { hostOf } from '../sites/types.js';
import type { Listing, SearchAdapter, SearchSnapshot } from './types.js';

const LABEL = 'finn.no';

const QUERY_STATE = /<script[^>]*\bdata-react-query-state\b[^>]*>([\s\S]*?)<\/script>/i;

interface FinnDoc {
  id?: unknown;
  ad_id?: unknown;
  heading?: unknown;
  canonical_url?: unknown;
  price?: { amount?: unknown; price_unit?: unknown };
  metadata?: { source?: unknown };
}

interface FinnQuery {
  queryKey?: unknown[];
  state?: { data?: { docs?: unknown } };
}

/** The blob is base64 today; accept plain JSON too in case they stop encoding it. */
function decodeState(raw: string): unknown {
  const text = raw.trim();
  const json = text.startsWith('{') ? text : Buffer.from(text, 'base64').toString('utf8');
  return JSON.parse(json);
}

function searchDocs(html: string): FinnDoc[] {
  const raw = QUERY_STATE.exec(html)?.[1];
  if (raw === undefined) throw new Error('no search state on the page (layout change?)');

  let state: unknown;
  try {
    state = decodeState(raw);
  } catch {
    throw new Error('search state could not be decoded (layout change?)');
  }

  const queries = (state as { queries?: unknown }).queries;
  const search = Array.isArray(queries)
    ? (queries as FinnQuery[]).find((query) => {
        const key = query.queryKey?.[0] as { scope?: unknown } | undefined;
        return key?.scope === 'search' && Array.isArray(query.state?.data?.docs);
      })
    : undefined;
  if (search === undefined) throw new Error('no search results in the page state (layout change?)');
  return search.state!.data!.docs as FinnDoc[];
}

function toListing(doc: FinnDoc): Listing | null {
  const id = doc.id ?? doc.ad_id;
  if ((typeof id !== 'string' && typeof id !== 'number') || typeof doc.heading !== 'string') {
    return null;
  }
  const amount = doc.price?.amount;
  const unit = typeof doc.price?.price_unit === 'string' ? doc.price.price_unit : 'kr';
  return {
    id: String(id),
    // Headings can carry the seller's own line breaks.
    title: doc.heading.replace(/\s+/g, ' ').trim(),
    price: typeof amount === 'number' ? `${amount} ${unit}` : null,
    url:
      typeof doc.canonical_url === 'string'
        ? doc.canonical_url
        : `https://www.finn.no/recommerce/forsale/item/${id}`,
  };
}

export function parseSearch(html: string): SearchSnapshot {
  const docs = searchDocs(html);
  const matching = docs.filter((doc) => doc.metadata?.source !== 'semantic');
  const listings = matching.map(toListing).filter((listing): listing is Listing => listing !== null);
  if (matching.length > 0 && listings.length === 0) {
    throw new Error('search results have no readable ads (layout change?)');
  }
  return { siteLabel: LABEL, listings, ignored: docs.length - listings.length };
}

export const finn: SearchAdapter = {
  id: 'finn',
  label: LABEL,
  acceptLanguage: 'nb-NO,nb;q=0.9,no;q=0.8,en;q=0.7',
  matches: (url) => /(^|\.)finn\.no$/i.test(hostOf(url)),
  parse: parseSearch,
};
