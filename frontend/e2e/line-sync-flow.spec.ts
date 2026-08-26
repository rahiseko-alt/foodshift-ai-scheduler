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

    // 3. Day1 の枠をタップして「希望」にする
    //
    // 以前は `if (count > 0)` で囲まれた曖昧なテキスト検索で、
    // 一致しなければ何もタップせずに素通りしていた。その結果
    // 希望ゼロのコード（FS2|...|1|）を提出しており、
    // 「提出して取り込む」という筋書きでありながら中身を一切検証できていなかった。
    const firstSlot = page.locator('[data-testid^="btn-slot-0-"]').first();
    await expect(firstSlot).toBeVisible();
    await firstSlot.click(); // available -> want
    await expect(firstSlot).toContainText('希望');

    // 4. 「シフト希望を提出する」を押下
    const submitBtn = page.locator('[data-testid="btn-submit-availability"]');
    await expect(submitBtn).toBeVisible();
    await submitBtn.click();

    // 5. 提出完了カードおよび LINE 提出コードが表示されていることを確認
    const banner = page.locator('[data-testid="submit-success-banner"]');
    await expect(banner).toBeVisible();

    const codeContainer = page.locator('text=FS2|');
    await expect(codeContainer).toBeVisible();
    const fullText = await codeContainer.textContent();
    expect(fullText).toContain('FS2|');

    // 提出コードを抽出
    // FS2 は日数フィールドを持つ（送信側と受信側の日数不一致による破損を防ぐため）
    const match = fullText?.match(/FS2\|[a-zA-Z0-9_\-]+\|\d{4}-\d{2}-\d{2}\|\d+\|[a-zA-Z0-9]+\|[0-9a-fA-F]{4}/);
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

    // 13. 取り込んだ希望が「入力した日付のまま」保存されていること
    //
    // 従来はスタッフ側が7日分で送信し店長側が14日分として解釈していたため、
    // Day1〜7 の希望が Day8〜14 にズレて取り込まれ、Day1〜7 は全て「不可」に
    // なっていた。しかもエラーにならず成功トーストが出るため誰も気づけなかった。
    // 形式の検証だけでは検出できないので、日付の整合そのものを検証する。
    const stored = await page.evaluate(() => {
      const raw = localStorage.getItem('foodshift_req_store_default');
      return raw ? JSON.parse(raw) : null;
    });
    expect(stored).not.toBeNull();
    const submitted = (stored.availabilities || []).filter(
      (a: { status: string }) => a.status !== 'unavailable'
    );
    expect(submitted.length).toBeGreaterThan(0);
    // スタッフ画面は直近7日分しか入力できないため、
    // 取り込み結果が8日目以降に現れたら日付がズレている
    const maxDay = Math.max(...submitted.map((a: { day_offset: number }) => a.day_offset));
    expect(maxDay).toBeLessThan(7);
  });
});
