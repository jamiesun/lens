import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { openObserver } from './helpers';
import {
  mockProviderUrl,
  toolsConsoleUrl,
  toolsInvalidUrl,
} from './constants';

const masterPassword = 'correct horse';

async function configureMockProvider(panel: Page): Promise<void> {
  await panel.getByTestId('settings-toggle').click();
  await panel.getByTestId('provider-base-url').fill(mockProviderUrl);
  await panel.getByTestId('provider-model').fill('lens-mock');
  await panel.getByTestId('provider-api-key').fill('lens-test-key');
  await panel.getByTestId('vault-password').fill(masterPassword);
  await panel.getByTestId('save-provider').click();
  await expect(panel.getByTestId('provider-settings')).toHaveCount(0);
}

async function runGoal(
  panel: Page,
  target: Page,
  goal: string,
): Promise<void> {
  await panel.getByTestId('agent-goal').fill(goal);
  await target.bringToFront();
  await panel
    .getByTestId('run-agent')
    .evaluate((element: HTMLButtonElement) => element.click());
}

test('discovers page tools and answers from a site_ observe tool', async ({
  context,
  extensionId,
}) => {
  const { panel, target } = await openObserver(
    context,
    extensionId,
    toolsConsoleUrl,
  );
  await configureMockProvider(panel);

  await runGoal(panel, target, 'PAGE_TOOLS_LOOKUP 查一下 gizmo 的库存');

  const reply = panel.getByTestId('assistant-reply');
  await expect(reply).toContainText('库存查询完成');
  await expect(reply).toContainText('Gizmo mk2');
  await expect(reply).toContainText('42');

  const events = panel.getByTestId('agent-events');
  await expect(events).toContainText(
    'page.tools.list · completed · 2/3 page tools available',
  );
  await expect(events).toContainText(
    'page.tools.call · completed · inventory_lookup',
  );
});

test('writes local page state through a site_ tool and recovers after a reload', async ({
  context,
  extensionId,
}) => {
  const { panel, target } = await openObserver(
    context,
    extensionId,
    toolsConsoleUrl,
  );
  await configureMockProvider(panel);

  await runGoal(panel, target, 'PAGE_TOOLS_NOTE 写一条货架便签');
  await expect(panel.getByTestId('assistant-reply')).toContainText(
    '已写入货架便签',
  );
  await expect(target.locator('#note')).toHaveText('到货后先质检');

  // A reload rebuilds the page registry with a fresh session id; the next
  // run must rediscover and call the tool instead of reusing stale state.
  await target.reload();
  await expect(target.locator('#note')).toHaveText('（尚无便签）');

  await runGoal(panel, target, 'PAGE_TOOLS_NOTE 重新写一条货架便签');
  await expect(
    panel.locator('[data-chat-role="assistant"]'),
  ).toHaveCount(2);
  await expect(target.locator('#note')).toHaveText('到货后先质检');
});

test('blocks a destructive page tool and leaves the page intact', async ({
  context,
  extensionId,
}) => {
  const { panel, target } = await openObserver(
    context,
    extensionId,
    toolsConsoleUrl,
  );
  await configureMockProvider(panel);

  await runGoal(panel, target, 'PAGE_TOOLS_PURGE 清空库存');

  await expect(panel.getByTestId('assistant-reply')).toContainText(
    '清空操作被运行时拦截',
  );
  await expect(panel.getByTestId('agent-events')).toContainText(
    'page.tools.call · failed · Blocked by risk policy (destructive): purge_inventory',
  );
  await expect(target.locator('#purge-state')).toHaveAttribute(
    'data-purged',
    'false',
  );
  await expect(target.locator('#purge-state')).toHaveText('Inventory intact.');
});

test('rejects an invalid tool registry as a whole and runs without site tools', async ({
  context,
  extensionId,
}) => {
  const { panel, target } = await openObserver(
    context,
    extensionId,
    toolsInvalidUrl,
  );
  await configureMockProvider(panel);

  await runGoal(panel, target, 'PAGE_TOOLS_LOOKUP 查一下 gizmo 的库存');

  await expect(panel.getByTestId('assistant-reply')).toContainText(
    '页面工具不可用',
  );
  await expect(panel.getByTestId('agent-events')).toContainText(
    'page.tools.list · failed',
  );
  await expect(panel.getByTestId('agent-events')).not.toContainText(
    'page.tools.call',
  );
  await expect(target.locator('#probe')).toHaveAttribute(
    'data-executed',
    'false',
  );
});

test('reports missing page access before any tool discovery on protected surfaces', async ({
  context,
  extensionId,
}) => {
  const { panel, target } = await openObserver(
    context,
    extensionId,
    'chrome://extensions/',
  );
  await configureMockProvider(panel);

  await runGoal(panel, target, 'PAGE_TOOLS_LOOKUP 查一下 gizmo 的库存');

  await expect(panel.getByTestId('run-error')).toContainText(
    'Lens does not have access to this page.',
  );
  await expect(panel.getByTestId('agent-events')).not.toContainText(
    'page.tools',
  );
  await expect(panel.getByTestId('assistant-reply')).toHaveCount(0);
});
