import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendMock = vi.fn();
const configMock = {
  allowedFrom: ['example.com'],
  recipientAllowlist: [] as string[],
  recipientDenylist: [] as string[],
  rateLimitPerMinute: 1000,
  rateLimitPerDay: 1000,
  logLevel: 'silent',
};

class FakeCloudflareError extends Error {
  constructor(message: string, readonly status = 0) {
    super(message);
  }
}

vi.mock('../config.js', () => ({ getConfig: () => configMock }));
vi.mock('../cloudflare.js', () => ({ send: sendMock, CloudflareError: FakeCloudflareError }));

const { sendMessage, ValidationError, RateLimitError } = await import('./send.js');
const { _resetRateLimiter } = await import('./ratelimit.js');

const msg = {
  to: ['dest@dest.com'],
  from: { address: 'noreply@example.com' },
  subject: 'hi',
  text: 'body',
};

describe('sendMessage', () => {
  beforeEach(() => {
    sendMock.mockReset();
    _resetRateLimiter();
    configMock.rateLimitPerMinute = 1000;
  });

  it('maps a delivered result', async () => {
    sendMock.mockResolvedValue({ delivered: ['dest@dest.com'], queued: [], permanent_bounces: [] });
    const out = await sendMessage(msg, { via: 'http', rateKey: 'ip1' });
    expect(out.outcome).toBe('delivered');
    expect(sendMock).toHaveBeenCalledOnce();
  });

  it('maps a queued-only result', async () => {
    sendMock.mockResolvedValue({ delivered: [], queued: ['dest@dest.com'], permanent_bounces: [] });
    const out = await sendMessage(msg, { via: 'http', rateKey: 'ip1' });
    expect(out.outcome).toBe('queued');
  });

  it('rejects a spoofed sender before calling Cloudflare', async () => {
    await expect(
      sendMessage({ ...msg, from: { address: 'x@evil.com' } }, { via: 'http', rateKey: 'ip1' }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('enforces the rate limit', async () => {
    sendMock.mockResolvedValue({ delivered: ['dest@dest.com'], queued: [], permanent_bounces: [] });
    configMock.rateLimitPerMinute = 1;
    await sendMessage(msg, { via: 'http', rateKey: 'ipX' });
    await expect(sendMessage(msg, { via: 'http', rateKey: 'ipX' })).rejects.toBeInstanceOf(RateLimitError);
  });
});
