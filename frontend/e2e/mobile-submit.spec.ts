import { test, expect } from '@playwright/test';

test.describe('CUJ-2: Mobile Staff Availability Submission Flow (375px)', () => {
  test.use({ viewport: { width: 375, height: 667 } }); // iPhone SE / 標準スマホ幅

  test('should submit availability without horizontal overflow within 30 taps', async ({
    page,
  }) => {
    // 1. /submit にアクセス
    await page.goto('/submit');

    // 2. 横スクロールなし (scrollWidth <= 375)
    const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(375);

    // 3. スタッフ選択
    const selectStaff = page.locator('[data-testid="select-staff"]');
    await expect(selectStaff).toBeVisible();
    await selectStaff.selectOption({ index: 1 }); // 2人目のスタッフ

    // 4. マスをタップして希望を入力 (タップ数カウント)
    let tapCount = 0;
    for (let d = 0; d < 7; d++) {
      const slotBtn = page.locator(`[data-testid="btn-slot-${d}-morning"]`);
      await slotBtn.click();
      tapCount++;
    }
    expect(tapCount).toBeLessThanOrEqual(30);

    // 5. 提出ボタン押下
    const submitBtn = page.locator('[data-testid="btn-submit-availability"]');
    await expect(submitBtn).toBeVisible();
    await submitBtn.click();

    // 6. 完了メッセージ確認
    const successBanner = page.locator('[data-testid="submit-success-banner"]');
    await expect(successBanner).toBeVisible();
    await expect(successBanner).toContainText('希望を保存しました');
  });
});
