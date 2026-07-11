import { z } from 'zod';
import {
  ProviderConfigSchema,
  type ProviderConfig,
} from '../protocol/provider';

export const EncryptedSecretSchema = z
  .object({
    version: z.literal(1),
    algorithm: z.literal('AES-GCM'),
    kdf: z.literal('PBKDF2-SHA256'),
    iterations: z.number().int().min(100_000),
    salt: z.string().min(1),
    iv: z.string().min(1),
    ciphertext: z.string().min(1),
  })
  .strict();

export type EncryptedSecret = z.infer<typeof EncryptedSecretSchema>;

export type VaultStatus = 'unconfigured' | 'locked' | 'unlocked';
export interface VaultCredentials {
  provider: ProviderConfig;
  apiKey: string;
}

export class VaultError extends Error {
  constructor(
    readonly code:
      | 'NOT_CONFIGURED'
      | 'LOCKED'
      | 'WRONG_PASSWORD'
      | 'CORRUPT_CIPHERTEXT',
    message: string,
  ) {
    super(message);
    this.name = 'VaultError';
  }
}

const PBKDF2_ITERATIONS = 600_000;

interface VaultStorage {
  getLocal: (key: string) => Promise<unknown>;
  setLocalItems: (items: Record<string, unknown>) => Promise<void>;
  removeLocalItems: (keys: string[]) => Promise<void>;
  getSession: (key: string) => Promise<unknown>;
  setSession: (key: string, value: unknown) => Promise<void>;
  removeSession: (key: string) => Promise<void>;
}

const SECRET_KEY = 'lens.vault.secret';
const PROVIDER_KEY = 'lens.vault.provider';
const SESSION_KEY = 'lens.vault.sessionKey';

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function fromBase64(encoded: string): Uint8Array {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function deriveAesKey(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: salt as BufferSource,
      iterations,
    },
    passwordKey,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );
}

async function importSessionKey(rawKey: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    rawKey as BufferSource,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );
}

export class SecretVault {
  private operationTail: Promise<void> = Promise.resolve();

  constructor(private readonly storage: VaultStorage) {}

  async status(): Promise<VaultStatus> {
    return this.exclusive(async () => {
      const secret = await this.storage.getLocal(SECRET_KEY);
      if (!EncryptedSecretSchema.safeParse(secret).success) {
        return 'unconfigured';
      }

      const sessionKey = await this.storage.getSession(SESSION_KEY);
      return typeof sessionKey === 'string' && sessionKey.length > 0
        ? 'unlocked'
        : 'locked';
    });
  }

  async getProvider(): Promise<ProviderConfig | undefined> {
    return this.exclusive(() => this.readProvider());
  }

  async readCredentials(): Promise<VaultCredentials> {
    return this.exclusive(async () => {
      const provider = await this.readProvider();
      if (!provider) {
        throw new VaultError(
          'NOT_CONFIGURED',
          'No model provider is configured.',
        );
      }
      return {
        provider,
        apiKey: await this.readApiKeyUnlocked(),
      };
    });
  }

  private async readProvider(): Promise<ProviderConfig | undefined> {
    const raw = await this.storage.getLocal(PROVIDER_KEY);
    const parsed = ProviderConfigSchema.safeParse(raw);
    return parsed.success ? parsed.data : undefined;
  }

  async configure(
    provider: ProviderConfig,
    apiKey: string,
    password: string,
  ): Promise<void> {
    return this.exclusive(async () => {
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const aesKey = await deriveAesKey(password, salt, PBKDF2_ITERATIONS);
      const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv as BufferSource },
        aesKey,
        new TextEncoder().encode(apiKey),
      );

      const secret: EncryptedSecret = {
        version: 1,
        algorithm: 'AES-GCM',
        kdf: 'PBKDF2-SHA256',
        iterations: PBKDF2_ITERATIONS,
        salt: toBase64(salt),
        iv: toBase64(iv),
        ciphertext: toBase64(new Uint8Array(ciphertext)),
      };

      await this.storage.setLocalItems({
        [SECRET_KEY]: secret,
        [PROVIDER_KEY]: provider,
      });

      const rawKey = new Uint8Array(
        await crypto.subtle.exportKey('raw', aesKey),
      );
      await this.storage.setSession(SESSION_KEY, toBase64(rawKey));
    });
  }

  async unlock(password: string): Promise<void> {
    return this.exclusive(async () => {
      const secret = await this.readSecret();
      const aesKey = await deriveAesKey(
        password,
        fromBase64(secret.salt),
        secret.iterations,
      );

      // Verify the password by attempting decryption before caching the key.
      try {
        await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: fromBase64(secret.iv) as BufferSource },
          aesKey,
          fromBase64(secret.ciphertext) as BufferSource,
        );
      } catch {
        throw new VaultError(
          'WRONG_PASSWORD',
          'The master password did not unlock the vault.',
        );
      }

      const rawKey = new Uint8Array(
        await crypto.subtle.exportKey('raw', aesKey),
      );
      await this.storage.setSession(SESSION_KEY, toBase64(rawKey));
    });
  }

  async lock(): Promise<void> {
    return this.exclusive(() => this.storage.removeSession(SESSION_KEY));
  }

  async clear(): Promise<void> {
    return this.exclusive(async () => {
      await this.storage.removeLocalItems([SECRET_KEY, PROVIDER_KEY]);
      await this.storage.removeSession(SESSION_KEY);
    });
  }

  async readApiKey(): Promise<string> {
    return this.exclusive(() => this.readApiKeyUnlocked());
  }

  private async readApiKeyUnlocked(): Promise<string> {
    const secret = await this.readSecret();
    const rawSessionKey = await this.storage.getSession(SESSION_KEY);
    if (typeof rawSessionKey !== 'string' || rawSessionKey.length === 0) {
      throw new VaultError('LOCKED', 'The vault is locked.');
    }

    try {
      const aesKey = await importSessionKey(fromBase64(rawSessionKey));
      const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: fromBase64(secret.iv) as BufferSource },
        aesKey,
        fromBase64(secret.ciphertext) as BufferSource,
      );
      return new TextDecoder().decode(plaintext);
    } catch {
      throw new VaultError(
        'CORRUPT_CIPHERTEXT',
        'The stored credential could not be decrypted.',
      );
    }
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationTail.then(operation, operation);
    this.operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async readSecret(): Promise<EncryptedSecret> {
    const raw = await this.storage.getLocal(SECRET_KEY);
    const parsed = EncryptedSecretSchema.safeParse(raw);
    if (!parsed.success) {
      throw new VaultError(
        'NOT_CONFIGURED',
        'No model credential is configured.',
      );
    }
    return parsed.data;
  }
}

export function createExtensionVaultStorage(storageArea: {
  local: {
    get: (key: string) => Promise<Record<string, unknown>>;
    set: (items: Record<string, unknown>) => Promise<void>;
    remove: (keys: string | string[]) => Promise<void>;
  };
  session: {
    get: (key: string) => Promise<Record<string, unknown>>;
    set: (items: Record<string, unknown>) => Promise<void>;
    remove: (key: string) => Promise<void>;
  };
}): VaultStorage {
  return {
    getLocal: async (key) => (await storageArea.local.get(key))[key],
    setLocalItems: (items) => storageArea.local.set(items),
    removeLocalItems: (keys) => storageArea.local.remove(keys),
    getSession: async (key) => (await storageArea.session.get(key))[key],
    setSession: (key, value) => storageArea.session.set({ [key]: value }),
    removeSession: (key) => storageArea.session.remove(key),
  };
}
