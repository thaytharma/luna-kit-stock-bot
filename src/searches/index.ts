import { finn } from './finn.js';
import type { SearchAdapter } from './types.js';

export const SEARCH_SITES: SearchAdapter[] = [finn];

/** The parser for a search URL's marketplace. Throws rather than guessing, like `siteFor`. */
export function searchSiteFor(url: string): SearchAdapter {
  const site = SEARCH_SITES.find((candidate) => candidate.matches(url));
  if (site === undefined) throw new Error(`no search parser for ${url} — unsupported marketplace`);
  return site;
}

export type { Listing, SearchAdapter, SearchSnapshot } from './types.js';
