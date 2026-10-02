import { BROKEN_RUN_THRESHOLD, type Notification } from './decide.js';
import type { Listing, SearchSnapshot } from './searches/index.js';
import type { SearchState } from './state.js';

export type SearchResult = { ok: true; snapshot: SearchSnapshot } | { ok: false; error: string };

export interface SearchOutcome {
  next: SearchState;
  notification: Notification | null;
  /** The listings this run alerts on, so the caller can un-see them if nobody heard it. */
  fresh: Listing[];
}

/** More than this and the push gets unreadable; the click-through shows the rest. */
export const MAX_LISTED = 5;

/**
 * Pure decision step for a saved marketplace search.
 *
 * Rules:
 *  - first successful read: remember every listing, notify nothing — they were
 *    there before we started watching
 *  - any listing id not seen before: notify once, naming the new ads
 *  - listings disappearing: silent (sold or removed), and their ids are kept so
 *    a relisting or paging shuffle does not re-alert
 *  - unreadable or unfetchable for BROKEN_RUN_THRESHOLD runs in a row: warn once
 */
export function decideSearch(
  url: string,
  previous: SearchState | undefined,
  result: SearchResult,
  now: string,
): SearchOutcome {
  const seen = previous?.seenIds ?? [];

  if (!result.ok) {
    const brokenRuns = (previous?.brokenRuns ?? 0) + 1;
    const next: SearchState = {
      seeded: previous?.seeded ?? false,
      seenIds: seen,
      brokenRuns,
      brokenWarningSent: previous?.brokenWarningSent ?? false,
      lastCheckedAt: now,
    };
    if (brokenRuns < BROKEN_RUN_THRESHOLD || next.brokenWarningSent) {
      return { next, notification: null, fresh: [] };
    }
    next.brokenWarningSent = true;
    return {
      next,
      fresh: [],
      notification: {
        kind: 'broken',
        title: 'Stock bot may be broken',
        body: [
          `${brokenRuns} consecutive failed checks for the search ${url}.`,
          `Reason: ${result.error}`,
          'Open the search manually and fix the bot.',
        ].join('\n'),
        url,
        priority: 3,
        tags: ['warning'],
      },
    };
  }

  const { listings, siteLabel } = result.snapshot;
  const seenSet = new Set(seen);
  const fresh = previous?.seeded ? listings.filter((listing) => !seenSet.has(listing.id)) : [];
  const next: SearchState = {
    seeded: true,
    seenIds: [...new Set([...seen, ...listings.map((listing) => listing.id)])].sort(),
    brokenRuns: 0,
    brokenWarningSent: false,
    lastCheckedAt: now,
  };

  if (fresh.length === 0) return { next, notification: null, fresh };

  const lines = fresh
    .slice(0, MAX_LISTED)
    .map((listing) => (listing.price !== null ? `${listing.title} – ${listing.price}` : listing.title));
  if (fresh.length > MAX_LISTED) lines.push(`…og ${fresh.length - MAX_LISTED} til`);

  return {
    next,
    fresh,
    notification: {
      kind: 'listing',
      title: fresh.length === 1 ? `Ny annonce på ${siteLabel}` : `${fresh.length} nye annoncer på ${siteLabel}`,
      body: lines.join('\n'),
      // One ad: go straight to it. Several: the search shows them all.
      url: fresh.length === 1 ? fresh[0]!.url : url,
      priority: 5,
      tags: ['mag', 'baby_symbol'],
    },
  };
}
