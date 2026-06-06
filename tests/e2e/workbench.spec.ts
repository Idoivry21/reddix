import { expect, test } from '@playwright/test';

test('renders the canvas workbench and switches console tabs', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Reddix' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Run Now/i })).toBeVisible();
  await expect(page.getByText('Reddit Sources')).toBeVisible();
  await expect(page.getByText('X/Twitter Sources')).toBeVisible();
  await expect(page.getByText('Command Preview')).toBeVisible();

  await page.getByRole('button', { name: 'Output Preview' }).click();
  await expect(page.getByRole('table')).toContainText('Local CLI automation');
});

