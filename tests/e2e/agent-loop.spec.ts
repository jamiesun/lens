import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { openObserver } from './helpers';
import { customerFixtureUrl, mockProviderUrl } from './constants';

const masterPassword = 'correct horse';

async function configureMockProvider(panel: Page): Promise<void> {
  await expect(panel.getByTestId('vault-status')).toHaveText('unconfigured');
  await panel
    .getByTestId('provider-base-url')
    .fill(mockProviderUrl);
  await panel.getByTestId('provider-model').fill('lens-mock');
  await panel.getByTestId('provider-api-key').fill('lens-test-key');
  await panel.getByTestId('vault-password').fill(masterPassword);
  await panel.getByTestId('save-provider').click();
  await expect(panel.getByTestId('vault-status')).toHaveText('unlocked');
}

test('runs goal -> snapshot -> model tool call -> page fill -> final reply', async ({
  context,
  extensionId,
}) => {
  const { panel, target } = await openObserver(
    context,
    extensionId,
    customerFixtureUrl,
  );
  await configureMockProvider(panel);

  await expect(panel.locator('body')).not.toContainText('lens-test-key');
  await panel
    .getByTestId('agent-goal')
    .fill('把客户姓名改为 Agent Grace，手机号改为 13900002222');

  // Keep the business page as Chrome's active tab while clicking inside the
  // extension page programmatically.
  await target.bringToFront();
  await panel
    .getByTestId('run-agent')
    .evaluate((element: HTMLButtonElement) => element.click());

  await expect(panel.getByTestId('assistant-reply')).toContainText(
    '已填写客户姓名和手机号',
  );
  await expect(target.locator('input[name="name"]')).toHaveValue('Agent Grace');
  await expect(target.locator('input[name="phone"]')).toHaveValue(
    '13900002222',
  );
  await expect(target.locator('input[name="password"]')).toHaveValue(
    'ultra-secret-demo',
  );
  await expect(panel.getByTestId('agent-events')).toContainText(
    'page.form.fill · completed · 2/2 fields filled',
  );
  await expect(panel.getByTestId('write-gate')).toContainText('2 LOCAL');
  await expect(panel.getByTestId('scan-status')).toHaveAttribute(
    'data-phase',
    'ready',
  );
});

test('locks the vault and rejects a wrong password before recovering', async ({
  context,
  extensionId,
}) => {
  const { panel } = await openObserver(
    context,
    extensionId,
    customerFixtureUrl,
  );
  await configureMockProvider(panel);

  await panel.getByTestId('lock-vault').click();
  await expect(panel.getByTestId('vault-status')).toHaveText('locked');
  await expect(panel.getByTestId('agent-goal')).toHaveCount(0);

  await panel.getByTestId('vault-password').fill('wrong password');
  await panel.getByTestId('unlock-vault').click();
  await expect(panel.getByRole('alert')).toContainText(
    'master password did not unlock',
  );
  await expect(panel.getByTestId('vault-status')).toHaveText('locked');

  await panel.getByTestId('vault-password').fill(masterPassword);
  await panel.getByTestId('unlock-vault').click();
  await expect(panel.getByTestId('vault-status')).toHaveText('unlocked');
  await expect(panel.getByTestId('agent-goal')).toBeVisible();
});

test('locking is a cancellation barrier for an in-flight model request', async ({
  context,
  extensionId,
}) => {
  const { panel, target } = await openObserver(
    context,
    extensionId,
    customerFixtureUrl,
  );
  await configureMockProvider(panel);
  await panel.getByTestId('agent-goal').fill('SLOW_AGENT_TEST');

  await target.bringToFront();
  await panel
    .getByTestId('run-agent')
    .evaluate((element: HTMLButtonElement) => element.click());
  await expect(panel.getByTestId('agent-events')).toContainText(
    'Consulting model',
  );

  await panel.getByTestId('lock-vault').click();
  await expect(panel.getByTestId('vault-status')).toHaveText('locked');
  await panel.waitForTimeout(1_100);

  await expect(panel.getByTestId('assistant-reply')).toHaveCount(0);
  await expect(target.locator('input[name="name"]')).toHaveValue(
    'Ada Lovelace',
  );
  await expect(target.locator('input[name="phone"]')).toHaveValue(
    '13800000000',
  );
});
