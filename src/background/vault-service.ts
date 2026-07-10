import {
  VaultRequestSchema,
  type VaultResponse,
} from '../protocol/vault-messages';
import { SecretVault, VaultError } from './secret-vault';

function readRequestId(message: unknown): string {
  if (
    typeof message === 'object' &&
    message !== null &&
    'requestId' in message &&
    typeof message.requestId === 'string'
  ) {
    return message.requestId.slice(0, 128) || 'unknown';
  }
  return 'unknown';
}

async function state(vault: SecretVault) {
  const [status, provider] = await Promise.all([
    vault.status(),
    vault.getProvider(),
  ]);
  return {
    status,
    ...(provider ? { provider } : {}),
  };
}

export async function handleVaultRequest(
  message: unknown,
  vault: SecretVault,
): Promise<VaultResponse> {
  const parsed = VaultRequestSchema.safeParse(message);
  if (!parsed.success) {
    return {
      type: 'lens.vault.response',
      requestId: readRequestId(message),
      ok: false,
      error: {
        code: 'INVALID_REQUEST',
        message: 'The vault request did not match the Lens protocol.',
      },
    };
  }

  try {
    switch (parsed.data.type) {
      case 'lens.vault.status.request':
        break;
      case 'lens.vault.configure.request':
        await vault.configure(
          parsed.data.provider,
          parsed.data.apiKey,
          parsed.data.password,
        );
        break;
      case 'lens.vault.unlock.request':
        await vault.unlock(parsed.data.password);
        break;
      case 'lens.vault.lock.request':
        await vault.lock();
        break;
      case 'lens.vault.clear.request':
        await vault.clear();
        break;
    }

    return {
      type: 'lens.vault.response',
      requestId: parsed.data.requestId,
      ok: true,
      state: await state(vault),
    };
  } catch (error) {
    if (error instanceof VaultError) {
      return {
        type: 'lens.vault.response',
        requestId: parsed.data.requestId,
        ok: false,
        error: {
          code:
            error.code === 'WRONG_PASSWORD'
              ? 'WRONG_PASSWORD'
              : error.code === 'NOT_CONFIGURED'
                ? 'NOT_CONFIGURED'
                : 'VAULT_ERROR',
          message: error.message,
        },
      };
    }

    return {
      type: 'lens.vault.response',
      requestId: parsed.data.requestId,
      ok: false,
      error: {
        code: 'VAULT_ERROR',
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}
