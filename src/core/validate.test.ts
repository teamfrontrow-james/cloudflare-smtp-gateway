import { describe, it, expect } from 'vitest';
import {
  isSenderAllowed,
  isRecipientAllowed,
  validateMessage,
  ValidationError,
  domainOf,
  type NormalizedMessage,
} from './validate.js';

describe('domainOf', () => {
  it('extracts and lowercases the domain', () => {
    expect(domainOf('User@Example.COM')).toBe('example.com');
    expect(domainOf('not-an-email')).toBeNull();
  });
});

describe('isSenderAllowed (anti-spoofing)', () => {
  it('fails closed when no allowlist configured', () => {
    expect(isSenderAllowed('a@b.com', [])).toBe(false);
  });
  it('allows any mailbox on a bare-domain entry', () => {
    expect(isSenderAllowed('hi@example.com', ['example.com'])).toBe(true);
    expect(isSenderAllowed('hi@evil.com', ['example.com'])).toBe(false);
  });
  it('pins exactly on a full-address entry', () => {
    expect(isSenderAllowed('noreply@example.com', ['noreply@example.com'])).toBe(true);
    expect(isSenderAllowed('other@example.com', ['noreply@example.com'])).toBe(false);
  });
  it('tolerates a leading @ on domain entries', () => {
    expect(isSenderAllowed('x@example.com', ['@example.com'])).toBe(true);
  });
});

describe('isRecipientAllowed', () => {
  it('allows all when both lists empty', () => {
    expect(isRecipientAllowed('a@b.com', [], [])).toBe(true);
  });
  it('allowlist takes precedence', () => {
    expect(isRecipientAllowed('a@b.com', ['@b.com'], ['a@b.com'])).toBe(true);
    expect(isRecipientAllowed('a@c.com', ['@b.com'], [])).toBe(false);
  });
  it('denylist blocks matching domains/addresses', () => {
    expect(isRecipientAllowed('a@spam.com', [], ['@spam.com'])).toBe(false);
    expect(isRecipientAllowed('a@ok.com', [], ['@spam.com'])).toBe(true);
  });
});

const base = (over: Partial<NormalizedMessage> = {}): NormalizedMessage => ({
  to: ['dest@dest.com'],
  from: { address: 'noreply@example.com' },
  subject: 'hi',
  text: 'body',
  ...over,
});

describe('validateMessage', () => {
  const opts = { allowedFrom: ['example.com'], recipientAllowlist: [], recipientDenylist: [] };

  it('passes a good message', () => {
    expect(() => validateMessage(base(), opts)).not.toThrow();
  });
  it('rejects a spoofed sender', () => {
    expect(() => validateMessage(base({ from: { address: 'x@evil.com' } }), opts)).toThrowError(
      ValidationError,
    );
    try {
      validateMessage(base({ from: { address: 'x@evil.com' } }), opts);
    } catch (e) {
      expect((e as ValidationError).code).toBe('forbidden_sender');
    }
  });
  it('requires a body', () => {
    expect(() => validateMessage(base({ text: undefined, html: undefined }), opts)).toThrowError(
      /html.*text|body/i,
    );
  });
  it('rejects invalid recipients', () => {
    expect(() => validateMessage(base({ to: ['nope'] }), opts)).toThrowError(ValidationError);
  });
  it('enforces recipient denylist', () => {
    expect(() =>
      validateMessage(base({ to: ['a@spam.com'] }), { ...opts, recipientDenylist: ['@spam.com'] }),
    ).toThrowError(/policy/i);
  });
});
