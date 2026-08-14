import { test, expect } from '@playwright/test';

test.describe('CUJ-1: Admin Schedule Optimization & Sharing Flow', () => {
  test('should load preset data, optimize schedule, copy LINE text, and persist across reload', async ({
    page,
    context,
  }) => {
    // クリップボード権限の付与
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    // 1. /admin にアクセス
    await page.goto('/admin');

    // 2. プリセットデータ描画確認
    const matrix = page.locator('[data-testid="shift-matrix"]');
    await expect(matrix).toBeVisible();

    // 3. 最適化ボタン押下
    const optimizeBtn = page.locator('[data-testid="btn-optimize"]');
    await expect(optimizeBtn).toBeVisible();
    await optimizeBtn.click();

    // 4. 計算結果の描画待機とサマリー確認
    const costSummary = page.locator('[data-testid="cost-summary"]');
    await expect(costSummary).toBeVisible({ timeout: 10000 });
    await expect(costSummary).toContainText('人件費合計');
    await expect(costSummary).toContainText('希望シフト充足率');
    await expect(costSummary).toContainText('100%遵守');

    // 5. LINE共有テキスト作成
    const copyLineBtn = page.locator('[data-testid="btn-copy-line"]');
    await expect(copyLineBtn).toBeVisible();
    await copyLineBtn.click();
    await expect(copyLineBtn).toContainText('コピー完了');

    // クリップボード内容の検証
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toContain('【FoodShift 確定シフト】');
    expect(clipboardText).toContain('人件費合計: ¥');

    // 6. CSVダウンロードボタンの存在確認
    const downloadCsvBtn = page.locator('[data-testid="btn-download-csv"]');
    await expect(downloadCsvBtn).toBeVisible();

    // 7. リロード後のデータ永続性確認 (Persistence Boundary)
    await page.reload();
    await expect(costSummary).toBeVisible();
    await expect(costSummary).toContainText('人件費合計');
    await expect(matrix).toBeVisible();
  });
});
