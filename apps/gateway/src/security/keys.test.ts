import { describe, it, expect } from 'vitest';
import { generateGatewayKey, hashGatewayKey, safeHashEqual, extractBearer } from './keys.js';

describe('gateway key generation', () => {
  it('generates a key with sk-rtr- prefix and matching hash', () => {
    const { plaintext, hash, prefix } = generateGatewayKey();
    expect(plaintext.startsWith('sk-rtr-')).toBe(true);
    expect(hashGatewayKey(plaintext)).toBe(hash);
    expect(prefix).toBe(plaintext.slice(0, 12));
  });

  it('two generated keys are different', () => {
    const a = generateGatewayKey();
    const b = generateGatewayKey();
    expect(a.plaintext).not.toBe(b.plaintext);
  });
});

describe('safeHashEqual', () => {
  it('true for identical hashes', () => {
    const h = hashGatewayKey('abc');
    expect(safeHashEqual(h, h)).toBe(true);
  });

  it('false for different hashes', () => {
    expect(safeHashEqual(hashGatewayKey('abc'), hashGatewayKey('def'))).toBe(false);
  });
});

describe('extractBearer', () => {
  it('extracts token from Bearer header', () => {
    expect(extractBearer('Bearer sk-rtr-abc')).toBe('sk-rtr-abc');
  });
  it('is case-insensitive on scheme', () => {
    expect(extractBearer('bearer sk-rtr-abc')).toBe('sk-rtr-abc');
  });
  it('returns null when missing or malformed', () => {
    expect(extractBearer(undefined)).toBeNull();
    expect(extractBearer('Basic abc')).toBeNull();
  });
});
