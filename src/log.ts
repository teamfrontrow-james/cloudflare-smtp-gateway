/** App logging (pino, with secret redaction) + an in-memory recent-send log. */
import { pino } from 'pino';
import { getConfig } from './config.js';

export const logger = pino({
  level: getConfig().logLevel,
  redact: {
    paths: [
      'cfApiToken',
      'httpToken',
      'adminPassword',
      'turnstileSecret',
      'password',
      'authorization',
      'req.headers.authorization',
      '*.password',
    ],
    censor: '[redacted]',
  },
});

export type SendOutcome = 'delivered' | 'queued' | 'bounced' | 'rejected' | 'error';

export interface SendLogEntry {
  id: string;
  at: string; // ISO timestamp
  via: 'smtp' | 'http' | 'admin-test';
  from: string;
  to: string[];
  subject: string;
  outcome: SendOutcome;
  detail?: string;
}

const RING_SIZE = 200;
const ring: SendLogEntry[] = [];

export function recordSend(entry: Omit<SendLogEntry, 'id' | 'at'>): SendLogEntry {
  const full: SendLogEntry = {
    ...entry,
    id: Math.random().toString(36).slice(2, 10),
    at: new Date().toISOString(),
  };
  ring.push(full);
  if (ring.length > RING_SIZE) ring.shift();
  return full;
}

/** Most recent first. */
export function recentSends(limit = 50): SendLogEntry[] {
  return ring.slice(-limit).reverse();
}
