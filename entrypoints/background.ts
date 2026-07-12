import { browser } from 'wxt/browser';
import { readAgentSettings } from '../src/background/agent-settings';
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
import {
  handleScreenshotRequest,
  type ScreenshotDependencies,
} from '../src/background/screenshot-service';
import { handleVaultRequest } from '../src/background/vault-service';
import {
  AGENT_PORT_NAME,
  AgentPortRequestSchema,
  type AgentEvent,
} from '../src/protocol/agent-events';
import type {
  ClickResponse,
  FillResponse,
  SnapshotResponse,
} from '../src/protocol/messages';
import { VaultRequestSchema } from '../src/protocol/vault-messages';
import {
  ScreenshotRequestSchema,
  type ScreenshotResponse,
} from '../src/protocol/screenshot';

export default defineBackground(() => {
  // Chromium never grants activeTab when an action click merely toggles the
  // side panel (extension_action_runner.cc routes those clicks to
  // kToggleSidePanel before GrantTabPermissions runs, see crbug.com/40904917).
  // Lens therefore keeps openPanelOnActionClick disabled and opens the panel
  // from action.onClicked: that click path arms activeTab first, and clicking
  // the icon on an already-open panel re-arms access instead of closing it.
  void browser.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: false })
    .catch((error: unknown) => {
      console.error('Lens could not configure the Side Panel action.', error);
    });

  browser.action.onClicked.addListener((tab) => {
    if (typeof tab.windowId !== 'number') {
      return;
    }
    // Must stay synchronous inside the click handler to keep the gesture.
    browser.sidePanel.open({ windowId: tab.windowId }).catch((error: unknown) => {
      console.error('Lens could not open the Side Panel.', error);
    });
    browser.runtime
      .sendMessage({
        type: 'lens.action.invoked',
        windowId: tab.windowId,
      })
      .catch(() => {
        // No panel is listening yet; the panel scans on mount instead.
      });
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
  const screenshotDependencies: ScreenshotDependencies = {
    getActiveTab: pageDependencies.getActiveTab,
    ensurePageAgent: pageDependencies.ensurePageAgent,
    sendPageCommand: pageDependencies.sendPageCommand,
    captureVisibleTab: (windowId, options) =>
      browser.tabs.captureVisibleTab(windowId, options),
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
      const screenshotRequest = ScreenshotRequestSchema.safeParse(message);
      const response = vaultRequest.success
        ? (isCredentialBarrier ? cancelAllRuns() : Promise.resolve()).then(() =>
            handleVaultRequest(message, vault),
          )
        : screenshotRequest.success
          ? handleScreenshotRequest(message, screenshotDependencies)
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
      const runRequest = parsed.data;

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

      const completion = (async () => {
        const pinnedTab = await pageDependencies.getActiveTab();
        if (
          typeof pinnedTab?.id !== 'number' ||
          typeof pinnedTab.windowId !== 'number'
        ) {
          emit({
            kind: 'error',
            code: 'TOOL_ERROR',
            message: 'Lens could not pin the active page for this run.',
          });
          return;
        }

        const getPinnedActiveTab = async () => {
          const current = await pageDependencies.getActiveTab();
          if (
            !current ||
            current?.id !== pinnedTab.id ||
            current.windowId !== pinnedTab.windowId ||
            (pinnedTab.url &&
              current.url &&
              current.url !== pinnedTab.url)
          ) {
            throw new Error(
              'The active page changed after this Agent run started.',
            );
          }
          return current;
        };
        const pinnedPageDependencies: PageServiceDependencies = {
          ...pageDependencies,
          getActiveTab: getPinnedActiveTab,
        };
        const pinnedScreenshotDependencies: ScreenshotDependencies = {
          ...screenshotDependencies,
          getActiveTab: getPinnedActiveTab,
        };

        const runSnapshot = async (): Promise<SnapshotResponse> => {
          const response = await handleRuntimeRequest(
            {
              type: 'lens.page.snapshot.request',
              requestId: crypto.randomUUID(),
            },
            pinnedPageDependencies,
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
            pinnedPageDependencies,
          );
          return response as FillResponse;
        };
        const runClick = async (input: {
          snapshotId: string;
          generation: number;
          nodeId: string;
        }): Promise<ClickResponse> => {
          const response = await handleRuntimeRequest(
            {
              type: 'lens.page.click.request',
              requestId: crypto.randomUUID(),
              ...input,
            },
            pinnedPageDependencies,
          );
          return response as ClickResponse;
        };
        const runScreenshot = async (
          mode: 'viewport' | 'full-page',
          signal?: AbortSignal,
        ): Promise<ScreenshotResponse> =>
          handleScreenshotRequest(
            {
              type: 'lens.page.screenshot.request',
              requestId: crypto.randomUUID(),
              mode,
            },
            pinnedScreenshotDependencies,
            signal,
          );

        const settings = await readAgentSettings({
          get: (key) => browser.storage.local.get(key),
        });

        await runAgentGoal(
          runRequest.goal,
          {
            vault,
            runSnapshot,
            runFill,
            runClick,
            runScreenshot,
            complete: ({
              provider,
              apiKey,
              messages,
              tools,
              maxOutputTokens,
              signal,
            }) =>
              chatComplete({
                baseUrl: provider.baseUrl,
                model: provider.model,
                apiKey,
                messages,
                tools,
                maxOutputTokens,
                signal,
              }),
          },
          emit,
          controller.signal,
          runRequest.history,
          runRequest.attachments,
          settings,
        );
      })()
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
