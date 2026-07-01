import { describe, it, expect } from 'vitest';
import { EnvelopeKeyVault } from './vault.js';

const KEY = Buffer.alloc(32, 1).toString('base64');

describe('EnvelopeKeyVault', () => {
  it('round-trips plaintext through encrypt/decrypt', () => {
    const vault = new EnvelopeKeyVault(KEY);
    const secret = vault.encrypt('sk-super-secret-provider-key');
    expect(vault.decrypt(secret)).toBe('sk-super-secret-provider-key');
  });

  it('stored ciphertext does not contain the plaintext', () => {
    const vault = new EnvelopeKeyVault(KEY);
    const plaintext = 'sk-super-secret-provider-key';
    const secret = vault.encrypt(plaintext);
    expect(secret.ciphertext).not.toContain(plaintext);
    expect(JSON.stringify(secret)).not.toContain(plaintext);
  });

  it('each encryption uses a fresh DEK/IV (ciphertext differs for same input)', () => {
    const vault = new EnvelopeKeyVault(KEY);
    const a = vault.encrypt('same-input');
    const b = vault.encrypt('same-input');
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.encryptedDek).not.toBe(b.encryptedDek);
  });

  it('rejects a master key that is not 32 bytes', () => {
    expect(() => new EnvelopeKeyVault(Buffer.alloc(16).toString('base64'))).toThrow();
  });

  it('fails to decrypt with a different master key (tamper/rotation safety)', () => {
    const vaultA = new EnvelopeKeyVault(KEY);
    const otherKey = Buffer.alloc(32, 2).toString('base64');
    const vaultB = new EnvelopeKeyVault(otherKey);
    const secret = vaultA.encrypt('secret');
    expect(() => vaultB.decrypt(secret)).toThrow();
  });
});
