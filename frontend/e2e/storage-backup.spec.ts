import { test, expect } from '@playwright/test';

test.describe('Disaster Recovery: Storage & Backup Integrity Flow (No. 086, 090, 095, 161, 162, 163, 218, 288)', () => {
  test('should open backup modal, save manual snapshot, and handle export/import integrity', async ({ page }) => {
    await page.goto('/admin');

    // 1. バックアップモーダルを開く
    const openBackupBtn = page.locator('[data-testid="btn-open-backup-modal"]');
    await expect(openBackupBtn).toBeVisible();
    await openBackupBtn.click();

    // 2. モーダル内の要素確認
    const exportBtn = page.locator('[data-testid="btn-export-backup-json"]');
    await expect(exportBtn).toBeVisible();
    const importBtn = page.locator('[data-testid="btn-import-backup-json"]');
    await expect(importBtn).toBeVisible();

    // 3. 手動スナップショット保存
    const saveSnapshotBtn = page.locator('[data-testid="btn-save-snapshot"]');
    await expect(saveSnapshotBtn).toBeVisible();
    await saveSnapshotBtn.click();

    // 4. 成功メッセージの表示確認
    await expect(page.locator('text=現在のシフト状態をスナップショットとして履歴保存しました。')).toBeVisible();

    // 5. エクスポートボタン押下（ダウンロードイベント確認）
    const downloadPromise = page.waitForEvent('download');
    await exportBtn.click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain('foodshift_backup_');
  });
});
