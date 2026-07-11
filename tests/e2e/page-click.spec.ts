import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { openObserver, scanFromPanel } from './helpers';
import { clickPlaygroundUrl, mockProviderUrl } from './constants';
import {
  ClickResponseSchema,
  SnapshotResponseSchema,
} from '../../src/protocol/messages';
import type { PageSnapshot } from '../../src/protocol/page-snapshot';

async function requestSnapshot(panel: Page): Promise<PageSnapshot> {
  const rawResponse = await panel.evaluate(async () => {
    const extension = globalThis as typeof globalThis & {
      chrome: {
        runtime: {
          sendMessage: (message: unknown) => Promise<unknown>;
        };
      };
    };
    return extension.chrome.runtime.sendMessage({
      type: 'lens.page.snapshot.request',
      requestId: `e2e-click-snapshot-${Date.now()}`,
    });
  });
  const response = SnapshotResponseSchema.parse(rawResponse);
  if (!response.ok) {
    throw new Error(response.error.message);
  }
  return response.snapshot;
}

async function requestClick(
  panel: Page,
  input: { snapshotId: string; generation: number; nodeId: string },
) {
  const rawResponse = await panel.evaluate(async (request) => {
    const extension = globalThis as typeof globalThis & {
      chrome: {
        runtime: {
          sendMessage: (message: unknown) => Promise<unknown>;
        };
      };
    };
    return extension.chrome.runtime.sendMessage({
      type: 'lens.page.click.request',
      requestId: `e2e-click-${Date.now()}`,
      ...request,
    });
  }, input);
  return ClickResponseSchema.parse(rawResponse);
}

function findAction(snapshot: PageSnapshot, match: (label: string) => boolean) {
  const action = snapshot.actions.find((candidate) => match(candidate.label));
  if (!action) {
    throw new Error(
      `Expected action missing from snapshot: ${JSON.stringify(
        snapshot.actions.map((candidate) => candidate.label),
      )}`,
    );
  }
  return action;
}

test('clicks buttons and pointer-affordance elements with real page effects', async ({
  context,
  extensionId,
}) => {
  const { panel, target } = await openObserver(
    context,
    extensionId,
    clickPlaygroundUrl,
  );

  const snapshot = await requestSnapshot(panel);
  const incrementButton = findAction(snapshot, (label) => label === '加一');
  // The peg is a plain div with cursor: pointer — no button semantics at all.
  const peg = findAction(
    snapshot,
    (label) => label.includes('data-peg') && label.includes('peg-left'),
  );
  expect(peg.role).toBe('clickable');

  const buttonClick = await requestClick(panel, {
    snapshotId: snapshot.snapshotId,
    generation: snapshot.generation,
    nodeId: incrementButton.nodeId,
  });
  expect(buttonClick).toMatchObject({
    ok: true,
    result: {
      outcome: { nodeId: incrementButton.nodeId, status: 'clicked' },
    },
  });
  await expect(target.locator('#count')).toHaveText('1');

  const pegClick = await requestClick(panel, {
    snapshotId: snapshot.snapshotId,
    generation: snapshot.generation,
    nodeId: peg.nodeId,
  });
  expect(pegClick).toMatchObject({
    ok: true,
    result: { outcome: { nodeId: peg.nodeId, status: 'clicked' } },
  });
  await expect(target.locator('#count')).toHaveText('2');
  await expect(target.locator('#flags')).toHaveText('peg-clicked');
});

test('refuses submit, declared-risk, and disabled targets without side effects', async ({
  context,
  extensionId,
}) => {
  const { panel, target } = await openObserver(
    context,
    extensionId,
    clickPlaygroundUrl,
  );

  const snapshot = await requestSnapshot(panel);
  const rejections: [string, string][] = [
    ['提交申请', 'submit-blocked'],
    ['清空数据', 'risk-blocked'],
    ['禁用按钮', 'disabled'],
  ];

  for (const [label, reason] of rejections) {
    const action = findAction(snapshot, (candidate) => candidate === label);
    const response = await requestClick(panel, {
      snapshotId: snapshot.snapshotId,
      generation: snapshot.generation,
      nodeId: action.nodeId,
    });
    expect(response).toMatchObject({
      ok: true,
      result: {
        outcome: { nodeId: action.nodeId, status: 'rejected', reason },
      },
    });
  }

  // No blocked click may leave a trace in the page.
  await expect(target.locator('#flags')).toHaveText('idle');
  await expect(target.locator('#count')).toHaveText('0');
  await expect(target.locator('input[name="note"]')).toHaveValue('draft');
});

test('rejects clicks against a stale snapshot and recovers after a rescan', async ({
  context,
  extensionId,
}) => {
  const { panel, target } = await openObserver(
    context,
    extensionId,
    clickPlaygroundUrl,
    { keepContextOpen: true },
  );

  const staleSnapshot = await requestSnapshot(panel);
  const staleButton = findAction(staleSnapshot, (label) => label === '加一');

  // Reload resets the page world: the old node identities must die with it.
  await target.reload();
  await target.bringToFront();

  const staleResponse = await requestClick(panel, {
    snapshotId: staleSnapshot.snapshotId,
    generation: staleSnapshot.generation,
    nodeId: staleButton.nodeId,
  });
  expect(staleResponse).toMatchObject({
    ok: false,
    error: { code: 'STALE_SNAPSHOT' },
  });
  await expect(target.locator('#count')).toHaveText('0');

  // Rescan recovers fresh node identities that click again successfully.
  await scanFromPanel(panel);
  await expect(panel.getByTestId('scan-status')).toHaveAttribute(
    'data-phase',
    'ready',
  );
  const freshSnapshot = await requestSnapshot(panel);
  const freshButton = findAction(freshSnapshot, (label) => label === '加一');
  const freshResponse = await requestClick(panel, {
    snapshotId: freshSnapshot.snapshotId,
    generation: freshSnapshot.generation,
    nodeId: freshButton.nodeId,
  });
  expect(freshResponse).toMatchObject({
    ok: true,
    result: { outcome: { status: 'clicked' } },
  });
  await expect(target.locator('#count')).toHaveText('1');
});

test('runs goal -> model page_click on a clickable div -> page change -> reply', async ({
  context,
  extensionId,
}) => {
  const { panel, target } = await openObserver(
    context,
    extensionId,
    clickPlaygroundUrl,
  );

  await panel.getByTestId('settings-toggle').click();
  await panel.getByTestId('provider-base-url').fill(mockProviderUrl);
  await panel.getByTestId('provider-model').fill('lens-mock');
  await panel.getByTestId('provider-api-key').fill('lens-test-key');
  await panel.getByTestId('vault-password').fill('correct horse');
  await panel.getByTestId('save-provider').click();
  await expect(panel.getByTestId('provider-settings')).toHaveCount(0);

  await panel
    .getByTestId('agent-goal')
    .fill('CLICK_PLAYGROUND_TEST 点击左侧柱子');
  await target.bringToFront();
  await panel
    .getByTestId('run-agent')
    .evaluate((element: HTMLButtonElement) => element.click());

  await expect(panel.getByTestId('assistant-reply')).toContainText(
    '已点击左侧柱子',
  );
  await expect(target.locator('#count')).toHaveText('1');
  await expect(target.locator('#flags')).toHaveText('peg-clicked');
  await expect(panel.getByTestId('agent-events')).toContainText(
    'page.click · completed',
  );
  await expect(panel.getByTestId('context-chip')).toContainText('已修改 1 项');
});
