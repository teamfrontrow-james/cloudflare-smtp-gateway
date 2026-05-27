/**
 * Admin API behind the web UI. Password-gated via a signed, HMAC-based session
 * cookie (stateless: the cookie value is an HMAC over the admin password, so it
 * invalidates automatically when the password changes).
 *
 * Secrets are never returned to the browser — GET exposes only "is it set?"
 * flags, and POST treats an empty secret field as "leave unchanged".
 */
import { createHmac } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  getConfig,
  savePersisted,
  lockedFields,
  type PersistedConfig,
  type SmtpUser,
} from '../config.js';
import { recentSends } from '../log.js';
import { safeEqual, randomToken } from '../util.js';
import { sendMessage } from '../core/send.js';
import { handleSendError } from '../http/sendRoute.js';
import * as cf from '../cloudflare.js';

const COOKIE = 'cmg_session';

function sessionToken(): string {
  return createHmac('sha256', getConfig().adminPassword).update('admin-session-v1').digest('base64url');
}

function isAuthed(req: FastifyRequest): boolean {
  const c = req.cookies[COOKIE];
  return Boolean(c && safeEqual(c, sessionToken()));
}

function requireAuth(req: FastifyRequest, reply: FastifyReply): boolean {
  if (isAuthed(req)) return true;
  reply.code(401).send({ error: 'Not authenticated.' });
  return false;
}

function configForUi() {
  const c = getConfig();
  return {
    cfAccountId: c.cfAccountId,
    cfApiTokenSet: Boolean(c.cfApiToken),
    httpTokenSet: Boolean(c.httpToken),
    allowedFrom: c.allowedFrom,
    smtpUsers: c.smtpUsers.map((u) => ({ username: u.username, passwordSet: Boolean(u.password) })),
    recipientAllowlist: c.recipientAllowlist,
    recipientDenylist: c.recipientDenylist,
    allowedOrigins: c.allowedOrigins,
    rateLimitPerMinute: c.rateLimitPerMinute,
    rateLimitPerDay: c.rateLimitPerDay,
    smtpPort: c.smtpPort,
    httpPort: c.httpPort,
    locked: lockedFields(),
  };
}

interface SaveBody {
  cfAccountId?: string;
  cfApiToken?: string;
  httpToken?: string;
  allowedFrom?: string[];
  smtpUsers?: { username: string; password?: string }[];
  recipientAllowlist?: string[];
  recipientDenylist?: string[];
  allowedOrigins?: string[];
  rateLimitPerMinute?: number;
  rateLimitPerDay?: number;
}

/** Merge incoming SMTP users with existing, preserving passwords left blank. */
function mergeSmtpUsers(incoming: { username: string; password?: string }[]): SmtpUser[] {
  const existing = new Map(getConfig().smtpUsers.map((u) => [u.username, u.password]));
  return incoming.map((u) => ({
    username: u.username,
    password: u.password && u.password.length > 0 ? u.password : (existing.get(u.username) ?? ''),
  }));
}

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  app.post('/admin/api/login', async (req, reply) => {
    const { password } = (req.body ?? {}) as { password?: string };
    if (!password || !safeEqual(password, getConfig().adminPassword)) {
      return reply.code(401).send({ error: 'Invalid password.' });
    }
    reply.setCookie(COOKIE, sessionToken(), {
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
      maxAge: 60 * 60 * 12,
    });
    return { ok: true };
  });

  app.post('/admin/api/logout', async (_req, reply) => {
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/admin/api/status', async (req) => {
    const authed = isAuthed(req);
    if (!authed) return { authed: false };
    return { authed: true, config: configForUi(), recent: recentSends(50) };
  });

  app.get('/admin/api/config', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    return configForUi();
  });

  app.post('/admin/api/config', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const b = (req.body ?? {}) as SaveBody;
    const update: PersistedConfig = {};
    if (b.cfAccountId !== undefined) update.cfAccountId = b.cfAccountId;
    if (b.cfApiToken) update.cfApiToken = b.cfApiToken; // empty = leave unchanged
    if (b.httpToken !== undefined) update.httpToken = b.httpToken;
    if (b.allowedFrom) update.allowedFrom = b.allowedFrom;
    if (b.smtpUsers) update.smtpUsers = mergeSmtpUsers(b.smtpUsers);
    if (b.recipientAllowlist) update.recipientAllowlist = b.recipientAllowlist;
    if (b.recipientDenylist) update.recipientDenylist = b.recipientDenylist;
    if (b.allowedOrigins) update.allowedOrigins = b.allowedOrigins;
    if (b.rateLimitPerMinute !== undefined) update.rateLimitPerMinute = b.rateLimitPerMinute;
    if (b.rateLimitPerDay !== undefined) update.rateLimitPerDay = b.rateLimitPerDay;
    savePersisted(update);
    return { ok: true, config: configForUi() };
  });

  app.post('/admin/api/verify-credentials', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    return cf.verifyCredentials();
  });

  app.get('/admin/api/domain', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const domain = (req.query as { domain?: string }).domain;
    if (!domain) return reply.code(400).send({ error: 'domain query param required.' });
    const status = await cf.getSendingDomain(domain);
    const zoneId = await cf.findZoneId(domain);
    return { ...status, onCloudflareDns: Boolean(zoneId) };
  });

  app.post('/admin/api/dns-apply', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const { domain } = (req.body ?? {}) as { domain?: string };
    if (!domain) return reply.code(400).send({ error: 'domain required.' });
    const zoneId = await cf.findZoneId(domain);
    if (!zoneId) {
      return reply.code(400).send({ error: 'Domain is not on Cloudflare DNS; add the records manually.' });
    }
    const status = await cf.getSendingDomain(domain);
    if (!status.records.length) {
      return reply.code(409).send({ error: 'No DNS records available from Cloudflare yet. Try again shortly.' });
    }
    const results: { name: string; ok: boolean; error?: string }[] = [];
    for (const rec of status.records) {
      try {
        await cf.createDnsRecord(zoneId, rec);
        results.push({ name: rec.name, ok: true });
      } catch (err) {
        results.push({ name: rec.name, ok: false, error: err instanceof Error ? err.message : 'failed' });
      }
    }
    return { ok: results.every((r) => r.ok), results };
  });

  app.post('/admin/api/test', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const { to, from } = (req.body ?? {}) as { to?: string; from?: string };
    if (!to) return reply.code(400).send({ error: '"to" address required.' });
    const sender = from || getConfig().allowedFrom[0] || '';
    try {
      const result = await sendMessage(
        {
          to: [to],
          from: { address: sender, name: 'cloudflare-smtp-gateway' },
          subject: 'cloudflare-smtp-gateway test email',
          text: 'This is a test message sent through cloudflare-smtp-gateway via Cloudflare Email Service.',
          html: '<p>This is a test message sent through <strong>cloudflare-smtp-gateway</strong> via Cloudflare Email Service.</p>',
        },
        { via: 'admin-test', rateKey: 'admin' },
      );
      return reply.code(200).send({ ok: true, ...result });
    } catch (err) {
      return handleSendError(err, reply);
    }
  });

  app.post('/admin/api/mint-token', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const { kind, username } = (req.body ?? {}) as { kind?: 'http' | 'smtp'; username?: string };
    if (kind === 'http') {
      const token = randomToken();
      savePersisted({ httpToken: token });
      return { ok: true, token };
    }
    if (kind === 'smtp') {
      const user = username || 'app';
      const password = randomToken();
      const others = getConfig().smtpUsers.filter((u) => u.username !== user);
      savePersisted({ smtpUsers: [...others, { username: user, password }] });
      return { ok: true, username: user, password };
    }
    return reply.code(400).send({ error: 'kind must be "http" or "smtp".' });
  });

  app.get('/admin/api/logs', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    return recentSends(100);
  });
}
