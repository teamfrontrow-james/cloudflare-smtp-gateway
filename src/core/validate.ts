/** Payload validation, from-domain pinning (anti-spoofing) and recipient rules. */

export class ValidationError extends Error {
  constructor(
    message: string,
    readonly code: 'invalid' | 'forbidden_sender' | 'forbidden_recipient' = 'invalid',
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

export interface NormalizedMessage {
  to: string[];
  from: { address: string; name?: string };
  subject: string;
  html?: string;
  text?: string;
  cc?: string[];
  bcc?: string[];
  reply_to?: string;
  headers?: Record<string, string>;
  attachments?: {
    content: string;
    filename: string;
    type?: string;
    disposition?: string;
  }[];
}

const EMAIL_RE = /^[^\s@]+@([^\s@]+\.[^\s@]+)$/;

export function domainOf(address: string): string | null {
  const m = EMAIL_RE.exec(address.trim().toLowerCase());
  return m ? (m[1] ?? null) : null;
}

export function isValidEmail(address: string): boolean {
  return EMAIL_RE.test(address.trim());
}

/**
 * A sender is allowed if it matches an ALLOWED_FROM entry. Entries are matched
 * case-insensitively: a full address pins exactly; a bare domain allows any
 * mailbox at that domain.
 */
export function isSenderAllowed(address: string, allowedFrom: string[]): boolean {
  if (allowedFrom.length === 0) return false; // fail closed: never an open relay
  const addr = address.trim().toLowerCase();
  const dom = domainOf(addr);
  return allowedFrom.some((entry) => {
    const e = entry.trim().toLowerCase().replace(/^@/, '');
    if (e.includes('@')) return e === addr; // full-address pin
    return e === dom; // bare-domain allow
  });
}

/** ALLOW wins when set; otherwise DENY blocks. Empty allow + empty deny = allow all. */
export function isRecipientAllowed(
  address: string,
  allowlist: string[],
  denylist: string[],
): boolean {
  const addr = address.trim().toLowerCase();
  const dom = domainOf(addr);
  const matches = (list: string[]) =>
    list.some((entry) => {
      const e = entry.trim().toLowerCase();
      if (e.startsWith('@')) return e.slice(1) === dom;
      return e === addr;
    });

  if (allowlist.length > 0) return matches(allowlist);
  if (denylist.length > 0) return !matches(denylist);
  return true;
}

export interface ValidateOptions {
  allowedFrom: string[];
  recipientAllowlist: string[];
  recipientDenylist: string[];
}

/** Validate + enforce policy. Throws ValidationError; returns the message on success. */
export function validateMessage(
  msg: NormalizedMessage,
  opts: ValidateOptions,
): NormalizedMessage {
  if (!msg.from?.address || !isValidEmail(msg.from.address)) {
    throw new ValidationError('A valid "from" address is required.');
  }
  if (!msg.to || msg.to.length === 0) {
    throw new ValidationError('At least one "to" recipient is required.');
  }
  if (!msg.subject || msg.subject.trim() === '') {
    throw new ValidationError('A "subject" is required.');
  }
  if (!msg.html && !msg.text) {
    throw new ValidationError('Either "html" or "text" body content is required.');
  }

  const allRecipients = [...msg.to, ...(msg.cc ?? []), ...(msg.bcc ?? [])];
  for (const r of allRecipients) {
    if (!isValidEmail(r)) throw new ValidationError(`Invalid recipient address: ${r}`);
  }

  if (!isSenderAllowed(msg.from.address, opts.allowedFrom)) {
    throw new ValidationError(
      `Sender ${msg.from.address} is not permitted. It must match ALLOWED_FROM (a domain verified in Cloudflare Email Service).`,
      'forbidden_sender',
    );
  }

  for (const r of allRecipients) {
    if (!isRecipientAllowed(r, opts.recipientAllowlist, opts.recipientDenylist)) {
      throw new ValidationError(`Recipient ${r} is blocked by the recipient policy.`, 'forbidden_recipient');
    }
  }

  return msg;
}
