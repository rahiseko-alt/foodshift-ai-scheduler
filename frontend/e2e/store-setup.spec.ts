/**
 * 見知らぬ店長が「自分の店」を立ち上げられるかの検証。
 *
 * 修正前は以下が全て存在しなかった:
 *  - 表示中のデータがデモであるという表示（初見の店長は他人15名の名前と時給を
 *    自分のデータと誤認する）
 *  - デモを捨ててゼロから始める手段（逆方向の「デモに戻す」しか無く、
 *    15人を1人ずつ確認ダイアログ付きで消すしかなかった）
 *  - 対象期間を変更するUI（アプリ全体に無く、永久に 2026-09-01 から14日間固定）
 */
import { test, expect } from '@playwright/test';

test('CUJ-12: 初見の店長が自店を立ち上げ、対象期間を変更できる', async ({ page }) => {
  await page.goto('/admin');

  // 1. デモであることが明示される
  const banner = page.locator('[data-testid="demo-data-banner"]');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('サンプルデータ');

  // 2. デモは15人いる
  await page.goto('/admin/staff');
  const before = await page.locator('tbody tr').count();
  expect(before).toBeGreaterThan(10);

  // 3. ゼロから始める
  await page.goto('/admin');
  await page.locator('[data-testid="btn-open-store-setup"]').click();
  await page.locator('[data-testid="input-new-store-name"]').fill('居酒屋テスト店');
  page.once('dialog', (d) => d.accept());
  await page.locator('[data-testid="btn-fresh-start"]').click();

  // 4. デモバナーが消え、店舗名が反映される
  await expect(page.locator('[data-testid="demo-data-banner"]')).toHaveCount(0);
  await expect(page.locator('body')).toContainText('居酒屋テスト店');

  // 5. スタッフが空になっている
  await page.goto('/admin/staff');
  await expect(page.locator('tbody tr')).toHaveCount(0);

  // 6. 対象期間を変更できる（従来UIが存在しなかった）
  await page.goto('/admin');
  await page.locator('[data-testid="btn-toggle-store-setup"]').click();
  await page.locator('[data-testid="input-period-start"]').fill('2026-11-03');
  await page.locator('[data-testid="input-period-days"]').fill('7');
  await page.locator('[data-testid="input-period-days"]').blur();

  // 7. リロードしても保持される
  await page.reload();
  await expect(page.locator('body')).toContainText('2026-11-03');
  await expect(page.locator('body')).toContainText('7日間');
});
