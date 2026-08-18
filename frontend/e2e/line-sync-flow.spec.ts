import { test, expect } from '@playwright/test';

test.describe('CUJ-7: LINE Submission & Manager Bulk Import Flow (0-Yen Stateless Sync)', () => {
  test('should generate LINE submission code on staff submit and successfully import it on admin dashboard', async ({
    page,
  }) => {
    // 1. スタッフ希望提出画面 (/submit) にアクセス
    await page.goto('/submit');

    // 2. スタッフを選択
    const staffSelect = page.locator('#staff-select');
    await expect(staffSelect).toBeVisible();
    await staffSelect.selectOption({ index: 1 }); // 2番目のスタッフを選択

    // 3. いくつかの枠をタップ（希望入力）
    const availButtons = page.locator('button:has-text("不可 不可")');
    if (await availButtons.count() > 0) {
      await availButtons.first().click(); // 可 可能に切り替え
    }

    // 4. 「シフト希望を提出する」を押下
    const submitBtn = page.locator('[data-testid="btn-submit-availability"]');
    await expect(submitBtn).toBeVisible();
    await submitBtn.click();

    // 5. 提出完了カードおよび LINE 提出コードが表示されていることを確認
    const banner = page.locator('[data-testid="submit-success-banner"]');
    await expect(banner).toBeVisible();

    const codeContainer = page.locator('text=FS1|');
    await expect(codeContainer).toBeVisible();
    const fullText = await codeContainer.textContent();
    expect(fullText).toContain('FS1|');

    // 提出コードを抽出
    const match = fullText?.match(/FS1\|[a-zA-Z0-9_\-]+\|\d{4}-\d{2}-\d{2}\|[a-zA-Z0-9]+\|[0-9a-fA-F]{4}/);
    expect(match).not.toBeNull();
    const lineCode = match ? match[0] : '';

    // 6. 店長画面 (/admin) に遷移
    await page.goto('/admin');

    // 7. 「LINE希望取込」ボタンを押下してモーダルを開く
    const openImportBtn = page.locator('[data-testid="btn-open-line-import"]');
    await expect(openImportBtn).toBeVisible();
    await openImportBtn.click();

    // 8. LINEトーク履歴風のテキスト（雑談混ざり）をテキストエリアに入力
    const lineTextArea = page.locator('textarea');
    await expect(lineTextArea).toBeVisible();
    await lineTextArea.fill(`店長お疲れ様です！希望提出します！ ${lineCode} よろしくお願いします！`);

    // 9. 「提出コードを解析する」を押下
    const analyzeBtn = page.locator('button:has-text("提出コードを解析する")');
    await analyzeBtn.click();

    // 10. 解析結果プレビューに「取込可能」バッジが表示されることを確認
    const validBadge = page.locator('text=取込可能');
    await expect(validBadge).toBeVisible();

    // 11. 「有効な 1 件を一括反映する」を押下
    const applyBtn = page.locator('button:has-text("一括反映する")');
    await expect(applyBtn).toBeVisible();
    await applyBtn.click();

    // 12. トースト通知が表示され、モーダルが閉じることを確認
    const toast = page.locator('[data-testid="admin-toast-banner"]');
    await expect(toast).toBeVisible({ timeout: 5000 });
    await expect(toast).toContainText('LINEから');
  });
});
