/**
 * SMTP front door. Accepts authenticated SMTP submissions (e.g. from WP Mail
 * SMTP), parses the message, and hands it to the shared send core. No anonymous
 * relay: AUTH is always required.
 */
import { readFileSync } from 'node:fs';
import { SMTPServer, type SMTPServerOptions } from 'smtp-server';
import { simpleParser, type AddressObject } from 'mailparser';
import { getConfig } from '../config.js';
import { logger } from '../log.js';
import { safeEqual } from '../util.js';
import { sendMessage, RateLimitError, ValidationError, CloudflareError } from '../core/send.js';
import type { NormalizedMessage } from '../core/validate.js';

function addressList(obj: AddressObject | AddressObject[] | undefined): string[] {
  if (!obj) return [];
  const arr = Array.isArray(obj) ? obj : [obj];
  return arr.flatMap((a) => a.value.map((v) => v.address ?? '').filter(Boolean));
}

function authenticate(username: string, password: string): boolean {
  const users = getConfig().smtpUsers;
  // Compare against every configured user (constant-ish) and OR the result.
  let ok = false;
  for (const u of users) {
    if (safeEqual(u.username, username) && safeEqual(u.password, password)) ok = true;
  }
  return ok;
}

export function createSmtpServer(): SMTPServer {
  const cfg = getConfig();

  const options: SMTPServerOptions = {
    name: 'cloudflare-smtp-gateway',
    banner: 'cloudflare-smtp-gateway SMTP relay for Cloudflare Email Service',
    authMethods: ['PLAIN', 'LOGIN'],
    // STARTTLS is offered; AUTH is allowed only after upgrade unless on localhost.
    allowInsecureAuth: cfg.bindHost === '127.0.0.1' || cfg.bindHost === 'localhost',
    disabledCommands: [],
    size: 5 * 1024 * 1024, // Cloudflare Email Service caps messages at 5 MiB.

    onAuth(auth, _session, callback) {
      if (auth.username && auth.password && authenticate(auth.username, auth.password)) {
        callback(null, { user: auth.username });
      } else {
        callback(new Error('Invalid username or password'));
      }
    },

    onData(stream, session, callback) {
      simpleParser(stream)
        .then(async (parsed) => {
          const headerTo = addressList(parsed.to);
          const headerCc = addressList(parsed.cc);
          // The envelope (RCPT TO) is the true delivery list; anything in it that
          // isn't a visible To/Cc recipient is a BCC.
          const envelope = session.envelope.rcptTo.map((r) => r.address);
          const visible = new Set([...headerTo, ...headerCc].map((a) => a.toLowerCase()));
          const bcc = envelope.filter((a) => !visible.has(a.toLowerCase()));

          const fromAddr = parsed.from?.value[0];
          const replyTo = addressList(parsed.replyTo)[0];
          // Prefer the header From; fall back to the envelope MAIL FROM address.
          const envelopeFrom = session.envelope.mailFrom ? session.envelope.mailFrom.address : '';
          const fromAddress = fromAddr?.address ?? envelopeFrom;

          const msg: NormalizedMessage = {
            to: headerTo.length ? headerTo : envelope,
            from: {
              address: fromAddress,
              ...(fromAddr?.name ? { name: fromAddr.name } : {}),
            },
            subject: parsed.subject ?? '',
            ...(parsed.html ? { html: parsed.html } : {}),
            ...(parsed.text ? { text: parsed.text } : {}),
            ...(headerCc.length ? { cc: headerCc } : {}),
            ...(bcc.length ? { bcc } : {}),
            ...(replyTo ? { reply_to: replyTo } : {}),
            ...(parsed.attachments.length
              ? {
                  attachments: parsed.attachments.map((a) => ({
                    content: a.content.toString('base64'),
                    filename: a.filename ?? 'attachment',
                    ...(a.contentType ? { type: a.contentType } : {}),
                    ...(a.contentDisposition ? { disposition: a.contentDisposition } : {}),
                  })),
                }
              : {}),
          };

          await sendMessage(msg, { via: 'smtp', rateKey: session.user ?? session.remoteAddress });
          callback();
        })
        .catch((err: unknown) => {
          callback(toSmtpError(err));
        });
    },
  };

  if (cfg.tlsCertPath && cfg.tlsKeyPath) {
    options.key = readFileSync(cfg.tlsKeyPath);
    options.cert = readFileSync(cfg.tlsCertPath);
  }

  const server = new SMTPServer(options);
  server.on('error', (err) => logger.error({ err }, 'SMTP server error'));
  return server;
}

/** Map internal errors to SMTP responses with appropriate 4xx/5xx codes. */
function toSmtpError(err: unknown): Error & { responseCode?: number } {
  if (err instanceof RateLimitError) {
    return Object.assign(new Error(`Rate limit exceeded; retry in ${err.retryAfterSeconds}s`), {
      responseCode: 451, // temporary — client may retry later
    });
  }
  if (err instanceof ValidationError) {
    return Object.assign(new Error(err.message), { responseCode: 550 }); // permanent reject
  }
  if (err instanceof CloudflareError) {
    // 5xx from Cloudflare -> permanent; 4xx/network -> temporary.
    const code = err.status >= 500 || err.status === 0 ? 451 : 550;
    return Object.assign(new Error(`Upstream: ${err.message}`), { responseCode: code });
  }
  return Object.assign(new Error('Failed to process message'), { responseCode: 451 });
}
