/** POST /send — JSON HTTP API into the shared send core. Bearer-token gated. */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getConfig } from '../config.js';
import { safeEqual } from '../util.js';
import { sendMessage, RateLimitError, ValidationError, CloudflareError } from '../core/send.js';
import type { NormalizedMessage } from '../core/validate.js';

interface SendBody {
  to?: string | string[];
  from?: string | { address: string; name?: string };
  subject?: string;
  html?: string;
  text?: string;
  cc?: string | string[];
  bcc?: string | string[];
  reply_to?: string;
  headers?: Record<string, string>;
  attachments?: { content: string; filename: string; type?: string; disposition?: string }[];
  'cf-turnstile-response'?: string;
}

function asArray(v: string | string[] | undefined): string[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

/** Parse `"Name <addr@x>"` or a bare address or an object into {address,name}. */
function parseFrom(from: SendBody['from']): { address: string; name?: string } {
  if (!from) return { address: '' };
  if (typeof from === 'object') return from;
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(from);
  if (m) return { address: (m[2] ?? '').trim(), name: (m[1] ?? '').trim() || undefined };
  return { address: from.trim() };
}

function bearer(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? (m[1] ?? null) : null;
}

async function verifyTurnstile(token: string | undefined, ip: string): Promise<boolean> {
  const secret = getConfig().turnstileSecret;
  if (!secret) return true; // not configured -> not enforced
  if (!token) return false;
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret, response: token, remoteip: ip }),
    });
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}

export async function registerSendRoute(app: FastifyInstance): Promise<void> {
  app.post('/send', async (req: FastifyRequest, reply: FastifyReply) => {
    const cfg = getConfig();

    if (!cfg.httpToken) {
      return reply.code(503).send({ error: 'HTTP send is disabled (no HTTP_TOKEN configured).' });
    }
    const token = bearer(req);
    if (!token || !safeEqual(token, cfg.httpToken)) {
      return reply.code(401).send({ error: 'Unauthorized.' });
    }

    const body = (req.body ?? {}) as SendBody;
    const ip = req.ip;

    if (!(await verifyTurnstile(body['cf-turnstile-response'], ip))) {
      return reply.code(403).send({ error: 'Turnstile verification failed.' });
    }

    const msg: NormalizedMessage = {
      to: asArray(body.to),
      from: parseFrom(body.from),
      subject: body.subject ?? '',
      ...(body.html ? { html: body.html } : {}),
      ...(body.text ? { text: body.text } : {}),
      ...(asArray(body.cc).length ? { cc: asArray(body.cc) } : {}),
      ...(asArray(body.bcc).length ? { bcc: asArray(body.bcc) } : {}),
      ...(body.reply_to ? { reply_to: body.reply_to } : {}),
      ...(body.headers ? { headers: body.headers } : {}),
      ...(body.attachments ? { attachments: body.attachments } : {}),
    };

    try {
      const result = await sendMessage(msg, { via: 'http', rateKey: ip });
      return reply.code(200).send({ ok: true, ...result });
    } catch (err) {
      return handleSendError(err, reply);
    }
  });
}

export function handleSendError(err: unknown, reply: FastifyReply): FastifyReply {
  if (err instanceof ValidationError) {
    const code = err.code === 'invalid' ? 400 : 403;
    return reply.code(code).send({ error: err.message, code: err.code });
  }
  if (err instanceof RateLimitError) {
    return reply.code(429).header('Retry-After', String(err.retryAfterSeconds)).send({ error: err.message });
  }
  if (err instanceof CloudflareError) {
    return reply.code(502).send({ error: 'Cloudflare rejected the message.', detail: err.message });
  }
  return reply.code(500).send({ error: 'Internal error sending message.' });
}
