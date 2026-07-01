import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Gateway API keys authenticate OUR customers to the gateway. We store only a
 * SHA-256 hash; the plaintext is shown once at creation.
 */
export function hashGatewayKey(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

export function generateGatewayKey(): {
  plaintext: string;
  hash: string;
  prefix: string;
} {
  const raw = randomBytes(24).toString('base64url');
  const plaintext = `sk-rtr-${raw}`;
  return { plaintext, hash: hashGatewayKey(plaintext), prefix: plaintext.slice(0, 12) };
}

/** Constant-time comparison of two hex-encoded hashes. */
export function safeHashEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Extract a bearer token from an Authorization header. */
export function extractBearer(header: string | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1]!.trim() : null;
}
