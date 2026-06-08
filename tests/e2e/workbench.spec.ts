import { expect, test } from '@playwright/test';

const isMobile = (name: string): boolean => name.includes('mobile');

// Skip the first-run welcome overlay so the tests exercise the workbench itself.
// The overlay has dedicated unit coverage (useOnboarding / WelcomeOverlay).
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('reddix-onboarded', '1');
    } catch {
      /* localStorage may be unavailable; the overlay is non-fatal either way */
    }
  });
});

test('renders the canvas workbench', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Reddix' })).toBeVisible();
  await expect(page.getByText('Reddit', { exact: true })).toBeVisible();
  await expect(page.getByText('X / Twitter')).toBeVisible();
});

test('switches console tabs to the empty Output Preview', async ({ page }, testInfo) => {
  test.skip(isMobile(testInfo.project.name), 'console interaction is exercised on desktop');
  await page.goto('/');

  await expect(page.getByText(/command preview/i)).toBeVisible();
  // Output Preview starts empty until a flow runs with an export block.
  await page.getByRole('tab', { name: 'Output Preview' }).click();
  await expect(page.getByText(/No rows yet/i)).toBeVisible();
});

test('adds a block to the canvas with the keyboard', async ({ page }, testInfo) => {
  test.skip(isMobile(testInfo.project.name), 'authoring is disabled on the mobile read-only surface');
  await page.goto('/');

  const addButton = page.getByRole('button', { name: /^Add .* block$/i }).first();
  await addButton.focus();
  await page.keyboard.press('Enter');

  await expect(page.getByRole('complementary', { name: 'Inspector' })).toBeVisible();
  await expect(page.getByText(/command preview/i)).toBeVisible();
});

test('runs a flow, shows live steps, and surfaces the error state', async ({ page }, testInfo) => {
  test.skip(isMobile(testInfo.project.name), 'running is disabled on the mobile read-only surface');
  await page.goto('/');

  await page.getByRole('button', { name: /Run flow/i }).click();

  // With the CLIs absent the run fails; the status must be announced (aria-live)
  // and per-step results must render in the command trace.
  await expect(page.locator('.run-status-bar')).toContainText(/Run finished with errors|Run failed/i, {
    timeout: 15_000
  });

  await page.getByRole('tab', { name: 'Command Trace' }).click();
  await expect(page.getByText(/Step 1:/i)).toBeVisible();
});

test('surfaces upstream input fields and output chips on wired nodes', async ({ page }, testInfo) => {
  test.skip(isMobile(testInfo.project.name), 'inspector authoring is exercised on desktop');
  await page.goto('/');

  // A source node advertises its output fields as chips on the canvas card.
  const source = page.locator('[data-role="node"]').filter({ hasText: 'Search Reddit' });
  await expect(source.locator('.nio-chip').first()).toBeVisible();

  // Selecting a wired transform shows the upstream fields it can consume.
  await page.locator('[data-role="node"]').filter({ hasText: 'Filter Text' }).click();
  const inspector = page.getByRole('complementary', { name: 'Inspector' });
  await expect(inspector.getByText('available inputs')).toBeVisible();
  await expect(inspector.locator('.inputs-panel').getByText('title', { exact: true })).toBeVisible();
});

test('enforces read-only authoring on mobile', async ({ page }, testInfo) => {
  test.skip(!isMobile(testInfo.project.name), 'mobile-only enforcement check');
  await page.goto('/');

  await expect(page.getByText(/Read-only on mobile/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /Run flow/i })).toBeDisabled();
  const addButton = page.getByRole('button', { name: /^Add .* block$/i }).first();
  await expect(addButton).toHaveAttribute('aria-disabled', 'true');
});
