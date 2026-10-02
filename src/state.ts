import type { StockStatus } from './parse.js';

export interface ProductState {
  status: StockStatus | 'fetch_error';
  /** Consecutive runs where the status was neither in_stock nor not_in_stock. */
  brokenRuns: number;
  /** True once we have warned about the current broken streak, so we warn once. */
  brokenWarningSent: boolean;
  /**
   * True once a restock notification for the current in-stock streak was
   * actually delivered. Tracked separately from `status` so a delivery failure
   * retries next run instead of being lost.
   */
  restockNotified: boolean;
  lastCheckedAt: string;
  lastInStockAt?: string;
  title?: string;
  price?: string;
}

/** A saved marketplace search, keyed by its URL. */
export interface SearchState {
  /**
   * False until one successful read has recorded the listings already up, so
   * adding a search does not fire an alert for every existing ad.
   */
  seeded: boolean;
  /** Ad ids already seen (or alerted on), sorted so committed diffs stay readable. */
  seenIds: string[];
  /** Consecutive runs where the search could not be fetched or read. */
  brokenRuns: number;
  brokenWarningSent: boolean;
  lastCheckedAt: string;
}

export interface BotState {
  version: 1;
  products: Record<string, ProductState>;
  searches: Record<string, SearchState>;
}

export const emptyState = (): BotState => ({ version: 1, products: {}, searches: {} });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function parseState(raw: string): BotState {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'products' in parsed &&
      typeof (parsed as BotState).products === 'object'
    ) {
      const { products, searches } = parsed as Partial<BotState>;
      return {
        version: 1,
        products: products ?? {},
        // State files written before search watching existed have no `searches`.
        searches: isRecord(searches) ? (searches as BotState['searches']) : {},
      };
    }
  } catch {
    // Fall through: a corrupt state file must not stop the bot from checking.
  }
  return emptyState();
}

const sortedByKey = <T>(record: Record<string, T>): Record<string, T> =>
  Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));

export function serializeState(state: BotState): string {
  const products = sortedByKey(state.products);
  const searches = sortedByKey(state.searches);
  return `${JSON.stringify({ ...state, products, searches }, null, 2)}\n`;
}

export async function loadState(path: string): Promise<BotState> {
  const { readFile } = await import('node:fs/promises');
  try {
    return parseState(await readFile(path, 'utf8'));
  } catch {
    return emptyState();
  }
}

export async function saveState(path: string, state: BotState): Promise<void> {
  const { writeFile } = await import('node:fs/promises');
  await writeFile(path, serializeState(state), 'utf8');
}
