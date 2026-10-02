import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SEARCH_URLS, DEFAULT_URLS, loadConfig } from '../src/config.js';
import { fetchPage } from '../src/fetch.js';

describe('loadConfig', () => {
  it('watches the Leander Luna kit at both shops by default', () => {
    expect(loadConfig({}).urls).toEqual(DEFAULT_URLS);
    expect(DEFAULT_URLS[0]).toContain('leander-luna-ombygningssaet');
    expect(DEFAULT_URLS[1]).toContain('ombyggingssett-til-luna-babyseng');
  });

  it('keeps the csmegastore URL free of the ?sq= tracking parameter, since it is the state key', () => {
    expect(DEFAULT_URLS[1]).not.toContain('?');
  });

  it('accepts a comma-separated list and trims it', () => {
    const config = loadConfig({ PRODUCT_URLS: ' https://a.dk/x , https://b.dk/y ,, ' });
    expect(config.urls).toEqual(['https://a.dk/x', 'https://b.dk/y']);
  });

  it('watches second-hand Luna ads on finn.no by default, as a phrase search, newest first', () => {
    expect(loadConfig({}).searchUrls).toEqual(DEFAULT_SEARCH_URLS);
    const url = new URL(DEFAULT_SEARCH_URLS[0]!);
    expect(url.hostname).toBe('www.finn.no');
    expect(url.searchParams.get('q')).toBe('"leander luna"');
    expect(url.searchParams.get('sort')).toBe('PUBLISHED_DESC');
  });

  it('replaces the default searches with SEARCH_URLS, trimmed', () => {
    const config = loadConfig({ SEARCH_URLS: ' https://www.finn.no/a , ,https://www.finn.no/b' });
    expect(config.searchUrls).toEqual(['https://www.finn.no/a', 'https://www.finn.no/b']);
  });

  it('treats an empty SEARCH_URLS from Actions as unset', () => {
    expect(loadConfig({ SEARCH_URLS: '' }).searchUrls).toEqual(DEFAULT_SEARCH_URLS);
  });

  it('disables both channels when nothing is configured', () => {
    const config = loadConfig({});
    expect(config.ntfy).toBeNull();
    expect(config.email).toBeNull();
  });

  it('enables ntfy from a topic alone, defaulting to ntfy.sh', () => {
    expect(loadConfig({ NTFY_TOPIC: 'kw-abc123' }).ntfy).toEqual({
      topic: 'kw-abc123',
      server: 'https://ntfy.sh',
    });
  });

  it('allows a self-hosted ntfy server', () => {
    expect(loadConfig({ NTFY_TOPIC: 't', NTFY_SERVER: 'https://push.me' }).ntfy?.server).toBe(
      'https://push.me',
    );
  });

  it('enables email only when host, user, pass and a recipient are all present', () => {
    const complete = {
      SMTP_HOST: 'smtp.gmail.com',
      SMTP_USER: 'bot@gmail.com',
      SMTP_PASS: 'app-password',
      MAIL_TO: 'thay@example.com',
    };
    expect(loadConfig(complete).email).toMatchObject({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      from: 'bot@gmail.com',
      to: ['thay@example.com'],
    });

    for (const key of Object.keys(complete)) {
      const partial = { ...complete, [key]: '' };
      expect(loadConfig(partial).email, `missing ${key} should disable email`).toBeNull();
    }
  });

  it('turns on implicit TLS for port 465', () => {
    const config = loadConfig({
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: '465',
      SMTP_USER: 'u',
      SMTP_PASS: 'p',
      MAIL_TO: 'a@b.dk',
    });
    expect(config.email).toMatchObject({ port: 465, secure: true });
  });

  it('supports several recipients and an explicit from address', () => {
    const config = loadConfig({
      SMTP_HOST: 'h',
      SMTP_USER: 'u',
      SMTP_PASS: 'p',
      MAIL_FROM: 'Stock Bot <bot@b.dk>',
      MAIL_TO: 'a@b.dk, c@d.dk',
    });
    expect(config.email?.from).toBe('Stock Bot <bot@b.dk>');
    expect(config.email?.to).toEqual(['a@b.dk', 'c@d.dk']);
  });
});

/**
 * GitHub Actions passes every referenced secret and var as an empty string when
 * it is not set, rather than omitting it. An earlier version used `??`, which
 * only guards against undefined, and produced a request to the URL "/<topic>".
 */
describe('loadConfig with unset GitHub Actions values (empty strings)', () => {
  const actionsEnvWithOnlyNtfy = {
    PRODUCT_URLS: '',
    NTFY_TOPIC: 'kw-leander-abc',
    NTFY_SERVER: '',
    SMTP_HOST: '',
    SMTP_PORT: '',
    SMTP_USER: '',
    SMTP_PASS: '',
    MAIL_FROM: '',
    MAIL_TO: '',
  };

  it('falls back to the public ntfy server instead of an empty base url', () => {
    expect(loadConfig(actionsEnvWithOnlyNtfy).ntfy).toEqual({
      topic: 'kw-leander-abc',
      server: 'https://ntfy.sh',
    });
  });

  it('leaves email disabled rather than half-configured', () => {
    expect(loadConfig(actionsEnvWithOnlyNtfy).email).toBeNull();
  });

  it('falls back to the default product url', () => {
    expect(loadConfig(actionsEnvWithOnlyNtfy).urls).toEqual(DEFAULT_URLS);
  });

  it('falls back to the default state path', () => {
    expect(loadConfig({ ...actionsEnvWithOnlyNtfy, STATE_PATH: '' }).statePath).toBe('state.json');
  });

  it('does not build a From header out of an empty MAIL_FROM', () => {
    const config = loadConfig({
      ...actionsEnvWithOnlyNtfy,
      SMTP_HOST: 'smtp.gmail.com',
      SMTP_USER: 'bot@gmail.com',
      SMTP_PASS: 'app-password',
      MAIL_TO: 'thay@example.com',
    });
    expect(config.email?.from).toBe('bot@gmail.com');
  });

  it('falls back to the default SMTP port when the var is empty', () => {
    const config = loadConfig({
      ...actionsEnvWithOnlyNtfy,
      SMTP_HOST: 'h',
      SMTP_USER: 'u',
      SMTP_PASS: 'p',
      MAIL_TO: 'a@b.dk',
      SMTP_PORT: '',
    });
    expect(config.email?.port).toBe(587);
  });

  it('treats whitespace-only values as unset too', () => {
    expect(loadConfig({ NTFY_TOPIC: '   ' }).ntfy).toBeNull();
  });

  it('trims stray whitespace from values that are set', () => {
    expect(loadConfig({ NTFY_TOPIC: ' kw-abc \n' }).ntfy?.topic).toBe('kw-abc');
  });
});

describe('fetchPage', () => {
  const html = '<html>ok</html>';
  const noSleep = async () => {};

  it('returns the page body and identifies as a browser', async () => {
    const fetchImpl = vi.fn(async () => new Response(html, { status: 200 }));
    await expect(fetchPage('https://x.dk', { fetchImpl: fetchImpl as never })).resolves.toBe(html);

    const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    const headers = init.headers as Record<string, string>;
    expect(headers['User-Agent']).toContain('Mozilla/5.0');
    expect(headers['Accept-Language']).toContain('da-DK');
    expect(init.redirect).toBe('follow');
  });

  it('asks each shop in its own language', async () => {
    const fetchImpl = vi.fn(async () => new Response(html, { status: 200 }));
    await fetchPage('https://www.csmegastore.no/i/1/x', {
      acceptLanguage: 'nb-NO,nb;q=0.9',
      fetchImpl: fetchImpl as never,
    });

    const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>)['Accept-Language']).toContain('nb-NO');
  });

  it('retries a transient server error and succeeds', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response(html, { status: 200 }));

    await expect(
      fetchPage('https://x.dk', { fetchImpl: fetchImpl as never, sleep: noSleep }),
    ).resolves.toBe(html);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('retries network errors too', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(new Response(html, { status: 200 }));

    await expect(
      fetchPage('https://x.dk', { fetchImpl: fetchImpl as never, sleep: noSleep }),
    ).resolves.toBe(html);
  });

  it('gives up after the configured attempts and reports the last error', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 500 }));
    await expect(
      fetchPage('https://x.dk', { attempts: 3, fetchImpl: fetchImpl as never, sleep: noSleep }),
    ).rejects.toThrow('failed after 3 attempts: HTTP 500');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('backs off progressively between attempts', async () => {
    const waits: number[] = [];
    const fetchImpl = vi.fn(async () => new Response('', { status: 500 }));
    await fetchPage('https://x.dk', {
      attempts: 3,
      fetchImpl: fetchImpl as never,
      sleep: async (ms) => void waits.push(ms),
    }).catch(() => {});
    expect(waits).toEqual([2000, 4000]);
  });
});
