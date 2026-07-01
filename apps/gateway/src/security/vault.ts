import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto';

/**
 * Encrypted payload produced by envelope encryption. Only these fields are
 * persisted; the plaintext provider key never touches disk.
 */
export interface EncryptedSecret {
  ciphertext: string; // base64
  iv: string; // base64
  authTag: string; // base64
  encryptedDek: string; // base64 (data key wrapped by the master key)
}

/**
 * KMS-ready abstraction. The envelope implementation below wraps a per-secret
 * data-encryption-key (DEK) with a master key from env. Swapping to AWS
 * KMS/Vault means implementing this same interface without touching callers.
 */
export interface KeyVault {
  encrypt(plaintext: string): EncryptedSecret;
  decrypt(secret: EncryptedSecret): string;
}

const ALGO = 'aes-256-gcm';

export class EnvelopeKeyVault implements KeyVault {
  private readonly masterKey: Buffer;

  constructor(masterKeyBase64: string) {
    const key = Buffer.from(masterKeyBase64, 'base64');
    if (key.length !== 32) {
      throw new Error(
        'MASTER_ENCRYPTION_KEY must be 32 bytes (base64). Generate: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
      );
    }
    this.masterKey = key;
  }

  encrypt(plaintext: string): EncryptedSecret {
    // 1. Generate a fresh DEK for this secret.
    const dek = randomBytes(32);
    const iv = randomBytes(12);

    // 2. Encrypt the plaintext with the DEK.
    const cipher = createCipheriv(ALGO, dek, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // 3. Wrap (encrypt) the DEK with the master key.
    const dekIv = randomBytes(12);
    const dekCipher = createCipheriv(ALGO, this.masterKey, dekIv);
    const wrappedDek = Buffer.concat([dekCipher.update(dek), dekCipher.final()]);
    const dekAuthTag = dekCipher.getAuthTag();
    // encryptedDek = dekIv | dekAuthTag | wrappedDek
    const encryptedDek = Buffer.concat([dekIv, dekAuthTag, wrappedDek]);

    return {
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      encryptedDek: encryptedDek.toString('base64'),
    };
  }

  decrypt(secret: EncryptedSecret): string {
    // 1. Unwrap the DEK with the master key.
    const enc = Buffer.from(secret.encryptedDek, 'base64');
    const dekIv = enc.subarray(0, 12);
    const dekAuthTag = enc.subarray(12, 28);
    const wrappedDek = enc.subarray(28);
    const dekDecipher = createDecipheriv(ALGO, this.masterKey, dekIv);
    dekDecipher.setAuthTag(dekAuthTag);
    const dek = Buffer.concat([dekDecipher.update(wrappedDek), dekDecipher.final()]);

    // 2. Decrypt the ciphertext with the DEK.
    const decipher = createDecipheriv(ALGO, dek, Buffer.from(secret.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(secret.authTag, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(secret.ciphertext, 'base64')),
      decipher.final(),
    ]);
    return plaintext.toString('utf8');
  }
}
