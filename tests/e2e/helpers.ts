import type { BrowserContext, Page } from '@playwright/test';
import { expect } from './fixtures';

export async function openObserver(
  context: BrowserContext,
  extensionId: string,
  targetUrl: string,
): Promise<{ panel: Page; target: Page }> {
  const target = await context.newPage();
  await target.goto(targetUrl);

  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(panel.getByTestId('scan-page')).toBeVisible();

  await target.bringToFront();
  await scanFromPanel(panel);

  return { panel, target };
}

export async function scanFromPanel(panel: Page): Promise<void> {
  await panel
    .getByTestId('scan-page')
    .evaluate((element: HTMLButtonElement) => {
      element.click();
    });
}
