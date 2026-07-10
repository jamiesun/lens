import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from './fixtures';

async function openObserver(
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
  await panel.getByTestId('scan-page').evaluate((element: HTMLButtonElement) => {
    element.click();
  });

  return { panel, target };
}

test('shows a redacted semantic snapshot for an authorized page', async ({
  context,
  extensionId,
}) => {
  const { panel } = await openObserver(
    context,
    extensionId,
    'http://127.0.0.1:4173/customer-create.html',
  );

  await expect(panel.getByTestId('scan-status')).toHaveAttribute(
    'data-phase',
    'ready',
  );
  await expect(panel.getByTestId('page-title')).toHaveText(
    'Customer Console / Create',
  );
  await expect(panel.getByTestId('form-count')).toHaveText('01');
  await expect(panel.getByText('Customer profile')).toBeVisible();
  await expect(panel.getByText('Access secret · MASKED')).toBeVisible();
  await expect(panel.getByText('server-write')).toBeVisible();
  await expect(panel.locator('body')).not.toContainText('ultra-secret-demo');
  await expect(panel.locator('body')).not.toContainText(
    'token-should-never-appear',
  );
  await expect(panel.locator('body')).not.toContainText(
    'classified hidden phrase',
  );
});

test('blocks snapshot injection when the page origin is not authorized', async ({
  context,
  extensionId,
}) => {
  const { panel } = await openObserver(
    context,
    extensionId,
    'http://localhost:4173/customer-create.html',
  );

  await expect(panel.getByTestId('scan-status')).toHaveAttribute(
    'data-phase',
    'error',
  );
  await expect(panel.getByTestId('error-banner')).toHaveAttribute(
    'data-error-code',
    'PAGE_ACCESS_DENIED',
  );
  await expect(panel.getByTestId('error-banner')).toContainText(
    'Page access not armed',
  );
  await expect(panel.getByTestId('page-title')).toHaveCount(0);
});
