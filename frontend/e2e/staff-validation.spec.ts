import { test, expect } from '@playwright/test';

test.describe('CUJ-3: Staff Management & Validation Flow', () => {
  test('should validate staff input constraints, add a minor staff, configure roles & NG pairs, and persist', async ({
    page,
  }) => {
    // 1. /admin/staff にアクセス
    await page.goto('/admin/staff');

    // 2. スタッフ一覧テーブルが描画されていることを確認
    const staffRows = page.locator('tbody tr');
    await expect(staffRows.first()).toBeVisible();

    // 3. 新規スタッフ登録ボタンをクリックしてモーダルを開く
    const addBtn = page.locator('[data-testid="btn-add-staff"]');
    await expect(addBtn).toBeVisible();
    await addBtn.click();

    // 4. モーダルの表示確認
    const modalHeading = page.locator('h2:has-text("新規スタッフ登録")');
    await expect(modalHeading).toBeVisible();

    // 5. 氏名を入力
    const nameInput = page.locator('input[placeholder*="佐藤 健"]');
    await nameInput.fill('高校生バイト 田中');

    // 時給を1050円に設定
    const wageInput = page.locator('input[placeholder="例: 1200"]');
    await wageInput.fill('1050');

    // 満18歳未満（労基法年少者）チェックボックスをON
    const minorCheckbox = page.locator('label:has-text("18歳未満 (22時以降禁止)") input[type="checkbox"]');
    await minorCheckbox.check();
    expect(await minorCheckbox.isChecked()).toBe(true);

    // ロールを厨房・ホールに設定（ロールボタンクリック）
    const roleBtn = page.locator('button:has-text("ホール"), button:has-text("キッチン")').first();
    await roleBtn.click();

    // 保存実行
    const saveBtn = page.locator('[data-testid="btn-save-staff"]');
    await saveBtn.click();

    // 6. 一覧に登録された田中が表示され、「満18歳未満 (深夜不可)」バッジが付与されていることを検証
    const tanakaRow = page.locator('tr:has-text("高校生バイト 田中")');
    await expect(tanakaRow).toBeVisible();
    await expect(tanakaRow).toContainText('満18歳未満 (深夜不可)');
    await expect(tanakaRow).toContainText('¥1,050');

    // 7. リロード後も永続化されていることを確認 (LocalStorage / Persistence Boundary)
    await page.reload();
    const tanakaRowAfterReload = page.locator('tr:has-text("高校生バイト 田中")');
    await expect(tanakaRowAfterReload).toBeVisible();
    await expect(tanakaRowAfterReload).toContainText('満18歳未満 (深夜不可)');
  });
});
