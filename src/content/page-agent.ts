import { browser } from 'wxt/browser';
import { PageCommandSchema } from '../protocol/page-commands';
import { clickNode } from './click-controller';
import {
  createDocumentElementRegistry,
  getDocumentElementRegistry,
} from './element-registry';
import { fillFields } from './form-controller';
import { buildPageSnapshot } from './page-observer';
import {
  prepareScreenshot,
  restoreScreenshot,
  scrollScreenshot,
} from './screenshot-controller';

interface AgentGlobal {
  __lensPageAgentV1?: {
    documentId: string;
  };
}

export type InstallResult = 'installed' | 'already-installed';

function createDocumentId(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return `document_${Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')}`;
}

export function installPageAgent(): InstallResult {
  const agentGlobal = globalThis as typeof globalThis & AgentGlobal;
  if (agentGlobal.__lensPageAgentV1) {
    return 'already-installed';
  }
  const agentState = {
    documentId: createDocumentId(),
  };
  agentGlobal.__lensPageAgentV1 = agentState;

  browser.runtime.onMessage.addListener(
    (
      message: unknown,
      sender: { id?: string },
      sendResponse: (response: unknown) => void,
    ) => {
      if (sender.id && sender.id !== browser.runtime.id) {
        return;
      }

      const parsedCommand = PageCommandSchema.safeParse(message);
      if (!parsedCommand.success) {
        return;
      }

      switch (parsedCommand.data.command) {
        case 'page.snapshot': {
          const registry = createDocumentElementRegistry();
          sendResponse(buildPageSnapshot(document, window, registry));
          return;
        }
        case 'page.document.identity':
          sendResponse({ documentId: agentState.documentId });
          return;
        case 'page.form.fill':
          sendResponse(
            fillFields(getDocumentElementRegistry(), parsedCommand.data.payload),
          );
          return;
        case 'page.click':
          sendResponse(
            clickNode(getDocumentElementRegistry(), parsedCommand.data.payload),
          );
          return;
        case 'page.screenshot.prepare':
          sendResponse(
            prepareScreenshot(
              document,
              window,
              parsedCommand.data.payload.sessionId,
            ),
          );
          return;
        case 'page.screenshot.scroll':
          void scrollScreenshot(
            document,
            window,
            parsedCommand.data.payload,
          ).then(sendResponse);
          return true;
        case 'page.screenshot.restore':
          void restoreScreenshot(
            window,
            parsedCommand.data.payload.sessionId,
          ).then(sendResponse);
          return true;
      }
    },
  );

  return 'installed';
}
