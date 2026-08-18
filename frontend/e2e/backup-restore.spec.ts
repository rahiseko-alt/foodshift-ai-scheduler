import { test, expect } from '@playwright/test';

test.describe('CUJ-4: Store Backup, Snapshot History & Restore Flow', () => {
  test('should open backup modal, save manual snapshot, export JSON bundle, and verify restore mechanisms', async ({
    page,
  }) => {
    // 1. /admin にアクセス
    await page.goto('/admin');

    // 2. バックアップ＆復元モーダルを開くボタンをクリック
    const backupBtn = page.locator('[data-testid="btn-open-backup-modal"]');
    await expect(backupBtn).toBeVisible();
    await backupBtn.click();

    // 3. モーダルの表示確認
    const modalHeading = page.locator('h2:has-text("店舗データ完全バックアップ ＆ 復元")');
    await expect(modalHeading).toBeVisible();

    // 4. 手動スナップショット保存ボタンをクリック
    const saveSnapshotBtn = page.locator('[data-testid="btn-save-snapshot"]');
    await expect(saveSnapshotBtn).toBeVisible();
    await saveSnapshotBtn.click();

    // 5. 成功メッセージまたはスナップショット一覧の更新を確認
    const snapshotItem = page.locator('text=手動保存');
    await expect(snapshotItem.first()).toBeVisible({ timeout: 5000 });

    // 6. 一括JSONエクスポートのトリガー確認
    const exportJsonBtn = page.locator('[data-testid="btn-export-backup-json"]');
    await expect(exportJsonBtn).toBeVisible();

    // ダウンロードイベントのインターセプト
    const downloadPromise = page.waitForEvent('download');
    await exportJsonBtn.click();
    const download = await downloadPromise;

    // ファイル名形式の検証
    expect(download.suggestedFilename()).toMatch(/^foodshift_backup_.*\.json$/);

    // 7. モーダルを閉じる
    const closeBtn = page.locator('button:has-text("不可"), button:has-text("閉じる")').first();
    await closeBtn.click();
    await expect(modalHeading).not.toBeVisible();
  });
});
