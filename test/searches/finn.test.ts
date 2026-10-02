import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { finn, parseSearch } from '../../src/searches/finn.js';
import { searchSiteFor } from '../../src/searches/index.js';

const fixture = (name: string) =>
  readFileSync(join(import.meta.dirname, '..', 'fixtures', name), 'utf8');

/** Wrap a react-query state the way finn.no does: base64 JSON in a script tag. */
const page = (state: unknown, encode = true) => {
  const json = JSON.stringify(state);
  const body = encode ? Buffer.from(json, 'utf8').toString('base64') : json;
  return `<html><script type="application/json" data-react-query-state>${body}</script></html>`;
};

const searchState = (docs: unknown[]) => ({
  mutations: [],
  queries: [
    { queryKey: ['navigation-categories'], state: { data: [] } },
    { queryKey: [{ scope: 'search', searchKey: 'SEARCH_ID_BAP_COMMON' }], state: { data: { docs } } },
  ],
});

const doc = (id: number, heading: string, source = 'keyword', amount: number | null = 1000) => ({
  id: String(id),
  ad_id: id,
  heading,
  canonical_url: `https://www.finn.no/recommerce/forsale/item/${id}`,
  ...(amount !== null ? { price: { amount, currency_code: 'NOK', price_unit: 'kr' } } : {}),
  metadata: { source },
});

describe('parseSearch on real pages', () => {
  it('reads every listing of the default "leander luna" phrase search', () => {
    const { siteLabel, listings, ignored } = parseSearch(fixture('finn-search.html'));
    expect(siteLabel).toBe('finn.no');
    expect(ignored).toBe(0);
    expect(listings).toHaveLength(7);
    expect(listings[1]).toEqual({
      id: '476455107',
      title: 'Leander Luna-sprinkelseng med ombyggingssett til småbarnsseng',
      price: '2000 kr',
      url: 'https://www.finn.no/recommerce/forsale/item/476455107',
    });
  });

  it('drops the semantic filler finn.no mixes into results, keeping real keyword hits', () => {
    const { listings, ignored } = parseSearch(fixture('finn-search-semantic.html'));
    expect(ignored).toBe(51);
    expect(listings.map((listing) => listing.id)).toEqual(['476455107', '458019611']);
  });

  it('reads a search with no hits as an empty, valid result', () => {
    expect(parseSearch(fixture('finn-search-empty.html'))).toEqual({
      siteLabel: 'finn.no',
      listings: [],
      ignored: 0,
    });
  });
});

describe('parseSearch on synthetic state', () => {
  it('keeps listings tagged "both", which matched by keyword as well', () => {
    const { listings } = parseSearch(page(searchState([doc(1, 'Luna', 'both')])));
    expect(listings.map((listing) => listing.id)).toEqual(['1']);
  });

  it("collapses the seller's line breaks in the heading", () => {
    const { listings } = parseSearch(page(searchState([doc(1, 'Luna Babyseng - Leander\n\n- Hvit/Eik')])));
    expect(listings[0]!.title).toBe('Luna Babyseng - Leander - Hvit/Eik');
  });

  it('reports no price rather than guessing when the ad has none', () => {
    const { listings } = parseSearch(page(searchState([doc(1, 'Luna', 'keyword', null)])));
    expect(listings[0]!.price).toBeNull();
  });

  it('builds the ad URL from the id when the canonical URL is missing', () => {
    const { canonical_url: _, ...bare } = doc(42, 'Luna');
    const { listings } = parseSearch(page(searchState([bare])));
    expect(listings[0]!.url).toBe('https://www.finn.no/recommerce/forsale/item/42');
  });

  it('also accepts the state as plain JSON, in case finn.no stops encoding it', () => {
    const { listings } = parseSearch(page(searchState([doc(1, 'Luna')]), false));
    expect(listings).toHaveLength(1);
  });
});

/**
 * Each of these must throw rather than return no listings: an empty result is a
 * normal reading, so a silently broken parser would look exactly like "nothing
 * new for sale" forever.
 */
describe('parseSearch refuses pages it cannot read', () => {
  it.each([
    ['a page without search state', '<html><body>Ingen treff</body></html>'],
    ['undecodable state', '<script data-react-query-state>@@not base64 json@@</script>'],
    ['state without a search query', page({ queries: [{ queryKey: ['other'], state: { data: {} } }] })],
    ['ads that have lost their id and heading', page(searchState([{ metadata: { source: 'keyword' } }]))],
  ])('throws on %s', (_label, html) => {
    expect(() => parseSearch(html)).toThrow(/layout change/);
  });

  it('does not throw when every result was semantic filler', () => {
    expect(parseSearch(page(searchState([doc(1, 'Hullsagsett', 'semantic')])))).toMatchObject({
      listings: [],
      ignored: 1,
    });
  });
});

describe('search registry', () => {
  it('routes finn.no searches to the finn parser', () => {
    expect(searchSiteFor('https://www.finn.no/recommerce/forsale/search?q=luna')).toBe(finn);
  });

  it('fails loudly for an unsupported marketplace', () => {
    expect(() => searchSiteFor('https://www.ebay.com/sch/i.html?_nkw=luna')).toThrow(/unsupported marketplace/);
  });

  it('does not match look-alike hosts', () => {
    expect(finn.matches('https://notfinn.no/search')).toBe(false);
    expect(finn.matches('not a url')).toBe(false);
  });
});
