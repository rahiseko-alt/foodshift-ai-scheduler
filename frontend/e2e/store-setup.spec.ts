/**
 * CUJ-12: 見知らぬ店長が「自分の店」を立ち上げ、対象期間を変更できるか。
 *
 * 【修正前に何が起きていたか】
 *  - `expect(before).toBeGreaterThan(10)` のような緩い比較で、
 *    「デモの15人が出ている」ことを実質確認していなかった。
 *  - 期間変更の検証が `expect(page.locator('body')).toContainText('2026-11-03')` だけで、
 *    ページのどこかにその文字列があれば通る。実際にその期間でシフトを組める状態に
 *    なったか（保存データ・各画面の日付）は見ていなかった。
 *  - ゼロから開始した後にスタッフ表が空になったことは見ていたが、
 *    シフト枠・必要人数まで消えたか、最適化が実行不能になったかは未検証だった。
 */
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { ShiftOptimizeRequest } from '../src/lib/types';

const EV = '/tmp/claude-0/-home-user-foodshift-ai-scheduler/8cea9e3e-1847-5cca-ac45-5ec023e8495a/scratchpad/evidence/a2';

async function readStoredRequest(page: Page): Promise<ShiftOptimizeRequest | null> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('foodshift_req_store_default');
    return raw ? JSON.parse(raw) : null;
  });
}

test('CUJ-12: 初見の店長が自店を立ち上げ、対象期間を変更できる', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/admin');

  // --- 1. 表示中がデモであることが明示されている ---
  const banner = page.locator('[data-testid="demo-data-banner"]');
  await expect(banner).toBeVisible({ timeout: 60000 });
  await expect(banner).toContainText('これはサンプルデータです（居酒屋・15名）');
  await page.screenshot({ path: `${EV}/store-setup-01-demo-banner.png`, fullPage: true });

  // --- 2. デモ名簿は「自分が入力した覚えのない他人」である ---
  await page.goto('/admin/staff');
  const demoRows = page.locator('[data-testid^="staff-item-"]');
  await expect(demoRows).toHaveCount(15, { timeout: 60000 });
  await expect(page.locator('[data-testid="staff-item-emp_01"]')).toContainText('佐藤 店長 (社員)');
  expect(await readStoredRequest(page), 'デモ表示中は自店データが保存されていないこと').toBeNull();
  await page.screenshot({ path: `${EV}/store-setup-02-demo-roster.png`, fullPage: true });

  // --- 3. ゼロから始める ---
  await page.goto('/admin');
  await page.locator('[data-testid="btn-open-store-setup"]').click();
  await page.locator('[data-testid="input-new-store-name"]').fill('居酒屋テスト店');
  page.once('dialog', (d) => d.accept());
  await page.locator('[data-testid="btn-fresh-start"]').click();

  // --- 4. デモ表示が消え、自店として扱われる ---
  await expect(page.locator('[data-testid="demo-data-banner"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="btn-toggle-store-setup"]')).toBeVisible();
  await page.screenshot({ path: `${EV}/store-setup-03-fresh-start.png`, fullPage: true });

  const fresh = (await readStoredRequest(page)) as ShiftOptimizeRequest;
  expect(fresh.store_name).toBe('居酒屋テスト店');
  expect(fresh.staff_members, 'スタッフが全消去されていること').toHaveLength(0);
  expect(fresh.shifts, 'シフト枠も消去されていること').toHaveLength(0);
  expect(fresh.requirements, '必要人数設定も消去されていること').toHaveLength(0);
  expect(fresh.availabilities).toHaveLength(0);

  // 店舗名が画面に反映されている（body全体ではなく設定パネル内）
  await expect(page.locator('.card:has([data-testid="btn-toggle-store-setup"])')).toContainText(
    '居酒屋テスト店'
  );
  // 空の状態では最適化を実行できない（＝消去が実挙動に効いている）
  const optimizeBtn = page.locator('[data-testid="btn-optimize"]');
  await expect(optimizeBtn).toBeDisabled();
  await expect(optimizeBtn).toContainText('必要人数0名 (実行不可)');
  await expect(page.locator('[data-testid="zero-requirement-alert"]')).toBeVisible();

  // --- 5. 各画面が空になっている ---
  await page.goto('/admin/staff');
  await expect(page.locator('[data-testid^="staff-item-"]')).toHaveCount(0);
  await page.goto('/admin/shifts');
  await expect(page.locator('[data-testid="btn-add-shift-slot"]')).toBeVisible({ timeout: 60000 });
  await expect(page.locator('[data-testid^="slot-item-"]')).toHaveCount(0);
  await page.screenshot({ path: `${EV}/store-setup-04-empty-shifts.png`, fullPage: true });

  // --- 6. 対象期間を変更できる ---
  await page.goto('/admin');
  await page.locator('[data-testid="btn-toggle-store-setup"]').click();
  await page.locator('[data-testid="input-period-start"]').fill('2026-11-03');
  await page.locator('[data-testid="input-period-days"]').fill('7');
  await page.locator('[data-testid="input-period-days"]').blur();

  const afterPeriod = (await readStoredRequest(page)) as ShiftOptimizeRequest;
  expect(afterPeriod.period.start_date).toBe('2026-11-03');
  expect(afterPeriod.period.days).toBe(7);
  await page.screenshot({ path: `${EV}/store-setup-05-period-changed.png`, fullPage: true });

  // --- 7. リロード後も保持され、各画面の日付計算に反映されること ---
  await page.reload();
  await expect(page.locator('header p')).toContainText('期間: 2026-11-03 から 7日間');
  await expect(page.locator('[data-testid="tab-view-monthly"]')).toContainText('(7日間)');
  await page.locator('[data-testid="tab-view-timeline"]').click();
  // 2026-11-03 は火曜日。日付ラベルが実際の曜日計算を経ていること。
  await expect(page.locator('[data-testid="current-day-label"]')).toContainText('11/3 (火)');
  await expect(page.locator('[data-testid="current-day-label"]')).toContainText('Day 1 / 7');
  await page.screenshot({ path: `${EV}/store-setup-06-after-reload.png`, fullPage: true });

  const persisted = (await readStoredRequest(page)) as ShiftOptimizeRequest;
  expect(persisted.period).toEqual({ start_date: '2026-11-03', days: 7 });
  expect(persisted.store_name).toBe('居酒屋テスト店');
});
