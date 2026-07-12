import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { openObserver } from './helpers';
import { customerFixtureUrl, mockProviderUrl } from './constants';

const masterPassword = 'correct horse';

async function configureMockProvider(panel: Page): Promise<void> {
  await panel.getByTestId('settings-toggle').click();
  await expect(panel.getByTestId('vault-status')).toHaveText('unconfigured');
  await panel
    .getByTestId('provider-base-url')
    .fill(mockProviderUrl);
  await panel.getByTestId('provider-model').fill('lens-mock');
  await panel.getByTestId('provider-api-key').fill('lens-test-key');
  await panel.getByTestId('vault-password').fill(masterPassword);
  await panel.getByTestId('save-provider').click();
  await expect(panel.getByTestId('provider-settings')).toHaveCount(0);
  await expect(panel.getByTestId('settings-toggle')).toHaveAttribute(
    'data-vault-status',
    'unlocked',
  );
  await expect(panel.getByTestId('settings-toggle')).toBeFocused();
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
  await expect(panel.getByTestId('context-chip')).toContainText('已修改 2 项');
  await expect(panel.getByTestId('scan-status')).toHaveAttribute(
    'data-phase',
    'ready',
  );
});

test('renders assistant Markdown and LaTeX formulas safely', async ({
  context,
  extensionId,
}) => {
  const { panel, target } = await openObserver(
    context,
    extensionId,
    customerFixtureUrl,
  );
  await configureMockProvider(panel);
  await panel.getByTestId('agent-goal').fill('MATH_RENDER_TEST');

  await target.bringToFront();
  await panel
    .getByTestId('run-agent')
    .evaluate((element: HTMLButtonElement) => element.click());

  const reply = panel.getByTestId('assistant-reply');
  await expect(
    reply.getByRole('heading', { name: '汉诺塔公式' }),
  ).toBeVisible();
  await expect(reply.locator('.katex')).toHaveCount(3);
  await expect(reply.locator('.katex-display')).toHaveCount(1);
  await expect(reply.locator('.katex').last()).toContainText('\\notacommand');
  await expect(reply).not.toContainText('\\(2^n - 1\\)');
  await expect(reply.locator('img')).toHaveCount(0);
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

  await panel.getByTestId('settings-toggle').click();
  await panel.getByTestId('lock-vault').click();
  await expect(panel.getByTestId('vault-status')).toHaveText('locked');
  await expect(panel.getByTestId('agent-goal')).toBeDisabled();

  await panel.getByTestId('vault-password').fill('wrong password');
  await panel.getByTestId('unlock-vault').click();
  await expect(panel.getByRole('alert')).toContainText(
    'master password did not unlock',
  );
  await expect(panel.getByTestId('vault-status')).toHaveText('locked');

  await panel.getByTestId('vault-password').fill(masterPassword);
  await panel.getByTestId('unlock-vault').click();
  await expect(panel.getByTestId('provider-settings')).toHaveCount(0);
  await expect(panel.getByTestId('agent-goal')).toBeEnabled();
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
  await expect(panel.getByTestId('stop-agent')).toBeVisible();
  await expect(panel.getByTestId('agent-status')).toContainText(
    'Consulting model',
  );

  await panel.getByTestId('settings-toggle').click();
  await panel.getByTestId('lock-vault').click();
  await expect(panel.getByTestId('vault-status')).toHaveText('locked');
  await panel.waitForTimeout(3_300);

  await expect(panel.getByTestId('assistant-reply')).toHaveCount(0);
  await expect(target.locator('input[name="name"]')).toHaveValue(
    'Ada Lovelace',
  );
  await expect(target.locator('input[name="phone"]')).toHaveValue(
    '13800000000',
  );
});

test('keeps a multi-turn chat history and clears it on new chat', async ({
  context,
  extensionId,
}) => {
  const { panel, target } = await openObserver(
    context,
    extensionId,
    customerFixtureUrl,
  );
  await configureMockProvider(panel);

  for (const [index, goal] of [
    '记住暗号：海蓝',
    '刚才的暗号是什么？',
  ].entries()) {
    await panel.getByTestId('agent-goal').fill(goal);
    await target.bringToFront();
    await panel
      .getByTestId('run-agent')
      .evaluate((element: HTMLButtonElement) => element.click());
    await expect(
      panel.locator('[data-chat-role="assistant"]'),
    ).toHaveCount(index + 1);
  }

  await expect(panel.locator('[data-chat-role="user"]')).toHaveCount(2);
  await expect(
    panel.locator('[data-chat-role="assistant"]').last(),
  ).toContainText('海蓝');
  await panel.reload();
  await expect(panel.locator('[data-chat-role="user"]')).toHaveCount(2);
  await expect(panel.locator('[data-chat-role="assistant"]')).toHaveCount(2);

  await panel.getByTestId('history-toggle').click();
  await expect(panel.getByTestId('history-entry')).toHaveCount(1);
  await panel.getByLabel('关闭历史记录').click();
  await panel.getByTestId('new-chat').click();
  await expect(panel.locator('[data-chat-role]')).toHaveCount(0);
  await expect(panel.getByTestId('chat-welcome')).toBeVisible();

  await panel.getByTestId('history-toggle').click();
  await panel.getByTestId('history-entry').click();
  await expect(panel.locator('[data-chat-role="user"]')).toHaveCount(2);
  await expect(
    panel.locator('[data-chat-role="assistant"]').last(),
  ).toContainText('海蓝');

  await panel.getByTestId('history-toggle').click();
  await panel.getByRole('button', { name: /删除 记住暗号/ }).click();
  await expect(panel.getByTestId('history-entry')).toHaveCount(0);
  await panel.getByLabel('关闭历史记录').click();
  await expect(panel.getByTestId('chat-welcome')).toBeVisible();
});
