/**
 * Cloudflare API client.
 *
 * - send(): Cloudflare Email Service REST API. Request/response shape is the
 *   documented contract:
 *     POST /accounts/{account_id}/email/sending/send
 *     -> { success, errors[], result: { delivered[], queued[], permanent_bounces[] } }
 *
 * - The DNS + sending-domain helpers power the OPTIONAL one-click domain setup in
 *   the admin UI. Email Service is in beta; the exact domain-management paths may
 *   shift, so those calls degrade gracefully (return null / 'unknown') instead of
 *   throwing, and the UI always falls back to manual DNS instructions.
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

// ── Optional domain/DNS helpers (best-effort; see file header) ────────────────

export interface RequiredDnsRecord {
  type: 'TXT' | 'MX' | 'CNAME';
  name: string;
  content: string;
  priority?: number;
  note: string;
}

export interface SendingDomainStatus {
  domain: string;
  status: 'verified' | 'pending' | 'unknown' | 'not_found';
  records: RequiredDnsRecord[];
}

interface ZoneSummary {
  id: string;
  name: string;
}

export async function findZoneId(domain: string): Promise<string | null> {
  try {
    const body = await cfFetch<ZoneSummary[]>(`/zones?name=${encodeURIComponent(domain)}`);
    return body.result[0]?.id ?? null;
  } catch {
    return null;
  }
}

export async function createDnsRecord(zoneId: string, record: RequiredDnsRecord): Promise<void> {
  await cfFetch(`/zones/${zoneId}/dns_records`, {
    method: 'POST',
    body: JSON.stringify({
      type: record.type,
      name: record.name,
      content: record.content,
      ...(record.priority !== undefined ? { priority: record.priority } : {}),
      comment: 'Added by cloudflare-smtp-gateway',
    }),
  });
}

/**
 * Fetch the sending domain's verification status + the DNS records Cloudflare
 * requires. Email Service returns the exact DKIM selector/bounce target per
 * domain, so we surface whatever it gives us. Returns 'unknown' if the beta
 * endpoint shape differs, so the UI can fall back to its documentation link.
 */
export async function getSendingDomain(domain: string): Promise<SendingDomainStatus> {
  const { cfAccountId } = getConfig();
  try {
    const body = await cfFetch<unknown>(
      `/accounts/${cfAccountId}/email/sending/domains/${encodeURIComponent(domain)}`,
    );
    const r = body.result as Record<string, unknown> | null;
    if (!r) return { domain, status: 'not_found', records: [] };
    const status =
      r.verified === true || r.status === 'verified'
        ? 'verified'
        : ('pending' as const);
    const records = Array.isArray(r.dns_records)
      ? (r.dns_records as Record<string, unknown>[]).map(
          (d): RequiredDnsRecord => ({
            type: (d.type as RequiredDnsRecord['type']) ?? 'TXT',
            name: String(d.name ?? ''),
            content: String(d.value ?? d.content ?? ''),
            priority: typeof d.priority === 'number' ? d.priority : undefined,
            note: String(d.purpose ?? d.note ?? ''),
          }),
        )
      : [];
    return { domain, status, records };
  } catch {
    return { domain, status: 'unknown', records: [] };
  }
}
