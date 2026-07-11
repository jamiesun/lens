import { expect, test } from './fixtures';
import {
  customerFixtureUrl,
  mockProviderUrl,
} from './constants';
import { openObserver } from './helpers';

async function configureMockProvider(
  panel: import('@playwright/test').Page,
): Promise<void> {
  await panel.getByTestId('settings-toggle').click();
  await panel.getByTestId('provider-base-url').fill(mockProviderUrl);
  await panel.getByTestId('provider-model').fill('lens-mock');
  await panel.getByTestId('provider-api-key').fill('lens-test-key');
  await panel.getByTestId('vault-password').fill('correct horse');
  await panel.getByTestId('save-provider').click();
  await expect(panel.getByTestId('provider-settings')).toHaveCount(0);
}

test('captures the visible viewport and exposes a PNG download', async ({
  context,
  extensionId,
}) => {
  const { panel, target } = await openObserver(
    context,
    extensionId,
    customerFixtureUrl,
    { keepContextOpen: true },
  );

  await target.bringToFront();
  await panel
    .getByTestId('capture-viewport')
    .evaluate((element: HTMLButtonElement) => element.click());
  await panel
    .locator('[data-screenshot-mode="viewport"]')
    .waitFor({ state: 'attached' });
  await panel.getByLabel('关闭页面信息').click();

  const image = panel
    .locator('[data-screenshot-mode="viewport"]')
    .getByTestId('screenshot-preview');
  await expect(image).toBeVisible();
  expect(
    await image.evaluate((element: HTMLImageElement) => ({
      width: element.naturalWidth,
      height: element.naturalHeight,
    })),
  ).toMatchObject({
    width: expect.any(Number),
    height: expect.any(Number),
  });
  const downloadLink = panel
    .locator('[data-screenshot-mode="viewport"]')
    .getByTestId('screenshot-download');
  await expect(downloadLink).toHaveAttribute('href', /^data:image\/png;base64,/);
  const [download] = await Promise.all([
    panel.waitForEvent('download'),
    downloadLink.click(),
  ]);
  expect(download.suggestedFilename()).toMatch(
    /^lens-viewport-.*\.png$/,
  );
});

test('stitches a full-page long screenshot and restores page state', async ({
  context,
  extensionId,
}) => {
  const { panel, target } = await openObserver(
    context,
    extensionId,
    customerFixtureUrl,
    { keepContextOpen: true },
  );
  await target.evaluate(() => window.scrollTo(0, 420));
  await expect
    .poll(() => target.evaluate(() => Math.round(window.scrollY)))
    .toBe(420);

  await target.bringToFront();
  await panel
    .getByTestId('capture-full-page')
    .evaluate((element: HTMLButtonElement) => element.click());
  await panel
    .locator('[data-screenshot-mode="full-page"]')
    .waitFor({ state: 'attached' });
  await panel.getByLabel('关闭页面信息').click();

  const image = panel
    .locator('[data-screenshot-mode="full-page"]')
    .getByTestId('screenshot-preview');
  await expect(image).toBeVisible();
  const dimensions = await image.evaluate((element: HTMLImageElement) => ({
    width: element.naturalWidth,
    height: element.naturalHeight,
  }));
  expect(dimensions.height).toBeGreaterThan(dimensions.width);
  expect(dimensions.height).toBeGreaterThan(1_500);
  await expect(
    panel
      .locator('[data-screenshot-mode="full-page"]')
      .getByTestId('screenshot-download'),
  ).toHaveAttribute('href', /^data:image\/jpeg;base64,/);

  expect(await target.evaluate(() => Math.round(window.scrollY))).toBe(420);
  expect(
    await target
      .locator('.fixed-capture-marker')
      .evaluate((element: HTMLElement) => element.style.visibility),
  ).toBe('');
});

test('lets the Agent produce a full-page screenshot from chat', async ({
  context,
  extensionId,
}) => {
  const { panel, target } = await openObserver(
    context,
    extensionId,
    customerFixtureUrl,
  );
  await configureMockProvider(panel);

  await panel.getByTestId('agent-goal').fill('SCREENSHOT_FULL 请截取整页长图');
  await target.bringToFront();
  await panel
    .getByTestId('run-agent')
    .evaluate((element: HTMLButtonElement) => element.click());

  await expect(
    panel.locator('[data-screenshot-mode="full-page"]'),
  ).toBeVisible();
  await expect(panel.getByTestId('assistant-reply')).toContainText(
    '尚未提交',
  );
  await panel.reload();
  await expect(
    panel.locator('[data-screenshot-mode="full-page"]'),
  ).toBeVisible();
});

test('cancels an Agent long screenshot without persisting pixels or page state', async ({
  context,
  extensionId,
}) => {
  const { panel, target } = await openObserver(
    context,
    extensionId,
    customerFixtureUrl,
  );
  await configureMockProvider(panel);
  await panel.getByTestId('agent-goal').fill('SCREENSHOT_FULL 请截取整页长图');

  await target.bringToFront();
  await panel
    .getByTestId('run-agent')
    .evaluate((element: HTMLButtonElement) => element.click());
  await expect(panel.getByTestId('agent-events')).toContainText(
    'page.screenshot · started',
  );
  await panel.getByTestId('stop-agent').click();
  await expect(panel.getByTestId('run-agent')).toBeVisible();

  await expect(
    panel.locator('[data-screenshot-mode="full-page"]'),
  ).toHaveCount(0);
  expect(await target.evaluate(() => Math.round(window.scrollY))).toBe(0);
  expect(
    await target
      .locator('.fixed-capture-marker')
      .evaluate((element: HTMLElement) => element.style.visibility),
  ).toBe('');
});
