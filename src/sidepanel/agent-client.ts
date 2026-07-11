import { browser } from 'wxt/browser';
import {
  AGENT_PORT_NAME,
  AgentEventSchema,
  type AgentEvent,
  type AgentHistoryItem,
} from '../protocol/agent-events';
import {
  VaultResponseSchema,
  type VaultRequest,
  type VaultState,
} from '../protocol/vault-messages';
import type { ProviderConfig } from '../protocol/provider';

type VaultRequestWithoutId = VaultRequest extends infer Request
  ? Request extends VaultRequest
    ? Omit<Request, 'requestId'>
    : never
  : never;

function createRequestId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `request_${Date.now().toString(36)}`;
}

export class AgentClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AgentClientError';
  }
}

export interface VaultMutationResult {
  state: VaultState;
  permissionWarning?: string;
}

async function sendVaultRequest(
  request: VaultRequestWithoutId,
): Promise<VaultState> {
  const response = await browser.runtime.sendMessage({
    ...request,
    requestId: createRequestId(),
  });
  const parsed = VaultResponseSchema.safeParse(response);
  if (!parsed.success) {
    throw new AgentClientError(
      'INVALID_RESPONSE',
      'The Lens vault returned an invalid response.',
    );
  }
  if (!parsed.data.ok) {
    throw new AgentClientError(
      parsed.data.error.code,
      parsed.data.error.message,
    );
  }
  return parsed.data.state;
}

function providerOriginPattern(baseUrl: string): string {
  const url = new URL(baseUrl);
  return `${url.protocol}//${url.hostname}/*`;
}

export function getVaultState(): Promise<VaultState> {
  return sendVaultRequest({ type: 'lens.vault.status.request' });
}

export async function configureVault(
  provider: ProviderConfig,
  apiKey: string,
  password: string,
  previousProvider?: ProviderConfig,
): Promise<VaultMutationResult> {
  // Must be the first async browser operation in the click handler so Chrome
  // preserves the user gesture required for optional host permission.
  const granted = await browser.permissions.request({
    origins: [providerOriginPattern(provider.baseUrl)],
  });
  if (!granted) {
    throw new AgentClientError(
      'PERMISSION_DENIED',
      'Provider access was not granted.',
    );
  }

  const nextPattern = providerOriginPattern(provider.baseUrl);
  const previousPattern = previousProvider
    ? providerOriginPattern(previousProvider.baseUrl)
    : undefined;

  let state: VaultState;
  try {
    state = await sendVaultRequest({
      type: 'lens.vault.configure.request',
      provider,
      apiKey,
      password,
    });
  } catch (error) {
    if (previousPattern !== nextPattern) {
      try {
        const removed = await browser.permissions.remove({
          origins: [nextPattern],
        });
        if (!removed) {
          throw new Error('permission removal returned false');
        }
      } catch {
        throw new AgentClientError(
          'PERMISSION_ROLLBACK_FAILED',
          `${error instanceof Error ? error.message : String(error)} The newly granted host permission could not be rolled back.`,
        );
      }
    }
    throw error;
  }

  let permissionWarning: string | undefined;
  if (previousPattern && previousPattern !== nextPattern) {
    try {
      const removed = await browser.permissions.remove({
        origins: [previousPattern],
      });
      if (!removed) {
        permissionWarning =
          'Provider saved, but the previous host permission could not be removed.';
      }
    } catch {
      permissionWarning =
        'Provider saved, but the previous host permission could not be removed.';
    }
  }

  return { state, permissionWarning };
}

export function unlockVault(password: string): Promise<VaultState> {
  return sendVaultRequest({
    type: 'lens.vault.unlock.request',
    password,
  });
}

export function lockVault(): Promise<VaultState> {
  return sendVaultRequest({ type: 'lens.vault.lock.request' });
}

export async function clearVault(
  provider?: ProviderConfig,
): Promise<VaultMutationResult> {
  const state = await sendVaultRequest({ type: 'lens.vault.clear.request' });
  let permissionWarning: string | undefined;
  if (provider) {
    try {
      const removed = await browser.permissions.remove({
        origins: [providerOriginPattern(provider.baseUrl)],
      });
      if (!removed) {
        permissionWarning =
          'Credentials were cleared, but the provider host permission remains.';
      }
    } catch {
      permissionWarning =
        'Credentials were cleared, but the provider host permission remains.';
    }
  }
  return { state, permissionWarning };
}

export interface AgentRunHandle {
  cancel: () => void;
}

export function startAgentRun(
  goal: string,
  history: AgentHistoryItem[],
  onEvent: (event: AgentEvent) => void,
  onUnexpectedDisconnect: () => void,
): AgentRunHandle {
  const port = browser.runtime.connect({ name: AGENT_PORT_NAME });
  let terminal = false;
  let cancelling = false;

  port.onMessage.addListener((message: unknown) => {
    const parsed = AgentEventSchema.safeParse(message);
    if (!parsed.success) {
      terminal = true;
      onEvent({
        kind: 'error',
        code: 'AGENT_FAILED',
        message: 'The Agent runtime returned an invalid event.',
      });
      port.disconnect();
      return;
    }

    onEvent(parsed.data);
    if (parsed.data.kind === 'done' || parsed.data.kind === 'error') {
      terminal = true;
      port.disconnect();
    }
  });

  port.onDisconnect.addListener(() => {
    if (!terminal) {
      onUnexpectedDisconnect();
    }
  });

  port.postMessage({
    type: 'lens.agent.run',
    goal,
    history,
  });

  return {
    cancel() {
      if (!terminal && !cancelling) {
        cancelling = true;
        port.postMessage({ type: 'lens.agent.cancel' });
      }
    },
  };
}
