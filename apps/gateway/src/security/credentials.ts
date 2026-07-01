import type { Provider } from '@router/core';
import type { CredentialStore } from '../stores/types.js';
import type { KeyVault } from '../security/vault.js';

/**
 * Resolves and decrypts a workspace's upstream provider API key. The
 * plaintext key is returned only in-memory for the duration of the call; it
 * must never be logged, cached, or returned to the client.
 */
export class CredentialResolver {
  constructor(
    private readonly credentials: CredentialStore,
    private readonly vault: KeyVault,
  ) {}

  async resolve(workspaceId: string, provider: Provider): Promise<string> {
    const stored = await this.credentials.getForProvider(workspaceId, provider);
    if (!stored) {
      throw new MissingCredentialError(provider);
    }
    return this.vault.decrypt(stored);
  }
}

export class MissingCredentialError extends Error {
  constructor(readonly provider: Provider) {
    super(`No credential configured for provider: ${provider}`);
    this.name = 'MissingCredentialError';
  }
}
