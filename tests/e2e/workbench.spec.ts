import { expect, test } from '@playwright/test';

test('renders the canvas workbench and switches console tabs', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Reddix' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Run Now/i })).toBeVisible();
  await expect(page.getByText('Reddit Sources')).toBeVisible();
  await expect(page.getByText('X/Twitter Sources')).toBeVisible();
  await expect(page.getByText('Command Preview')).toBeVisible();

  // Output Preview starts empty until a flow runs with an export block.
  await page.getByRole('button', { name: 'Output Preview' }).click();
  await expect(page.getByText(/No output rows/i)).toBeVisible();
});

test('adds a block to the canvas with the keyboard', async ({ page }) => {
  await page.goto('/');

  const addButton = page.getByRole('button', { name: /^Add .* block$/i }).first();
  await addButton.focus();
  await page.keyboard.press('Enter');

  // The newly added block is selected and shown in the Inspector.
  await expect(page.getByLabel('Inspector')).toBeVisible();
  await expect(page.getByText('Command Preview')).toBeVisible();
});
