import { describe, expect, it } from 'vitest';
import { BROKEN_RUN_THRESHOLD } from '../src/decide.js';
import { decideSearch, MAX_LISTED, type SearchResult } from '../src/decide-search.js';
import type { Listing } from '../src/searches/index.js';
import type { SearchState } from '../src/state.js';

const URL = 'https://www.finn.no/recommerce/forsale/search?q=%22leander+luna%22';
const NOW = '2026-10-01T10:00:00.000Z';

const listing = (id: string, price: string | null = '2000 kr'): Listing => ({
  id,
  title: `Leander Luna ${id}`,
  price,
  url: `https://www.finn.no/recommerce/forsale/item/${id}`,
});

const read = (...listings: Listing[]): SearchResult => ({
  ok: true,
  snapshot: { siteLabel: 'finn.no', listings, ignored: 0 },
});

const failed: SearchResult = { ok: false, error: 'no search state on the page (layout change?)' };

const seeded = (...seenIds: string[]): SearchState => ({
  seeded: true,
  seenIds,
  brokenRuns: 0,
  brokenWarningSent: false,
  lastCheckedAt: '2026-10-01T09:45:00.000Z',
});

describe('decideSearch', () => {
  it('remembers what is already for sale on the first read, without alerting', () => {
    const { next, notification, fresh } = decideSearch(URL, undefined, read(listing('2'), listing('1')), NOW);
    expect(notification).toBeNull();
    expect(fresh).toEqual([]);
    expect(next).toEqual({ ...seeded('1', '2'), lastCheckedAt: NOW });
  });

  it('alerts on a single new ad and links straight to it', () => {
    const { next, notification, fresh } = decideSearch(URL, seeded('1'), read(listing('3'), listing('1')), NOW);
    expect(fresh.map((ad) => ad.id)).toEqual(['3']);
    expect(next.seenIds).toEqual(['1', '3']);
    expect(notification).toEqual({
      kind: 'listing',
      title: 'Ny annonce på finn.no',
      body: 'Leander Luna 3 – 2000 kr',
      url: 'https://www.finn.no/recommerce/forsale/item/3',
      priority: 5,
      tags: ['mag', 'baby_symbol'],
    });
  });

  it('bundles several new ads into one alert that links to the search', () => {
    const { notification } = decideSearch(URL, seeded(), read(listing('1'), listing('2', null)), NOW);
    expect(notification).toMatchObject({ title: '2 nye annoncer på finn.no', url: URL });
    expect(notification!.body).toBe('Leander Luna 1 – 2000 kr\nLeander Luna 2');
  });

  it('caps the list so a burst of ads stays readable', () => {
    const ads = Array.from({ length: MAX_LISTED + 3 }, (_, index) => listing(String(index)));
    const { notification, fresh } = decideSearch(URL, seeded(), read(...ads), NOW);
    expect(fresh).toHaveLength(MAX_LISTED + 3);
    const lines = notification!.body.split('\n');
    expect(lines).toHaveLength(MAX_LISTED + 1);
    expect(lines.at(-1)).toBe('…og 3 til');
  });

  it('stays silent when nothing new turned up', () => {
    expect(decideSearch(URL, seeded('1', '2'), read(listing('1')), NOW).notification).toBeNull();
  });

  it('keeps ads that disappeared, so a relisting or paging shuffle does not re-alert', () => {
    const gone = decideSearch(URL, seeded('1', '2'), read(listing('1')), NOW).next;
    expect(gone.seenIds).toEqual(['1', '2']);
    expect(decideSearch(URL, gone, read(listing('1'), listing('2')), NOW).notification).toBeNull();
  });

  it('seeds on the first successful read even after earlier failures', () => {
    const broken = { ...seeded(), seeded: false, brokenRuns: 2 };
    const { next, notification } = decideSearch(URL, broken, read(listing('1')), NOW);
    expect(notification).toBeNull();
    expect(next).toMatchObject({ seeded: true, seenIds: ['1'], brokenRuns: 0 });
  });
});

describe('decideSearch when the search cannot be read', () => {
  it(`warns once after ${BROKEN_RUN_THRESHOLD} consecutive failures`, () => {
    let state: SearchState | undefined;
    const notifications = [];
    for (let run = 0; run < BROKEN_RUN_THRESHOLD + 2; run++) {
      const outcome = decideSearch(URL, state, failed, NOW);
      state = outcome.next;
      if (outcome.notification) notifications.push(outcome.notification);
    }
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({ kind: 'broken', priority: 3, url: URL });
    expect(notifications[0]!.body).toContain('layout change');
  });

  it('keeps what it has seen through a failure, so recovery does not re-alert', () => {
    const { next } = decideSearch(URL, seeded('1'), failed, NOW);
    expect(next).toMatchObject({ seeded: true, seenIds: ['1'], brokenRuns: 1 });
    expect(decideSearch(URL, next, read(listing('1')), NOW).notification).toBeNull();
  });

  it('re-arms the warning once a read succeeds again', () => {
    const warned = { ...seeded('1'), brokenRuns: 5, brokenWarningSent: true };
    expect(decideSearch(URL, warned, read(listing('1')), NOW).next).toMatchObject({
      brokenRuns: 0,
      brokenWarningSent: false,
    });
  });
});
