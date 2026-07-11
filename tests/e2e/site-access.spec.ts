import { expect, test } from './fixtures';
import { openObserver } from './helpers';
import { customerFixtureUrl } from './constants';

test('shows the persistent grant state for an authorized site', async ({
  context,
  extensionId,
}) => {
  const { panel } = await openObserver(context, extensionId, customerFixtureUrl, {
    keepContextOpen: true,
  });

  const siteAccess = panel.getByTestId('site-access');
  await expect(siteAccess).toHaveAttribute('data-status', 'persistent');
  await expect(siteAccess).toContainText('127.0.0.1');
  await expect(siteAccess).toContainText('已长期授权');
  await expect(panel.getByTestId('grant-site-access')).toHaveCount(0);
});

test('keeps the real grant state when revocation is refused', async ({
  context,
  extensionId,
}) => {
  const { panel } = await openObserver(context, extensionId, customerFixtureUrl, {
    keepContextOpen: true,
  });

  const siteAccess = panel.getByTestId('site-access');
  await expect(siteAccess).toHaveAttribute('data-status', 'persistent');

  // The E2E artifact grants this origin through a required manifest
  // permission, so Chrome refuses the removal. The UI must re-check and keep
  // reporting the origin as granted instead of pretending it was revoked.
  await panel
    .getByTestId('revoke-site-access')
    .evaluate((element: HTMLButtonElement) => element.click());

  await expect(panel.getByTestId('site-access-notice')).toBeVisible();
  await expect(siteAccess).toHaveAttribute('data-status', 'persistent');
});

test('offers no grant entry on protected browser surfaces', async ({
  context,
  extensionId,
}) => {
  const { panel } = await openObserver(
    context,
    extensionId,
    'chrome://extensions/',
    { keepContextOpen: true },
  );

  await expect(
    panel.getByTestId('page-context').getByTestId('error-banner'),
  ).toHaveAttribute('data-error-code', 'PAGE_ACCESS_DENIED');
  await expect(panel.getByTestId('site-access')).toHaveAttribute(
    'data-status',
    'unknown',
  );
  await expect(panel.getByTestId('grant-site-access')).toHaveCount(0);
  await expect(panel.getByTestId('revoke-site-access')).toHaveCount(0);
});
