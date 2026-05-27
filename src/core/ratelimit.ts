/**
 * Simple in-memory sliding-window-ish rate limiter keyed by credential/IP.
 * Tracks a per-minute and a per-day counter per key. Good enough for a
 * single-process gateway; swap for a shared store if you ever run replicas.
 */

interface Window {
  count: number;
  resetAt: number;
}

interface KeyState {
  minute: Window;
  day: Window;
}

const state = new Map<string, KeyState>();

function freshWindow(now: number, ms: number): Window {
  return { count: 0, resetAt: now + ms };
}

export interface RateLimits {
  perMinute: number;
  perDay: number;
}

export interface RateResult {
  allowed: boolean;
  scope?: 'minute' | 'day';
  retryAfterSeconds?: number;
}

const MINUTE = 60_000;
const DAY = 86_400_000;

/** Records one attempt against `key` and reports whether it's within limits. */
export function checkRateLimit(key: string, limits: RateLimits, now = Date.now()): RateResult {
  let s = state.get(key);
  if (!s) {
    s = { minute: freshWindow(now, MINUTE), day: freshWindow(now, DAY) };
    state.set(key, s);
  }
  if (now >= s.minute.resetAt) s.minute = freshWindow(now, MINUTE);
  if (now >= s.day.resetAt) s.day = freshWindow(now, DAY);

  if (limits.perMinute > 0 && s.minute.count >= limits.perMinute) {
    return { allowed: false, scope: 'minute', retryAfterSeconds: Math.ceil((s.minute.resetAt - now) / 1000) };
  }
  if (limits.perDay > 0 && s.day.count >= limits.perDay) {
    return { allowed: false, scope: 'day', retryAfterSeconds: Math.ceil((s.day.resetAt - now) / 1000) };
  }

  s.minute.count++;
  s.day.count++;
  return { allowed: true };
}

/** Test helper. */
export function _resetRateLimiter(): void {
  state.clear();
}
