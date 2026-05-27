#!/usr/bin/env node
/** Entrypoint: load config, start the SMTP + HTTP servers, handle shutdown. */
import { loadConfig } from './config.js';
import { logger } from './log.js';
import { createSmtpServer } from './smtp/server.js';
import { buildHttpServer } from './http/server.js';

async function main(): Promise<void> {
  const cfg = loadConfig();

  // SMTP
  const smtp = createSmtpServer();
  await new Promise<void>((resolve, reject) => {
    smtp.listen(cfg.smtpPort, cfg.bindHost, () => resolve());
    smtp.on('error', reject);
  });
  logger.info({ port: cfg.smtpPort, host: cfg.bindHost, users: cfg.smtpUsers.length }, 'SMTP listening');

  // HTTP (+ admin UI). The admin UI is always password-gated; ADMIN_LOCALHOST_ONLY
  // is enforced by keeping BIND_HOST local (documented), since /send and the admin
  // UI share one port.
  const http = await buildHttpServer();
  await http.listen({ port: cfg.httpPort, host: cfg.bindHost });
  logger.info(
    { port: cfg.httpPort, host: cfg.bindHost, admin: Boolean(cfg.adminPassword), httpSend: Boolean(cfg.httpToken) },
    'HTTP listening',
  );

  if (cfg.allowedFrom.length === 0) {
    logger.warn('ALLOWED_FROM is empty — all sends will be rejected until you set an allowed sender domain.');
  }
  if (!cfg.cfApiToken || !cfg.cfAccountId) {
    logger.warn('Cloudflare credentials not set — configure them via env or the admin UI before sending.');
  }

  const shutdown = async (sig: string): Promise<void> => {
    logger.info({ sig }, 'shutting down');
    await Promise.allSettled([
      http.close(),
      new Promise<void>((r) => smtp.close(() => r())),
    ]);
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error({ err }, 'failed to start');
  process.exit(1);
});
