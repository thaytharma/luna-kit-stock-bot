import { describe, expect, it } from 'vitest';
import { emptyState, parseState, serializeState, type BotState } from '../src/state.js';

const sample = (): BotState => ({
  version: 1,
  products: {
    'https://example.com/b': {
      status: 'not_in_stock',
      brokenRuns: 0,
      brokenWarningSent: false,
      restockNotified: false,
      lastCheckedAt: '2026-08-02T20:00:00.000Z',
    },
    'https://example.com/a': {
      status: 'in_stock',
      brokenRuns: 0,
      brokenWarningSent: false,
      restockNotified: true,
      lastCheckedAt: '2026-08-02T20:00:00.000Z',
      title: 'A',
    },
  },
  searches: {
    'https://www.finn.no/search?q=b': {
      seeded: true,
      seenIds: ['1', '2'],
      brokenRuns: 0,
      brokenWarningSent: false,
      lastCheckedAt: '2026-08-02T20:00:00.000Z',
    },
    'https://www.finn.no/search?q=a': {
      seeded: false,
      seenIds: [],
      brokenRuns: 1,
      brokenWarningSent: false,
      lastCheckedAt: '2026-08-02T20:00:00.000Z',
    },
  },
});

describe('state serialization', () => {
  it('round-trips without loss', () => {
    expect(parseState(serializeState(sample()))).toEqual(sample());
  });

  it('sorts products by url so committed diffs stay readable', () => {
    const keys = Object.keys(parseState(serializeState(sample())).products);
    expect(keys).toEqual(['https://example.com/a', 'https://example.com/b']);
  });

  it('sorts searches by url too', () => {
    const keys = Object.keys(parseState(serializeState(sample())).searches);
    expect(keys).toEqual(['https://www.finn.no/search?q=a', 'https://www.finn.no/search?q=b']);
  });

  it('reads a state file from before search watching existed', () => {
    const { searches, ...old } = sample();
    expect(parseState(JSON.stringify(old))).toEqual({ ...old, searches: {} });
  });

  it('ends with a newline so git is happy', () => {
    expect(serializeState(sample()).endsWith('\n')).toBe(true);
  });
});

describe('parseState resilience', () => {
  it.each([
    ['invalid json', 'not json at all'],
    ['empty string', ''],
    ['an array', '[]'],
    ['null', 'null'],
    ['an object without products', '{"version":1}'],
  ])('falls back to empty state for %s rather than crashing the run', (_label, raw) => {
    expect(parseState(raw)).toEqual(emptyState());
  });
});
