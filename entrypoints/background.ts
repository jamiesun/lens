import { browser } from 'wxt/browser';
import { runAgentGoal } from '../src/background/agent-runtime';
import { chatComplete } from '../src/background/model-client';
import {
  handleRuntimeRequest,
  type PageServiceDependencies,
} from '../src/background/page-service';
import {
  createExtensionVaultStorage,
  SecretVault,
} from '../src/background/secret-vault';
import { handleVaultRequest } from '../src/background/vault-service';
import {
  AGENT_PORT_NAME,
  AgentPortRequestSchema,
  type AgentEvent,
} from '../src/protocol/agent-events';
import type {
  FillResponse,
  SnapshotResponse,
} from '../src/protocol/messages';
import { VaultRequestSchema } from '../src/protocol/vault-messages';

export default defineBackground(() => {
  void browser.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error: unknown) => {
      console.error('Lens could not configure the Side Panel action.', error);
    });

  void browser.storage.local
    .setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
    .catch((error: unknown) => {
      console.error('Lens could not restrict local storage access.', error);
    });
  void browser.storage.session
    .setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
    .catch((error: unknown) => {
      console.error('Lens could not restrict session storage access.', error);
    });

  const pageDependencies: PageServiceDependencies = {
    async getActiveTab() {
      const [tab] = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });
      return tab;
    },
    async ensurePageAgent(tabId) {
      await browser.scripting.executeScript({
        target: { tabId },
        files: ['/content-scripts/page-agent.js'],
      });
    },
    async sendPageCommand(tabId, command) {
      return browser.tabs.sendMessage(tabId, command);
    },
  };
  const vault = new SecretVault(createExtensionVaultStorage(browser.storage));
  const activeRuns = new Map<AbortController, Promise<void>>();

  const cancelAllRuns = async () => {
    const running = Array.from(activeRuns.entries());
    for (const [controller] of running) {
      controller.abort();
    }
    await Promise.allSettled(running.map(([, completion]) => completion));
  };

  // sendResponse + `return true` instead of returning a promise: promise
  // returns from onMessage listeners are ignored by older Chromium versions.
  browser.runtime.onMessage.addListener(
    (message: unknown, _sender, sendResponse: (response: unknown) => void) => {
      const vaultRequest = VaultRequestSchema.safeParse(message);
      const isCredentialBarrier =
        vaultRequest.success &&
        [
          'lens.vault.configure.request',
          'lens.vault.lock.request',
          'lens.vault.clear.request',
        ].includes(vaultRequest.data.type);
      const response = vaultRequest.success
        ? (isCredentialBarrier ? cancelAllRuns() : Promise.resolve()).then(() =>
            handleVaultRequest(message, vault),
          )
        : handleRuntimeRequest(message, pageDependencies);
      void response.then(sendResponse);
      return true;
    },
  );

  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== AGENT_PORT_NAME) {
      return;
    }

    let activeRun: AbortController | undefined;
    let disconnected = false;
    const emit = (event: AgentEvent) => {
      if (!disconnected) {
        port.postMessage(event);
      }
    };

    port.onMessage.addListener((message: unknown) => {
      const parsed = AgentPortRequestSchema.safeParse(message);
      if (!parsed.success) {
        emit({
          kind: 'error',
          code: 'AGENT_FAILED',
          message: 'The agent run request was invalid.',
        });
        return;
      }

      if (parsed.data.type === 'lens.agent.cancel') {
        activeRun?.abort();
        return;
      }

      if (activeRun) {
        emit({
          kind: 'error',
          code: 'AGENT_FAILED',
          message: 'An agent run is already active in this panel.',
        });
        return;
      }

      activeRun = new AbortController();
      const controller = activeRun;

      const runSnapshot = async (): Promise<SnapshotResponse> => {
        const response = await handleRuntimeRequest(
          {
            type: 'lens.page.snapshot.request',
            requestId: crypto.randomUUID(),
          },
          pageDependencies,
        );
        return response as SnapshotResponse;
      };

      const runFill = async (input: {
        snapshotId: string;
        generation: number;
        fields: { nodeId: string; value: string }[];
      }): Promise<FillResponse> => {
        const response = await handleRuntimeRequest(
          {
            type: 'lens.page.fill.request',
            requestId: crypto.randomUUID(),
            ...input,
          },
          pageDependencies,
        );
        return response as FillResponse;
      };

      const completion = runAgentGoal(
        parsed.data.goal,
        {
          vault,
          runSnapshot,
          runFill,
          complete: ({ provider, apiKey, messages, tools, signal }) =>
            chatComplete({
              baseUrl: provider.baseUrl,
              model: provider.model,
              apiKey,
              messages,
              tools,
              signal,
            }),
        },
        emit,
        controller.signal,
      )
        .catch((error: unknown) => {
          emit({
            kind: 'error',
            code: 'AGENT_FAILED',
            message: error instanceof Error ? error.message : String(error),
          });
        })
        .finally(() => {
          activeRuns.delete(controller);
          if (activeRun === controller) {
            activeRun = undefined;
          }
        });
      activeRuns.set(controller, completion);
      void completion;
    });

    port.onDisconnect.addListener(() => {
      disconnected = true;
      activeRun?.abort();
      activeRun = undefined;
    });
  });
});
