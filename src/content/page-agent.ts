import { browser } from 'wxt/browser';
import { PageCommandSchema } from '../protocol/page-commands';
import {
  createDocumentElementRegistry,
  getDocumentElementRegistry,
} from './element-registry';
import { fillFields } from './form-controller';
import { buildPageSnapshot } from './page-observer';

interface AgentGlobal {
  __lensPageAgentV1?: boolean;
}

export type InstallResult = 'installed' | 'already-installed';

export function installPageAgent(): InstallResult {
  const agentGlobal = globalThis as typeof globalThis & AgentGlobal;
  if (agentGlobal.__lensPageAgentV1) {
    return 'already-installed';
  }
  agentGlobal.__lensPageAgentV1 = true;

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

      if (parsedCommand.data.command === 'page.snapshot') {
        const registry = createDocumentElementRegistry();
        sendResponse(buildPageSnapshot(document, window, registry));
        return;
      }

      sendResponse(
        fillFields(getDocumentElementRegistry(), parsedCommand.data.payload),
      );
    },
  );

  return 'installed';
}
