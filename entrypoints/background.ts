import { browser } from 'wxt/browser';
import {
  handleRuntimeRequest,
  type PageServiceDependencies,
} from '../src/background/page-service';

export default defineBackground(() => {
  void browser.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error: unknown) => {
      console.error('Lens could not configure the Side Panel action.', error);
    });

  const dependencies: PageServiceDependencies = {
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

  // sendResponse + `return true` instead of returning a promise: promise
  // returns from onMessage listeners are ignored by older Chromium versions.
  browser.runtime.onMessage.addListener(
    (message: unknown, _sender, sendResponse: (response: unknown) => void) => {
      void handleRuntimeRequest(message, dependencies).then(sendResponse);
      return true;
    },
  );
});
