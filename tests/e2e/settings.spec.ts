import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { customerFixtureUrl, mockProviderUrl } from './constants';
import { openObserver } from './helpers';

const masterPassword = 'correct horse';

async function openSettings(
  context: BrowserContext,
  extensionId: string,
): Promise<{ panel: Page; target: Page }> {
  const result = await openObserver(
    context,
    extensionId,
    customerFixtureUrl,
  );
  await result.panel.getByTestId('settings-toggle').click();
  await expect(result.panel.getByTestId('settings-tabs')).toBeVisible();
  return result;
}

async function openRuntimeTab(panel: Page): Promise<void> {
  await panel.getByTestId('settings-tab-runtime').click();
  await expect(panel.getByTestId('settings-panel-runtime')).toBeVisible();
}

async function reopenRuntimeTab(panel: Page): Promise<void> {
  await panel.reload();
  await expect(panel.getByTestId('settings-toggle')).toBeVisible();
  await panel.getByTestId('settings-toggle').click();
  await openRuntimeTab(panel);
}

async function configureMockProvider(panel: Page): Promise<void> {
  await panel.getByTestId('provider-base-url').fill(mockProviderUrl);
  await panel.getByTestId('provider-model').fill('lens-mock');
  await panel.getByTestId('provider-api-key').fill('lens-test-key');
  await panel.getByTestId('vault-password').fill(masterPassword);
  await panel.getByTestId('save-provider').click();
  await expect(panel.getByTestId('provider-settings')).toHaveCount(0);
}

test('shows all Settings tabs in the direct side-panel page', async ({
  context,
  extensionId,
}) => {
  const { panel } = await openSettings(context, extensionId);

  await expect(panel.getByRole('tab')).toHaveCount(4);
  await expect(panel.getByTestId('settings-panel-provider')).toBeVisible();
  await expect(panel.getByRole('dialog')).toHaveCount(0);

  await openRuntimeTab(panel);
  await panel.getByTestId('settings-tab-sites').click();
  await expect(panel.getByTestId('settings-panel-sites')).toBeVisible();
  await panel.getByTestId('settings-tab-about').click();
  await expect(panel.getByTestId('about-version')).toContainText('版本');

  await panel.getByTestId('settings-back').click();
  await expect(panel.getByTestId('chat-view')).toBeVisible();
});

test('persists runtime settings, rejects invalid edits, and resets safely', async ({
  context,
  extensionId,
}) => {
  const { panel } = await openSettings(context, extensionId);
  await openRuntimeTab(panel);

  await panel.getByTestId('runtime-max-steps').fill('24');
  await panel.getByTestId('runtime-max-input-tokens').fill('8192');
  await panel.getByTestId('runtime-max-output-tokens').fill('2048');
  await panel.getByTestId('save-runtime').click();
  await expect(panel.getByTestId('runtime-notice')).toContainText('已保存');

  await reopenRuntimeTab(panel);
  await expect(panel.getByTestId('runtime-max-steps')).toHaveValue('24');
  await expect(panel.getByTestId('runtime-max-input-tokens')).toHaveValue(
    '8192',
  );
  await expect(panel.getByTestId('runtime-max-output-tokens')).toHaveValue(
    '2048',
  );

  await panel.getByTestId('runtime-max-steps').fill('0');
  await panel.getByTestId('save-runtime').click();
  await expect(panel.getByTestId('runtime-error')).toContainText(
    '最大模型步数',
  );

  await reopenRuntimeTab(panel);
  await expect(panel.getByTestId('runtime-max-steps')).toHaveValue('24');

  await panel.getByTestId('reset-runtime').click();
  await expect(panel.getByTestId('runtime-notice')).toContainText(
    '已恢复默认',
  );
  await reopenRuntimeTab(panel);
  await expect(panel.getByTestId('runtime-max-steps')).toHaveValue('12');
  await expect(panel.getByTestId('runtime-max-input-tokens')).toHaveValue('');
  await expect(panel.getByTestId('runtime-max-output-tokens')).toHaveValue('');
});

test('keeps required site grants visible when Chrome refuses revocation', async ({
  context,
  extensionId,
}) => {
  const { panel } = await openSettings(context, extensionId);
  await panel.getByTestId('settings-tab-sites').click();

  const allUrls = panel.locator(
    '[data-testid="granted-site"][data-pattern="<all_urls>"]',
  );
  await expect(allUrls).toBeVisible();
  await expect(allUrls).toContainText('覆盖所有站点');
  await allUrls.getByTestId('revoke-granted-site').click();

  await expect(panel.getByTestId('sites-notice')).toContainText(
    '仍保持已授权状态',
  );
  await expect(allUrls).toBeVisible();
});

test('applies a saved model-step budget to the next Agent run', async ({
  context,
  extensionId,
}) => {
  const { panel, target } = await openSettings(context, extensionId);
  await configureMockProvider(panel);

  await panel.getByTestId('settings-toggle').click();
  await openRuntimeTab(panel);
  await panel.getByTestId('runtime-max-steps').fill('1');
  await panel.getByTestId('save-runtime').click();
  await expect(panel.getByTestId('runtime-notice')).toContainText('已保存');
  await panel.getByTestId('settings-back').click();

  await panel
    .getByTestId('agent-goal')
    .fill('把客户姓名改为 Agent Grace，手机号改为 13900002222');
  await target.bringToFront();
  await panel
    .getByTestId('run-agent')
    .evaluate((element: HTMLButtonElement) => element.click());

  await expect(panel.getByTestId('run-error')).toContainText(
    'Stopped after 1 model steps',
  );
  await expect(target.locator('input[name="name"]')).toHaveValue('Agent Grace');
});
