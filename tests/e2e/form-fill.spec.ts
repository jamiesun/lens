import { expect, test } from './fixtures';
import { openObserver, scanFromPanel } from './helpers';
import { customerFixtureUrl } from './constants';
import {
  FillResponseSchema,
  SnapshotResponseSchema,
} from '../../src/protocol/messages';

test('fills editable fields with per-field receipts and real page writes', async ({
  context,
  extensionId,
}) => {
  const { panel, target } = await openObserver(
    context,
    extensionId,
    customerFixtureUrl,
    { keepContextOpen: true },
  );

  await expect(panel.getByTestId('scan-status')).toHaveAttribute(
    'data-phase',
    'ready',
  );
  await panel.getByTestId('manual-tools-toggle').click();

  // Sensitive fields never render an editor input.
  await expect(panel.locator('[data-field-name="password"]')).toHaveCount(0);
  await expect(panel.getByText('MASKED')).toBeVisible();

  await panel.locator('[data-field-name="name"]').fill('Grace Hopper');
  await panel.locator('[data-field-name="phone"]').fill('13900001111');
  await panel.getByTestId('apply-fill-customer-create').click();

  await expect(panel.getByTestId('fill-badge')).toHaveCount(2);
  await expect(panel.getByTestId('fill-badge').first()).toHaveText('已填写');
  await expect(panel.getByTestId('fill-badge').nth(1)).toHaveText('已填写');

  // The values must actually land in the page, not just in panel state.
  await expect(target.locator('input[name="name"]')).toHaveValue(
    'Grace Hopper',
  );
  await expect(target.locator('input[name="phone"]')).toHaveValue(
    '13900001111',
  );
  // The sensitive field stays untouched.
  await expect(target.locator('input[name="password"]')).toHaveValue(
    'ultra-secret-demo',
  );

  await expect(panel.getByTestId('context-chip')).toContainText('已修改 2 项');
  await panel.getByText('页面操作与日志').click();
  await expect(panel.getByText('page.form.fill')).toBeVisible();
});

test('rejects fills against a stale snapshot after the page reloads', async ({
  context,
  extensionId,
}) => {
  const { panel, target } = await openObserver(
    context,
    extensionId,
    customerFixtureUrl,
    { keepContextOpen: true },
  );

  await expect(panel.getByTestId('scan-status')).toHaveAttribute(
    'data-phase',
    'ready',
  );
  await panel.getByTestId('manual-tools-toggle').click();

  const rawSnapshotResponse = await panel.evaluate(async () => {
    const extension = globalThis as typeof globalThis & {
      chrome: {
        runtime: {
          sendMessage: (message: unknown) => Promise<unknown>;
        };
      };
    };
    return extension.chrome.runtime.sendMessage({
      type: 'lens.page.snapshot.request',
      requestId: 'e2e-stale-snapshot',
    });
  });
  const snapshotResponse = SnapshotResponseSchema.parse(rawSnapshotResponse);
  if (!snapshotResponse.ok) {
    throw new Error(snapshotResponse.error.message);
  }
  const field = snapshotResponse.snapshot.forms
    .flatMap((form) => form.fields)
    .find((candidate) => candidate.name === 'name');
  if (!field) {
    throw new Error('Name field missing from snapshot.');
  }
  const staleFill = {
    snapshotId: snapshotResponse.snapshot.snapshotId,
    generation: snapshotResponse.snapshot.generation,
    nodeId: field.nodeId,
  };

  // Reload resets the page world: the old node identities must die with it.
  await target.reload();
  await target.bringToFront();

  await expect(panel.getByTestId('apply-fill-customer-create')).toHaveCount(0);
  const rawStaleResponse = await panel.evaluate(async (request) => {
    const extension = globalThis as typeof globalThis & {
      chrome: {
        runtime: {
          sendMessage: (message: unknown) => Promise<unknown>;
        };
      };
    };
    return extension.chrome.runtime.sendMessage({
      type: 'lens.page.fill.request',
      requestId: 'e2e-stale-fill',
      snapshotId: request.snapshotId,
      generation: request.generation,
      fields: [{ nodeId: request.nodeId, value: 'Too Late' }],
    });
  }, staleFill);
  const staleResponse = FillResponseSchema.parse(rawStaleResponse);
  expect(staleResponse).toMatchObject({
    ok: false,
    error: { code: 'STALE_SNAPSHOT' },
  });
  await expect(target.locator('input[name="name"]')).toHaveValue(
    'Ada Lovelace',
  );

  // Rescan recovers a usable snapshot.
  await scanFromPanel(panel);
  await expect(panel.getByTestId('scan-status')).toHaveAttribute(
    'data-phase',
    'ready',
  );
});
