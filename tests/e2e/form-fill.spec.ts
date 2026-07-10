import { expect, test } from './fixtures';
import { openObserver, scanFromPanel } from './helpers';
import { customerFixtureUrl } from './constants';

test('fills editable fields with per-field receipts and real page writes', async ({
  context,
  extensionId,
}) => {
  const { panel, target } = await openObserver(
    context,
    extensionId,
    customerFixtureUrl,
  );

  await expect(panel.getByTestId('scan-status')).toHaveAttribute(
    'data-phase',
    'ready',
  );

  // Sensitive fields never render an editor input.
  await expect(panel.locator('[data-field-name="password"]')).toHaveCount(0);
  await expect(panel.getByText('MASKED')).toBeVisible();

  await panel.locator('[data-field-name="name"]').fill('Grace Hopper');
  await panel.locator('[data-field-name="phone"]').fill('13900001111');
  await panel.getByTestId('apply-fill-customer-create').click();

  await expect(panel.getByTestId('fill-badge')).toHaveCount(2);
  await expect(panel.getByTestId('fill-badge').first()).toHaveText('FILLED');
  await expect(panel.getByTestId('fill-badge').nth(1)).toHaveText('FILLED');

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

  await expect(panel.getByTestId('write-gate')).toContainText('2 LOCAL');
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
  );

  await expect(panel.getByTestId('scan-status')).toHaveAttribute(
    'data-phase',
    'ready',
  );

  await panel.locator('[data-field-name="name"]').fill('Too Late');

  // Reload resets the page world: the old node identities must die with it.
  await target.reload();
  await target.bringToFront();

  await panel.getByTestId('apply-fill-customer-create').click();

  await expect(panel.getByTestId('error-banner')).toHaveAttribute(
    'data-error-code',
    'STALE_SNAPSHOT',
  );
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
