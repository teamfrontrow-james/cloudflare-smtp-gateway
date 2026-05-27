/**
 * HTTP front door (Fastify). Serves:
 *   - GET  /health           liveness
 *   - POST /send             the JSON send API (bearer-gated)        [sendRoute.ts]
 *   - /admin, /admin/api/*   the admin web UI + its API              [admin/router.ts]
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyCookie from '@fastify/cookie';
import { getConfig } from '../config.js';
import { logger } from '../log.js';
import { registerSendRoute } from './sendRoute.js';
import { registerAdminRoutes } from '../admin/router.js';

const uiDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'admin', 'ui');

/** Minimal CORS for the browser-facing endpoints, gated by ALLOWED_ORIGINS. */
function corsHook(app: FastifyInstance): void {
  app.addHook('onRequest', async (req, reply) => {
    const origins = getConfig().allowedOrigins;
    const origin = req.headers.origin;
    if (origin && origins.includes(origin)) {
      reply.header('Access-Control-Allow-Origin', origin);
      reply.header('Vary', 'Origin');
      reply.header('Access-Control-Allow-Headers', 'authorization,content-type');
      reply.header('Access-Control-Allow-Methods', 'POST,GET,OPTIONS');
    }
    if (req.method === 'OPTIONS') {
      reply.code(204).send();
    }
  });
}

export async function buildHttpServer(): Promise<FastifyInstance> {
  const cfg = getConfig();
  const app = Fastify({
    logger: false, // we use our own pino instance
    bodyLimit: 6 * 1024 * 1024, // a little over CF's 5 MiB message cap (base64 overhead)
    trustProxy: true,
  });

  await app.register(fastifyCookie);
  corsHook(app);

  app.get('/health', async () => ({
    ok: true,
    service: 'cloudflare-smtp-gateway',
    smtp: cfg.smtpPort,
    adminEnabled: Boolean(cfg.adminPassword),
  }));

  await registerSendRoute(app);

  // Admin UI (static) + admin API. Disabled entirely when no ADMIN_PASSWORD is set.
  if (cfg.adminPassword) {
    await app.register(fastifyStatic, { root: uiDir, prefix: '/admin/', decorateReply: false });
    await registerAdminRoutes(app);
    app.get('/', async (_req, reply) => reply.redirect('/admin/'));
  } else {
    app.get('/', async () => ({
      ok: true,
      service: 'cloudflare-smtp-gateway',
      note: 'Admin UI disabled (set ADMIN_PASSWORD to enable).',
    }));
  }

  app.setErrorHandler((err, _req, reply) => {
    logger.error({ err }, 'unhandled HTTP error');
    reply.code(500).send({ error: 'Internal error.' });
  });

  return app;
}
