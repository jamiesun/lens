import { browser } from 'wxt/browser';
import {
  handleRuntimeRequest,
  type SnapshotDependencies,
} from '../src/background/snapshot-service';

export default defineBackground(() => {
  void browser.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error: unknown) => {
      console.error('Lens could not configure the Side Panel action.', error);
    });

  const dependencies: SnapshotDependencies = {
    async getActiveTab() {
      const [tab] = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });
      return tab;
    },
    async executeSnapshot(tabId) {
      const [result] = await browser.scripting.executeScript({
        target: { tabId },
        files: ['/content-scripts/snapshot.js'],
      });
      return result?.result;
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
