import {
  chromium,
  expect,
  test as base,
  type BrowserContext,
} from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

interface ExtensionFixtures {
  context: BrowserContext;
  extensionId: string;
}

export const test = base.extend<ExtensionFixtures>({
  context: async ({}, use) => {
    const extensionPath = path.resolve('.output/chrome-mv3-test');
    const userDataDirectory = await mkdtemp(
      path.join(tmpdir(), 'lens-playwright-'),
    );
    const context = await chromium.launchPersistentContext(userDataDirectory, {
      channel: 'chromium',
      headless: true,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });

    await use(context);
    await context.close();
    await rm(userDataDirectory, { recursive: true, force: true });
  },

  extensionId: async ({ context }, use) => {
    const existingServiceWorker = context.serviceWorkers()[0];
    const serviceWorker =
      existingServiceWorker ??
      (await context.waitForEvent('serviceworker', { timeout: 10_000 }));
    const extensionId = new URL(serviceWorker.url()).host;

    await use(extensionId);
  },
});

export { expect };
