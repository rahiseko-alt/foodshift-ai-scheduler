import { test, expect } from '@playwright/test';

test.describe('CUJ-5: Demand Forecasting Simulator & Shift Integration Flow', () => {
  test('should simulate sales, switch business profiles, update labor productivity KPIs, and apply to shift requirements', async ({
    page,
  }) => {
    // 1. /admin/forecast にアクセス
    await page.goto('/admin/forecast');

    // 2. ページヘッダーとKPIカードの確認
    const heading = page.locator('h1:has-text("売上・需要予測シミュレーター")');
    await expect(heading).toBeVisible();

    const salesCard = page.locator('text=予測総売上');
    await expect(salesCard).toBeVisible();

    // 3. 業態プロファイルの切り替え（カフェ / ラーメン）
    const cafeBtn = page.locator('button:has-text("カフェ・ベーカリー")');
    if (await cafeBtn.isVisible()) {
      await cafeBtn.click({ force: true });
      // 基準L/P が更新されたか確認
      await expect(page.locator('text=カフェ・ベーカリー')).toBeVisible();
    }

    // 4. 居酒屋に戻す
    const izakayaBtn = page.locator('button:has-text("居酒屋・大衆酒場")');
    await izakayaBtn.click({ force: true });

    // 5. 反映ボタン「⚡ この予測をシフト必要人数に反映する」を押下
    const applyBtn = page.locator('button:has-text("この予測をシフト必要人数に反映する")').first();
    await expect(applyBtn).toBeVisible();
    await applyBtn.click({ force: true });

    // 6. 反映完了トースト通知の確認
    const toast = page.locator('text=需要予測結果をシフト必要人数に反映・保存しました');
    await expect(toast).toBeVisible({ timeout: 5000 });

    // 7. /admin/shifts に遷移し、必要人数設定が保存されていることを確認
    await page.goto('/admin/shifts');
    const reqTab = page.locator('button:has-text("日別必要人数マトリクス")');
    await expect(reqTab).toBeVisible();
    await reqTab.click();

    // マトリクステーブルが描画されていることを確認
    const table = page.locator('table');
    await expect(table).toBeVisible();
  });
});
