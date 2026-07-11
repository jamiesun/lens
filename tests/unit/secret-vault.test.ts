import { describe, expect, it } from 'vitest';
import {
  SecretVault,
  VaultError,
} from '../../src/background/secret-vault';
import { ProviderConfigSchema } from '../../src/protocol/provider';

function createMemoryStorage() {
  const local = new Map<string, unknown>();
  const session = new Map<string, unknown>();

  return {
    local,
    session,
    storage: {
      getLocal: async (key: string) => local.get(key),
      setLocalItems: async (items: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(items)) {
          local.set(key, value);
        }
      },
      removeLocalItems: async (keys: string[]) => {
        for (const key of keys) {
          local.delete(key);
        }
      },
      getSession: async (key: string) => session.get(key),
      setSession: async (key: string, value: unknown) => {
        session.set(key, value);
      },
      removeSession: async (key: string) => {
        session.delete(key);
      },
    },
  };
}

const provider = {
  baseUrl: 'https://api.example.test/',
  model: 'test-model',
};

describe('ProviderConfigSchema', () => {
  it('allows HTTPS and loopback HTTP while rejecting credential-bearing URLs', () => {
    expect(ProviderConfigSchema.safeParse(provider).success).toBe(true);
    expect(
      ProviderConfigSchema.safeParse({
        ...provider,
        baseUrl: 'http://127.0.0.1:4173/mock-openai/',
      }).success,
    ).toBe(true);
    expect(
      ProviderConfigSchema.safeParse({
        ...provider,
        baseUrl: 'http://192.168.1.20:8080/',
      }).success,
    ).toBe(false);
    expect(
      ProviderConfigSchema.safeParse({
        ...provider,
        baseUrl: 'https://user:password@api.example.test/',
      }).success,
    ).toBe(false);
  });
});

describe('SecretVault', () => {
  it('stores only ciphertext locally and decrypts through the session key', async () => {
    const memory = createMemoryStorage();
    const vault = new SecretVault(memory.storage);

    await vault.configure(provider, 'sk-secret-value', 'correct horse');

    expect(await vault.status()).toBe('unlocked');
    expect(await vault.getProvider()).toEqual(provider);
    expect(await vault.readApiKey()).toBe('sk-secret-value');

    const serializedLocal = JSON.stringify(Object.fromEntries(memory.local));
    expect(serializedLocal).not.toContain('sk-secret-value');
    expect(serializedLocal).not.toContain('correct horse');
    expect(serializedLocal).toContain('AES-GCM');
    expect(memory.session.size).toBe(1);
  });

  it('locks, rejects the wrong password, and unlocks with the right one', async () => {
    const memory = createMemoryStorage();
    const vault = new SecretVault(memory.storage);
    await vault.configure(provider, 'sk-secret-value', 'correct horse');

    await vault.lock();
    expect(await vault.status()).toBe('locked');
    await expect(vault.readApiKey()).rejects.toMatchObject({
      code: 'LOCKED',
    } satisfies Partial<VaultError>);

    await expect(vault.unlock('wrong password')).rejects.toMatchObject({
      code: 'WRONG_PASSWORD',
    } satisfies Partial<VaultError>);
    expect(await vault.status()).toBe('locked');

    await vault.unlock('correct horse');
    expect(await vault.status()).toBe('unlocked');
    expect(await vault.readApiKey()).toBe('sk-secret-value');
  });

  it('clears both persistent and session material', async () => {
    const memory = createMemoryStorage();
    const vault = new SecretVault(memory.storage);
    await vault.configure(provider, 'sk-secret-value', 'correct horse');

    await vault.clear();

    expect(await vault.status()).toBe('unconfigured');
    expect(await vault.getProvider()).toBeUndefined();
    expect(memory.local.size).toBe(0);
    expect(memory.session.size).toBe(0);
  });

  it('serializes competing mutations so lock and clear win deterministically', async () => {
    const memory = createMemoryStorage();
    const vault = new SecretVault(memory.storage);

    const configureThenLock = vault.configure(
      provider,
      'sk-first',
      'correct horse',
    );
    const lock = vault.lock();
    await Promise.all([configureThenLock, lock]);
    expect(await vault.status()).toBe('locked');

    const reconfigure = vault.configure(
      provider,
      'sk-second',
      'correct horse',
    );
    const clear = vault.clear();
    await Promise.all([reconfigure, clear]);
    expect(await vault.status()).toBe('unconfigured');
    expect(memory.local.size).toBe(0);
    expect(memory.session.size).toBe(0);
  });

  it('returns provider and API key from one atomic vault generation', async () => {
    const memory = createMemoryStorage();
    const vault = new SecretVault(memory.storage);
    await vault.configure(provider, 'old-key', 'correct horse');

    const oldCredentials = vault.readCredentials();
    const reconfigure = vault.configure(
      {
        baseUrl: 'https://new-api.example.test/',
        model: 'new-model',
      },
      'new-key',
      'correct horse',
    );

    await expect(oldCredentials).resolves.toEqual({
      provider,
      apiKey: 'old-key',
    });
    await reconfigure;
    await expect(vault.readCredentials()).resolves.toEqual({
      provider: {
        baseUrl: 'https://new-api.example.test/',
        model: 'new-model',
      },
      apiKey: 'new-key',
    });
  });
});
