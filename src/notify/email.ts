import nodemailer from 'nodemailer';
import type { Notification } from '../decide.js';

export interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  to: string[];
}

export interface MailTransport {
  sendMail(message: {
    from: string;
    to: string;
    subject: string;
    text: string;
  }): Promise<unknown>;
}

export function createTransport(config: EmailConfig): MailTransport {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.pass },
  });
}

export async function sendEmail(
  config: EmailConfig,
  notification: Notification,
  transport: MailTransport = createTransport(config),
): Promise<void> {
  const prefix = notification.kind === 'broken' ? '⚠️' : '🚨';
  await transport.sendMail({
    from: config.from,
    to: config.to.join(', '),
    subject: `${prefix} ${notification.title}`,
    text: `${notification.body}\n\n${notification.url}\n`,
  });
}
