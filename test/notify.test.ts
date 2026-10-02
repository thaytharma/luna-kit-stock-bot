import { describe, expect, it, vi } from 'vitest';
import type { Notification } from '../src/decide.js';
import { sendEmail, type EmailConfig, type MailTransport } from '../src/notify/email.js';
import { sendNtfy } from '../src/notify/ntfy.js';

const restock: Notification = {
  kind: 'restock',
  title: 'På lager nu!',
  body: 'Leander Luna er på lager.\nPris: 899,95 kr.',
  url: 'https://www.kids-world.dk/leander-luna-p-261365.html',
  priority: 5,
  tags: ['rotating_light', 'baby_symbol'],
};

const ok = () => new Response('', { status: 200 });

describe('sendNtfy', () => {
  it('posts the body to the configured topic', async () => {
    const fetchMock = vi.fn(async () => ok());
    await sendNtfy({ topic: 'secret-topic', server: 'https://ntfy.sh' }, restock, fetchMock as never);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://ntfy.sh/secret-topic');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(restock.body);
  });

  it('sets priority, tags and a click-through to the product', async () => {
    const fetchMock = vi.fn(async () => ok());
    await sendNtfy({ topic: 't', server: 'https://ntfy.sh' }, restock, fetchMock as never);

    const headers = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]
      .headers as Record<string, string>;
    expect(headers.Priority).toBe('5');
    expect(headers.Tags).toBe('rotating_light,baby_symbol');
    expect(headers.Click).toBe(restock.url);
  });

  it('encodes the Danish title so the header stays latin-1 safe', async () => {
    const fetchMock = vi.fn(async () => ok());
    await sendNtfy({ topic: 't', server: 'https://ntfy.sh' }, restock, fetchMock as never);

    const headers = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]
      .headers as Record<string, string>;
    expect(headers.Title).toBe('=?UTF-8?B?UMOlIGxhZ2VyIG51IQ==?=');
    expect(Buffer.from('På lager nu!', 'utf8').toString('base64')).toBe('UMOlIGxhZ2VyIG51IQ==');
  });

  it('leaves plain ascii titles unencoded', async () => {
    const fetchMock = vi.fn(async () => ok());
    await sendNtfy(
      { topic: 't', server: 'https://ntfy.sh' },
      { ...restock, title: 'Back in stock' },
      fetchMock as never,
    );

    const headers = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]
      .headers as Record<string, string>;
    expect(headers.Title).toBe('Back in stock');
  });

  it('tolerates a trailing slash on the server url', async () => {
    const fetchMock = vi.fn(async () => ok());
    await sendNtfy({ topic: 't', server: 'https://ntfy.sh/' }, restock, fetchMock as never);
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe('https://ntfy.sh/t');
  });

  it('throws on a non-2xx response so the caller can report it', async () => {
    const fetchMock = vi.fn(async () => new Response('nope', { status: 429 }));
    await expect(
      sendNtfy({ topic: 't', server: 'https://ntfy.sh' }, restock, fetchMock as never),
    ).rejects.toThrow('HTTP 429');
  });
});

describe('sendEmail', () => {
  const config: EmailConfig = {
    host: 'smtp.example.com',
    port: 587,
    secure: false,
    user: 'bot@example.com',
    pass: 'secret',
    from: 'bot@example.com',
    to: ['thay@example.com', 'other@example.com'],
  };

  const transport = (): MailTransport & { sendMail: ReturnType<typeof vi.fn> } => ({
    sendMail: vi.fn(async () => ({})),
  });

  it('sends to every recipient with the product link in the body', async () => {
    const mail = transport();
    await sendEmail(config, restock, mail);

    expect(mail.sendMail).toHaveBeenCalledOnce();
    const message = mail.sendMail.mock.calls[0]![0];
    expect(message.to).toBe('thay@example.com, other@example.com');
    expect(message.from).toBe('bot@example.com');
    expect(message.subject).toBe('🚨 På lager nu!');
    expect(message.text).toContain(restock.url);
  });

  it('marks bot-health warnings differently from restocks', async () => {
    const mail = transport();
    await sendEmail(config, { ...restock, kind: 'broken', title: 'Stock bot may be broken' }, mail);
    expect(mail.sendMail.mock.calls[0]![0].subject).toBe('⚠️ Stock bot may be broken');
  });

  it('marks a new marketplace listing as urgent, like a restock', async () => {
    const mail = transport();
    await sendEmail(config, { ...restock, kind: 'listing', title: 'Ny annonce på finn.no' }, mail);
    expect(mail.sendMail.mock.calls[0]![0].subject).toBe('🚨 Ny annonce på finn.no');
  });

  it('propagates transport failures', async () => {
    const mail: MailTransport = {
      sendMail: vi.fn(async () => {
        throw new Error('SMTP auth failed');
      }),
    };
    await expect(sendEmail(config, restock, mail)).rejects.toThrow('SMTP auth failed');
  });
});
