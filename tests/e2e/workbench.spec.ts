import { expect, test } from '@playwright/test';

const isMobile = (name: string): boolean => name.includes('mobile');

test('renders the canvas workbench and switches console tabs', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Reddix' })).toBeVisible();
  await expect(page.getByText('Reddit Sources')).toBeVisible();
  await expect(page.getByText('X/Twitter Sources')).toBeVisible();
  await expect(page.getByText('Command Preview')).toBeVisible();

  // Output Preview starts empty until a flow runs with an export block.
  await page.getByRole('button', { name: 'Output Preview' }).click();
  await expect(page.getByText(/No output rows/i)).toBeVisible();
});

test('adds a block to the canvas with the keyboard', async ({ page }, testInfo) => {
  test.skip(isMobile(testInfo.project.name), 'authoring is disabled on the mobile read-only surface');
  await page.goto('/');

  const addButton = page.getByRole('button', { name: /^Add .* block$/i }).first();
  await addButton.focus();
  await page.keyboard.press('Enter');

  await expect(page.getByLabel('Inspector')).toBeVisible();
  await expect(page.getByText('Command Preview')).toBeVisible();
});

test('enforces read-only authoring on mobile', async ({ page }, testInfo) => {
  test.skip(!isMobile(testInfo.project.name), 'mobile-only enforcement check');
  await page.goto('/');

  await expect(page.getByText(/Read-only on mobile/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /Run Now/i })).toBeDisabled();
  const addButton = page.getByRole('button', { name: /^Add .* block$/i }).first();
  await expect(addButton).toHaveAttribute('aria-disabled', 'true');
});
