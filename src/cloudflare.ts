/**
 * Cloudflare API client.
 *
 * - send(): Cloudflare Email Service REST API. Request/response shape is the
 *   documented contract:
 *     POST /accounts/{account_id}/email/sending/send
 *     -> { success, errors[], result: { delivered[], queued[], permanent_bounces[] } }
 *
 * - verifyCredentials(): cheap token/account check for the admin UI Setup tab.
 *
 * Sending-domain onboarding is dashboard-only (no public API), so it lives in the
 * Cloudflare dashboard, not here.
 */
import { getConfig } from './config.js';

const API_BASE = 'https://api.cloudflare.com/client/v4';

export interface CfNormalizedAddress {
  address: string;
  name?: string;
}

export interface CfSendRequest {
  to: string | string[];
  from: string | CfNormalizedAddress;
  subject: string;
  html?: string;
  text?: string;
  cc?: string[];
  bcc?: string[];
  reply_to?: string;
  headers?: Record<string, string>;
  attachments?: {
    content: string; // base64
    filename: string;
    type?: string;
    disposition?: string;
  }[];
}

export interface CfSendResult {
  delivered: string[];
  queued: string[];
  permanent_bounces: string[];
}

interface CfEnvelope<T> {
  success: boolean;
  errors: { code: number; message: string }[];
  messages: unknown[];
  result: T;
}

export class CloudflareError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly cfErrors: { code: number; message: string }[] = [],
  ) {
    super(message);
    this.name = 'CloudflareError';
  }
}

function authHeaders(): Record<string, string> {
  const { cfApiToken } = getConfig();
  return {
    Authorization: `Bearer ${cfApiToken}`,
    'Content-Type': 'application/json',
  };
}

async function cfFetch<T>(path: string, init?: RequestInit): Promise<CfEnvelope<T>> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { ...authHeaders(), ...(init?.headers ?? {}) },
  });
  let body: CfEnvelope<T>;
  try {
    body = (await res.json()) as CfEnvelope<T>;
  } catch {
    throw new CloudflareError(`Cloudflare returned non-JSON (HTTP ${res.status})`, res.status);
  }
  if (!res.ok || !body.success) {
    const first = body.errors?.[0];
    throw new CloudflareError(
      first ? `${first.message} (code ${first.code})` : `Cloudflare API error (HTTP ${res.status})`,
      res.status,
      body.errors ?? [],
    );
  }
  return body;
}

/** Send one message through Cloudflare Email Service. Throws CloudflareError on failure. */
export async function send(req: CfSendRequest): Promise<CfSendResult> {
  const { cfAccountId } = getConfig();
  const body = await cfFetch<CfSendResult>(
    `/accounts/${cfAccountId}/email/sending/send`,
    { method: 'POST', body: JSON.stringify(req) },
  );
  return body.result;
}

/** Verify the configured token + account by hitting a cheap endpoint. */
export async function verifyCredentials(): Promise<{ ok: boolean; detail: string }> {
  const { cfAccountId, cfApiToken } = getConfig();
  if (!cfApiToken || !cfAccountId) {
    return { ok: false, detail: 'Missing API token or account ID.' };
  }
  try {
    await cfFetch(`/accounts/${cfAccountId}/tokens/verify`).catch(async () => {
      // Fall back to the global token-verify endpoint if the account-scoped one isn't available.
      await cfFetch('/user/tokens/verify');
    });
    return { ok: true, detail: 'Token and account verified.' };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : 'Verification failed.' };
  }
}

// Note: Cloudflare Email Service domain onboarding (SPF/DKIM/DMARC + bounce MX)
// is performed in the Cloudflare dashboard — there is no public REST API for it —
// so the admin UI links users to dash.cloudflare.com/<account>/email-service/sending
// rather than attempting to manage domains/DNS here.
