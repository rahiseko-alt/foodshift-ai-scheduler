/**
 * Disaster Recovery: バックアップ／復元の完全性
 *
 * 【修正前に何が起きていたか】
 *  - モーダルを開き、ボタンが `toBeVisible()` であることと、
 *    ダウンロードの suggestedFilename が 'foodshift_backup_' を含むことしか見ていなかった。
 *    ファイルの中身は一度も開いていないため、0バイトでも空JSONでも緑になる。
 *  - テスト名は「export/import integrity」だが、インポートは一切実行していなかった
 *    （＝復元できるかどうかを検証していない）。
 *  - スナップショット保存も、成功メッセージの文字列を見るだけで、
 *    履歴に実際に積まれたか（IndexedDB）は未検証だった。
 *
 * 【このテストの方針】
 *  実バックエンドで求解した実データを保存 ➔ エクスポートしたファイルを実際に読んで中身を照合 ➔
 *  データを破壊 ➔ そのファイルを取り込んで復元されることまでを検証する。
 */
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import * as fs from 'fs';
import type { ShiftOptimizeRequest, ShiftOptimizeResponse } from '../src/lib/types';

const EV = '/tmp/claude-0/-home-user-foodshift-ai-scheduler/8cea9e3e-1847-5cca-ac45-5ec023e8495a/scratchpad/evidence/a2';
const TMP = '/tmp/claude-0/-home-user-foodshift-ai-scheduler/8cea9e3e-1847-5cca-ac45-5ec023e8495a/scratchpad';

async function readStoredRequest(page: Page): Promise<ShiftOptimizeRequest | null> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('foodshift_req_store_default');
    return raw ? JSON.parse(raw) : null;
  });
}

/**
 * 実バックエンド (127.0.0.1:8000) に実際に解かせる。
 * /api/v1/optimize は 5req/分のレート制限付きなので、429 のときは
 * 画面に出る「再試行」ボタン（＝ユーザーと同じ操作）で再実行する。
 */
async function optimizeForReal(
  page: Page
): Promise<{ apiResponse: import('@playwright/test').Response; body: ShiftOptimizeResponse }> {
  const optimizeBtn = page.locator('[data-testid="btn-optimize"]');
  await expect(optimizeBtn).toBeVisible({ timeout: 60000 });

  // ハイドレーション完了の確認。SSR済みHTMLに対するクリックは無反応で、
  // 「押したのに何も起きない」テストになるため、状態変化を伴う操作で確認する。
  await page.locator('[data-testid="tab-view-slots"]').click();
  await expect(page.locator('[data-testid="shift-matrix"]')).toBeVisible({ timeout: 60000 });
  await page.locator('[data-testid="tab-view-timeline"]').click();
  await expect(page.locator('[data-testid="daily-timeline-view"]')).toBeVisible({ timeout: 60000 });

  for (let attempt = 0; attempt < 6; attempt++) {
    const responsePromise = page.waitForResponse(
      (res) => res.url().includes('/api/v1/optimize') && res.request().method() === 'POST',
      { timeout: 60000 }
    );
    if (attempt === 0) {
      await optimizeBtn.click();
    } else {
      await page.locator('[data-testid="error-message"] button', { hasText: '再試行' }).click();
    }
    const apiResponse = await responsePromise;

    if (apiResponse.status() === 429) {
      await expect(page.locator('[data-testid="error-message"]')).toContainText(
        'リクエスト回数制限'
      );
      await page.waitForTimeout(20000);
      continue;
    }

    expect(apiResponse.status(), '実バックエンドが200を返すこと').toBe(200);
    const body = (await apiResponse.json()) as ShiftOptimizeResponse;
    await expect(page.locator('[data-testid="loading-spinner"]')).toHaveCount(0);
    return { apiResponse, body };
  }
  throw new Error('optimize がレート制限で完了しませんでした');
}

test.describe('Disaster Recovery: Storage & Backup Integrity Flow', () => {
  test('実データをエクスポートしたJSONの中身が画面と一致し、破壊後にそれで復元できること', async ({
    page,
  }) => {
    test.setTimeout(240000);
    const backupPath = `${TMP}/e2e-backup-roundtrip.json`;
    if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);

    // --- 1. 実ソルバーで解を作り、保存対象を「実データ」にする ---
    await page.goto('/admin');
    const { body: solved } = await optimizeForReal(page);
    await expect(page.locator('[data-testid="cost-summary"]')).toBeVisible({ timeout: 15000 });

    const storedRequest = (await readStoredRequest(page)) as ShiftOptimizeRequest;
    expect(storedRequest, '最適化時にリクエストが永続化されること').toBeTruthy();
    const staffCountBefore = storedRequest.staff_members.length;

    // --- 2. 手動スナップショットが履歴（IndexedDB）に実際に積まれること ---
    await page.locator('[data-testid="btn-open-backup-modal"]').click();
    const exportBtn = page.locator('[data-testid="btn-export-backup-json"]');
    await expect(exportBtn).toBeVisible();
    await expect(page.locator('text=保存された履歴スナップショットはまだありません。')).toHaveCount(
      0
    ); // 最適化時に自動スナップショットが積まれている

    const snapshotRows = page.locator('div:has(> div > div:text-matches("^手動保存"))');
    await page.locator('[data-testid="btn-save-snapshot"]').click();
    await expect(
      page.locator('text=現在のシフト状態をスナップショットとして履歴保存しました。')
    ).toBeVisible();
    await expect(snapshotRows.first()).toBeVisible();
    await page.screenshot({ path: `${EV}/storage-backup-01-snapshot-saved.png`, fullPage: true });

    const snapshotCount = await page.evaluate(
      () =>
        new Promise<number>((resolve, reject) => {
          const req = indexedDB.open('FoodShiftDB');
          req.onerror = () => reject(new Error('indexedDB open failed'));
          req.onsuccess = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains('snapshots')) {
              resolve(-1);
              return;
            }
            const tx = db.transaction('snapshots', 'readonly');
            const countReq = tx.objectStore('snapshots').count();
            countReq.onsuccess = () => resolve(countReq.result);
            countReq.onerror = () => reject(new Error('count failed'));
          };
        })
    );
    expect(snapshotCount, 'IndexedDB にスナップショットが実際に保存されていること').toBeGreaterThan(
      0
    );

    // --- 3. エクスポートしたJSONの中身を実際に読む ---
    const downloadPromise = page.waitForEvent('download');
    await exportBtn.click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^foodshift_backup_store_default_\d{4}-\d{2}-\d{2}\.json$/);
    await download.saveAs(backupPath);
    await page.screenshot({ path: `${EV}/storage-backup-02-exported.png`, fullPage: true });

    const raw = fs.readFileSync(backupPath, 'utf-8');
    expect(raw.length, 'エクスポートファイルが空でないこと').toBeGreaterThan(1000);
    const bundle = JSON.parse(raw);

    expect(bundle.foodshift_version).toBe('1.0.0');
    expect(bundle.schema_version).toBe(1);
    expect(bundle.store_id).toBe('store_default');
    expect(String(bundle.checksum)).toMatch(/^crc32_[0-9a-f]+$/);
    // 中身が「いま画面に出ている実データ」であること
    expect(bundle.request.staff_members.length).toBe(staffCountBefore);
    expect(bundle.request.staff_members.map((s: { id: string }) => s.id)).toEqual(
      storedRequest.staff_members.map((s) => s.id)
    );
    expect(bundle.response.summary.total_labor_cost).toBe(solved.summary.total_labor_cost);
    expect(bundle.response.assigned_shifts.length).toBe((solved.assigned_shifts ?? []).length);
    expect(Array.isArray(bundle.snapshots)).toBe(true);
    expect(bundle.snapshots.length).toBeGreaterThan(0);

    // --- 4. データを破壊する（全スタッフのうち1名を削除 + 最適化結果を消す） ---
    await page.goto('/admin/staff');
    const victimId = storedRequest.staff_members[0].id;
    const victimName = storedRequest.staff_members[0].name;
    page.once('dialog', (d) => d.accept());
    await page.locator(`[data-testid="btn-delete-${victimId}"]`).click();
    await expect(page.locator(`[data-testid="staff-item-${victimId}"]`)).toHaveCount(0);
    const broken = (await readStoredRequest(page)) as ShiftOptimizeRequest;
    expect(broken.staff_members.length).toBe(staffCountBefore - 1);
    await page.screenshot({ path: `${EV}/storage-backup-03-after-破壊.png`, fullPage: true });

    // --- 5. 取り出したファイルから復元できること ---
    await page.goto('/admin');
    await page.locator('[data-testid="btn-open-backup-modal"]').click();
    await page.locator('[data-testid="btn-import-backup-json"]').click();
    await page.locator('input[type="file"]').setInputFiles(backupPath);

    await expect(page.locator('text=バックアップデータを正常に復元しました')).toBeVisible({
      timeout: 15000,
    });
    await page.screenshot({ path: `${EV}/storage-backup-04-restored.png`, fullPage: true });

    const restored = (await readStoredRequest(page)) as ShiftOptimizeRequest;
    expect(restored.staff_members.length, '削除したスタッフが復元されていること').toBe(
      staffCountBefore
    );
    expect(restored.staff_members.some((s) => s.id === victimId)).toBe(true);

    // 画面上でも復元されていること
    await page.goto('/admin/staff');
    const restoredRow = page.locator(`[data-testid="staff-item-${victimId}"]`);
    await expect(restoredRow).toBeVisible();
    await expect(restoredRow).toContainText(victimName);
    await page.screenshot({ path: `${EV}/storage-backup-05-staff-restored.png`, fullPage: true });
  });

  test('壊れたJSONを取り込んでも既存データを破壊せず、エラーを表示すること', async ({ page }) => {
    test.setTimeout(60000);
    const badPath = `${TMP}/e2e-backup-broken.json`;
    fs.writeFileSync(badPath, '{"foodshift_version":"1.0.0","request":{"period":{}}}');

    await page.goto('/admin/staff');
    await expect(page.locator('[data-testid="btn-add-staff"]')).toBeVisible({ timeout: 60000 });
    // まず自店データを保存させる（デモ状態では LocalStorage が空のため）
    const idsBefore = await page.$$eval('[data-testid^="staff-item-"]', (rows) =>
      rows.map((r) => (r.getAttribute('data-testid') as string).replace('staff-item-', ''))
    );
    page.once('dialog', (d) => d.accept());
    await page.locator(`[data-testid="btn-delete-${idsBefore[idsBefore.length - 1]}"]`).click();
    const beforeImport = (await readStoredRequest(page)) as ShiftOptimizeRequest;

    await page.goto('/admin');
    await page.locator('[data-testid="btn-open-backup-modal"]').click();
    await page.locator('[data-testid="btn-import-backup-json"]').click();
    await page.locator('input[type="file"]').setInputFiles(badPath);

    await expect(page.locator('text=インポート失敗')).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: `${EV}/storage-backup-06-broken-import.png`, fullPage: true });

    const afterImport = (await readStoredRequest(page)) as ShiftOptimizeRequest;
    expect(afterImport.staff_members.length).toBe(beforeImport.staff_members.length);
    expect(afterImport.staff_members.map((s) => s.id)).toEqual(
      beforeImport.staff_members.map((s) => s.id)
    );
  });
});
