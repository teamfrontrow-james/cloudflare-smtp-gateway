import { describe, it, expect, beforeEach } from 'vitest';
import { checkRateLimit, _resetRateLimiter } from './ratelimit.js';

describe('checkRateLimit', () => {
  beforeEach(() => _resetRateLimiter());

  it('allows up to the per-minute limit then blocks', () => {
    const limits = { perMinute: 3, perDay: 100 };
    for (let i = 0; i < 3; i++) expect(checkRateLimit('k', limits).allowed).toBe(true);
    const blocked = checkRateLimit('k', limits);
    expect(blocked.allowed).toBe(false);
    expect(blocked.scope).toBe('minute');
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('resets the minute window after it elapses', () => {
    const limits = { perMinute: 1, perDay: 100 };
    const t0 = 1_000_000;
    expect(checkRateLimit('k', limits, t0).allowed).toBe(true);
    expect(checkRateLimit('k', limits, t0 + 1000).allowed).toBe(false);
    expect(checkRateLimit('k', limits, t0 + 61_000).allowed).toBe(true);
  });

  it('enforces the per-day cap independently', () => {
    const limits = { perMinute: 1000, perDay: 2 };
    const t = 5_000_000;
    expect(checkRateLimit('k', limits, t).allowed).toBe(true);
    expect(checkRateLimit('k', limits, t + 1).allowed).toBe(true);
    const blocked = checkRateLimit('k', limits, t + 2);
    expect(blocked.allowed).toBe(false);
    expect(blocked.scope).toBe('day');
  });

  it('keys are independent', () => {
    const limits = { perMinute: 1, perDay: 100 };
    expect(checkRateLimit('a', limits).allowed).toBe(true);
    expect(checkRateLimit('b', limits).allowed).toBe(true);
  });
});
