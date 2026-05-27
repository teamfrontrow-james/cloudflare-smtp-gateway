/**
 * The single send path shared by the SMTP server, the HTTP /send route and the
 * admin test-send button. Every message in the gateway goes through here, so all
 * policy (sender pinning, recipient rules, rate limits) and logging live in one place.
 */
import { getConfig } from '../config.js';
import { send as cfSend, CloudflareError, type CfSendRequest } from '../cloudflare.js';
import { recordSend, logger, type SendOutcome } from '../log.js';
import { validateMessage, ValidationError, type NormalizedMessage } from './validate.js';
import { checkRateLimit } from './ratelimit.js';

export class RateLimitError extends Error {
  constructor(message: string, readonly retryAfterSeconds: number) {
    super(message);
    this.name = 'RateLimitError';
  }
}

export interface SendContext {
  via: 'smtp' | 'http' | 'admin-test';
  /** Stable key for rate limiting: the SMTP username, HTTP token id, or client IP. */
  rateKey: string;
}

export interface SendSummary {
  id: string;
  outcome: SendOutcome;
  delivered: string[];
  queued: string[];
  bounced: string[];
}

function toCfRequest(msg: NormalizedMessage): CfSendRequest {
  return {
    to: msg.to,
    from: msg.from.name ? { address: msg.from.address, name: msg.from.name } : msg.from.address,
    subject: msg.subject,
    ...(msg.html ? { html: msg.html } : {}),
    ...(msg.text ? { text: msg.text } : {}),
    ...(msg.cc?.length ? { cc: msg.cc } : {}),
    ...(msg.bcc?.length ? { bcc: msg.bcc } : {}),
    ...(msg.reply_to ? { reply_to: msg.reply_to } : {}),
    ...(msg.headers ? { headers: msg.headers } : {}),
    ...(msg.attachments?.length ? { attachments: msg.attachments } : {}),
  };
}

/**
 * Validate, rate-limit, send via Cloudflare, and log. Throws:
 *   - ValidationError   (bad payload / forbidden sender or recipient)
 *   - RateLimitError    (over the configured limit)
 *   - CloudflareError   (upstream rejected/failed)
 */
export async function sendMessage(msg: NormalizedMessage, ctx: SendContext): Promise<SendSummary> {
  const cfg = getConfig();

  const valid = validateMessage(msg, {
    allowedFrom: cfg.allowedFrom,
    recipientAllowlist: cfg.recipientAllowlist,
    recipientDenylist: cfg.recipientDenylist,
  });

  const rl = checkRateLimit(`${ctx.via}:${ctx.rateKey}`, {
    perMinute: cfg.rateLimitPerMinute,
    perDay: cfg.rateLimitPerDay,
  });
  if (!rl.allowed) {
    logRejected(valid, ctx, `rate limit (${rl.scope})`);
    throw new RateLimitError(`Rate limit exceeded (${rl.scope}).`, rl.retryAfterSeconds ?? 60);
  }

  try {
    const result = await cfSend(toCfRequest(valid));
    const outcome: SendOutcome =
      result.permanent_bounces.length > 0 && result.delivered.length === 0 && result.queued.length === 0
        ? 'bounced'
        : result.queued.length > 0 && result.delivered.length === 0
          ? 'queued'
          : 'delivered';
    const entry = recordSend({
      via: ctx.via,
      from: valid.from.address,
      to: valid.to,
      subject: valid.subject,
      outcome,
      ...(result.permanent_bounces.length ? { detail: `bounced: ${result.permanent_bounces.join(', ')}` } : {}),
    });
    logger.info({ id: entry.id, via: ctx.via, outcome, to: valid.to }, 'message sent');
    return {
      id: entry.id,
      outcome,
      delivered: result.delivered,
      queued: result.queued,
      bounced: result.permanent_bounces,
    };
  } catch (err) {
    const detail = err instanceof CloudflareError ? err.message : String(err);
    logRejected(valid, ctx, detail);
    throw err;
  }
}

function logRejected(msg: NormalizedMessage, ctx: SendContext, detail: string): void {
  const entry = recordSend({
    via: ctx.via,
    from: msg.from.address,
    to: msg.to,
    subject: msg.subject,
    outcome: 'error',
    detail,
  });
  logger.warn({ id: entry.id, via: ctx.via, detail }, 'message not sent');
}

export { ValidationError, CloudflareError };
