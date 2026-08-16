import { test, expect } from '@playwright/test';

test.describe('CUJ-6: Mobile 375px Responsiveness Across All Admin & Staff Pages', () => {
  test.use({ viewport: { width: 375, height: 667 } }); // iPhone SE 375px

  test('should render /submit without horizontal overflow', async ({ page }) => {
    await page.goto('/submit');
    const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(375);

    const submitBtn = page.locator('[data-testid="btn-submit-availability"]');
    await expect(submitBtn).toBeVisible();
  });

  test('should render /admin without horizontal overflow and allow navigation', async ({ page }) => {
    await page.goto('/admin');
    const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(375);

    const optimizeBtn = page.locator('[data-testid="btn-optimize"]');
    await expect(optimizeBtn).toBeVisible();
  });

  test('should render /admin/staff and open add modal within 375px viewport', async ({ page }) => {
    await page.goto('/admin/staff');
    const addBtn = page.locator('[data-testid="btn-add-staff"]');
    await expect(addBtn).toBeVisible();
    await addBtn.click();

    const modalDialog = page.locator('.modal-dialog');
    await expect(modalDialog).toBeVisible();
  });

  test('should render /admin/forecast within 375px viewport', async ({ page }) => {
    await page.goto('/admin/forecast');
    const heading = page.locator('h1:has-text("売上・需要予測シミュレーター")');
    await expect(heading).toBeVisible();
  });
});
