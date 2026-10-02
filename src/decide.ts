import type { ProductSnapshot } from './parse.js';
import type { ProductState } from './state.js';

export interface Notification {
  kind: 'restock' | 'listing' | 'broken';
  title: string;
  body: string;
  url: string;
  /** ntfy priority: 5 = max (bypasses phone quiet hours), 3 = default. */
  priority: 3 | 5;
  tags: string[];
}

export interface CheckOutcome {
  next: ProductState;
  notification: Notification | null;
}

/** Consecutive unparseable/failed runs before we assume the bot itself is broken. */
export const BROKEN_RUN_THRESHOLD = 3;

/** Each shop names its own signals, so just list whatever it reported. */
export function describeSignals(signals: Record<string, string>): string {
  return Object.entries(signals)
    .map(([name, value]) => `${name}: ${value}`)
    .join(', ');
}

export type CheckResult =
  | { ok: true; snapshot: ProductSnapshot }
  | { ok: false; error: string };

/**
 * Pure decision step: given what we saw last time and what we see now, decide
 * the new state and whether to notify.
 *
 * Rules:
 *  - -> in_stock, when no restock notification has been delivered for the
 *    current in-stock streak: notify (restock)
 *  - in_stock -> in_stock, already notified: silent, so we do not re-notify
 *    every 15 minutes
 *  - -> not_in_stock: silent, this is the expected steady state
 *  - unknown or fetch_error for BROKEN_RUN_THRESHOLD runs in a row: notify once
 *    (a silently broken scraper is the failure mode that actually costs us the product)
 */
export function decide(
  url: string,
  previous: ProductState | undefined,
  result: CheckResult,
  now: string,
): CheckOutcome {
  const status = result.ok ? result.snapshot.status : 'fetch_error';
  const healthy = status === 'in_stock' || status === 'not_in_stock';
  const brokenRuns = healthy ? 0 : (previous?.brokenRuns ?? 0) + 1;

  const next: ProductState = {
    status,
    brokenRuns,
    brokenWarningSent: healthy ? false : (previous?.brokenWarningSent ?? false),
    // An out-of-stock reading ends the streak, so the next restock notifies again.
    restockNotified: status === 'not_in_stock' ? false : (previous?.restockNotified ?? false),
    lastCheckedAt: now,
    ...(previous?.lastInStockAt !== undefined ? { lastInStockAt: previous.lastInStockAt } : {}),
    ...(previous?.title !== undefined ? { title: previous.title } : {}),
    ...(previous?.price !== undefined ? { price: previous.price } : {}),
  };

  if (result.ok) {
    if (result.snapshot.title !== null) next.title = result.snapshot.title;
    if (result.snapshot.price !== null) next.price = result.snapshot.price;
  }

  const label = next.title ?? url;

  if (status === 'in_stock') {
    next.lastInStockAt = now;
    if (next.restockNotified) return { next, notification: null };
    next.restockNotified = true;
    const uncertain = result.ok && !result.snapshot.agreed;
    const shop = result.ok ? result.snapshot.siteLabel : 'butikken';
    return {
      next,
      notification: {
        kind: 'restock',
        title: uncertain ? 'Måske på lager' : 'På lager nu!',
        body: [
          uncertain
            ? `${label} ser ud til at være på lager på ${shop}, men signalerne er uenige — tjek siden.`
            : `${label} er på lager på ${shop}.`,
          // kids-world's price already ends in "kr." — no extra full stop.
          next.price !== undefined ? `Pris: ${next.price}` : null,
          uncertain && result.ok ? `(${describeSignals(result.snapshot.signals)})` : 'Skynd dig at bestille.',
        ]
          .filter((line): line is string => line !== null)
          .join('\n'),
        url,
        priority: 5,
        tags: uncertain ? ['warning', 'baby_symbol'] : ['rotating_light', 'baby_symbol'],
      },
    };
  }

  if (!healthy && brokenRuns >= BROKEN_RUN_THRESHOLD && !next.brokenWarningSent) {
    next.brokenWarningSent = true;
    const reason = result.ok
      ? 'no usable stock signal could be read from the page (layout change?)'
      : `the page could not be fetched: ${result.error}`;
    return {
      next,
      notification: {
        kind: 'broken',
        title: 'Stock bot may be broken',
        body: [
          `${brokenRuns} consecutive failed checks for ${label}.`,
          `Reason: ${reason}`,
          'Check the product page manually and fix the bot.',
        ].join('\n'),
        url,
        priority: 3,
        tags: ['warning'],
      },
    };
  }

  return { next, notification: null };
}
