import type { BrowserContext, Page } from '@playwright/test';
import { expect } from './fixtures';

export async function openObserver(
  context: BrowserContext,
  extensionId: string,
  targetUrl: string,
  options: { keepContextOpen?: boolean } = {},
): Promise<{ panel: Page; target: Page }> {
  const target = await context.newPage();
  await target.goto(targetUrl);

  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(panel.getByTestId('context-toggle')).toBeVisible();

  await target.bringToFront();
  await panel
    .getByTestId('context-toggle')
    .evaluate((element: HTMLButtonElement) => element.click());
  await expect(panel.getByTestId('page-context')).toBeVisible();
  await scanFromPanel(panel);
  await panel.waitForFunction(() => {
    const phase = document
      .querySelector('[data-testid="scan-status"]')
      ?.getAttribute('data-phase');
    return phase === 'ready' || phase === 'error';
  });

  if (!options.keepContextOpen) {
    await panel
      .getByLabel('关闭页面信息')
      .evaluate((element: HTMLButtonElement) => element.click());
  }

  return { panel, target };
}

export async function scanFromPanel(panel: Page): Promise<void> {
  await panel
    .getByTestId('scan-page')
    .evaluate((element: HTMLButtonElement) => {
      element.click();
    });
}
