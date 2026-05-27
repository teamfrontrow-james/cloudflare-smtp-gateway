import { timingSafeEqual, randomBytes } from 'node:crypto';

/** Length-safe constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) {
    // Still compare to keep timing roughly constant, but always return false.
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

/** URL-safe random token, e.g. for minting SMTP passwords / HTTP tokens. */
export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString('base64url');
}
