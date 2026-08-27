import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';

const EVIDENCE = '/tmp/claude-0/-home-user-foodshift-ai-scheduler/8cea9e3e-1847-5cca-ac45-5ec023e8495a/scratchpad/evidence/a1';

interface BackupBundle {
  foodshift_version: string;
  store_id: string;
  checksum: string;
  request: {
    staff_members: { id: string; name: string; hourly_wage: number }[];
    shifts: { id: string }[];
    requirements: { day_offset: number; shift_id: string; min_staff: number }[];
  };
  snapshots?: { label: string }[];
}

/** /admin/shifts の「日別必要人数マトリクス」で Day1 / 早番の必要人数入力欄を返す */
function day1MorningRequirement(page: Page) {
  return page
    .locator('table.modern-table tbody tr')
    .first()
    .locator('input[type="text"]')
    .first();
}

async function setDay1MorningRequirement(page: Page, value: string) {
  await page.goto('/admin/shifts');
  await page.getByRole('button', { name: '日別必要人数マトリクス' }).click();
  const input = day1MorningRequirement(page);
  await expect(input).toBeVisible();
  await input.fill(value);
  await expect(input).toHaveValue(value);
}

test.describe('CUJ-4: Store Backup, Snapshot History & Restore Flow', () => {
  test('should open backup modal, save manual snapshot, export JSON bundle, and verify restore mechanisms', async ({
    page,
  }) => {
    // 0. 「バックアップに実データが入っているか」「復元で本当に戻るか」を
    //    見分けられるよう、他と絶対に混ざらない目印を店舗データに書き込む。
    //    従来はファイル名しか見ておらず、空JSONを吐く実装でも合格していた。
    await setDay1MorningRequirement(page, '9');

    // 1. /admin にアクセス
    await page.goto('/admin');

    // 2. バックアップ＆復元モーダルを開くボタンをクリック
    const backupBtn = page.locator('[data-testid="btn-open-backup-modal"]');
    await expect(backupBtn).toBeVisible();
    await backupBtn.click();

    // 3. モーダルの表示確認
    const modalHeading = page.locator('h2:has-text("店舗データ完全バックアップ ＆ 復元")');
    await expect(modalHeading).toBeVisible();

    // 4. 手動スナップショット保存。保存前は「まだありません」が出ていることを
    //    確認しておき、押した結果その表示が消えて履歴が増えることを見る。
    const emptyHistory = page.getByText('保存された履歴スナップショットはまだありません。');
    await expect(emptyHistory).toBeVisible();

    const saveSnapshotBtn = page.locator('[data-testid="btn-save-snapshot"]');
    await expect(saveSnapshotBtn).toBeVisible();
    await saveSnapshotBtn.click();

    // 5. 成功メッセージ ＆ スナップショット一覧の更新を確認（状態変化の検証）
    await expect(page.getByText('現在のシフト状態をスナップショットとして履歴保存しました。')).toBeVisible();
    await expect(emptyHistory).toHaveCount(0);
    const snapshotItem = page.getByText(/^手動保存 \(/);
    await expect(snapshotItem.first()).toBeVisible({ timeout: 5000 });

    await page.screenshot({ path: `${EVIDENCE}/backup-restore-01-snapshot-saved.png`, fullPage: true });

    // 6. 一括JSONエクスポート
    const exportJsonBtn = page.locator('[data-testid="btn-export-backup-json"]');
    await expect(exportJsonBtn).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await exportJsonBtn.click();
    const download = await downloadPromise;

    // ファイル名形式の検証
    expect(download.suggestedFilename()).toMatch(/^foodshift_backup_.*\.json$/);

    // 7. ★ ファイル名だけでは中身が空でも通る。実際に落ちたJSONを読む。
    const savedPath = await download.path();
    expect(savedPath).toBeTruthy();
    const bundle = JSON.parse(fs.readFileSync(savedPath as string, 'utf-8')) as BackupBundle;

    expect(bundle.foodshift_version).toBeTruthy();
    expect(bundle.store_id).toBe('store_default');
    expect(bundle.checksum).toMatch(/^crc32_[0-9a-f]+$/);
    expect(bundle.request.staff_members.length).toBeGreaterThanOrEqual(15);
    expect(bundle.request.staff_members.every((s) => s.id && s.name && s.hourly_wage > 0)).toBe(true);
    expect(bundle.request.shifts.map((s) => s.id)).toContain('late_night');
    // 直前に画面から入力した目印がバックアップに入っていること
    const day1Morning = bundle.request.requirements.find(
      (r) => r.day_offset === 0 && r.shift_id === 'morning'
    );
    expect(day1Morning?.min_staff).toBe(9);
    // 手動保存したスナップショットも同梱されていること
    expect((bundle.snapshots ?? []).some((s) => s.label.startsWith('手動保存'))).toBe(true);

    // 8. モーダルを閉じる（曖昧なテキスト検索ではなく、閉じるボタンを名指しする）
    await page.getByRole('button', { name: '閉じる' }).click();
    await expect(modalHeading).toHaveCount(0);

    // 9. ★ 「復元の仕組みを検証する」と名乗りながら、従来は一度も復元を
    //    実行していなかった。目印を別の値に書き換えてから、
    //    落としたJSONで本当に元へ戻ることを確認する。
    await setDay1MorningRequirement(page, '1');

    await page.goto('/admin');
    await page.locator('[data-testid="btn-open-backup-modal"]').click();
    await expect(page.locator('h2:has-text("店舗データ完全バックアップ ＆ 復元")')).toBeVisible();

    await page.locator('input[type="file"]').setInputFiles(savedPath as string);
    await expect(page.getByText(/バックアップデータを正常に復元しました/)).toBeVisible({ timeout: 5000 });

    await page.screenshot({ path: `${EVIDENCE}/backup-restore-02-restored.png`, fullPage: true });

    // 10. 復元結果が実データに反映されていること（画面と保存領域の両方）
    const restored = await page.evaluate(() => {
      const raw = localStorage.getItem('foodshift_req_store_default');
      return raw
        ? (JSON.parse(raw) as { requirements: { day_offset: number; shift_id: string; min_staff: number }[] })
        : null;
    });
    expect(restored).not.toBeNull();
    expect(
      restored!.requirements.find((r) => r.day_offset === 0 && r.shift_id === 'morning')?.min_staff
    ).toBe(9);

    await page.goto('/admin/shifts');
    await page.getByRole('button', { name: '日別必要人数マトリクス' }).click();
    await expect(day1MorningRequirement(page)).toHaveValue('9');

    await page.screenshot({ path: `${EVIDENCE}/backup-restore-03-requirement-back-to-9.png`, fullPage: true });
  });
});
