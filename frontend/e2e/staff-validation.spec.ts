/**
 * CUJ-3: スタッフマスタの3秒クイック登録・詳細設定・永続化
 *
 * 【修正前に何が起きていたか】
 *  - `expect(await minorCheckbox.isChecked()).toBe(true)` は直前に自分で check() した
 *    チェックボックスを見ているだけの恒真アサーションだった。
 *  - テスト名は「edit advanced settings via accordion」なのに、アコーディオンは
 *    `toBeVisible()` を確認するだけで一度も開かず、詳細設定を1つも編集していなかった
 *    （＝操作結果の状態変化を見ていない）。
 *  - 「18歳未満」フラグが本当に機能しているか（深夜シフトが遮断されるか）は未検証で、
 *    バッジ文字列が出ているかしか見ていなかった。
 *
 * 【このテストの方針】
 *  登録した内容が (1) 一覧の表示 (2) LocalStorage の実データ (3) リロード後
 *  (4) スタッフ提出画面での深夜ロックアウト挙動 の4箇所で一致することを検証する。
 */
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { ShiftOptimizeRequest, StaffMember } from '../src/lib/types';

const EV = '/tmp/claude-0/-home-user-foodshift-ai-scheduler/8cea9e3e-1847-5cca-ac45-5ec023e8495a/scratchpad/evidence/a2';

const NEW_NAME = '高校生バイト 田中';

/** 保存前（デモ表示中）は null が返る点に注意 */
async function readStoredRequest(page: Page): Promise<ShiftOptimizeRequest | null> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('foodshift_req_store_default');
    return raw ? JSON.parse(raw) : null;
  });
}

async function staffIdsFromDom(page: Page): Promise<string[]> {
  return page.$$eval('[data-testid^="staff-item-"]', (rows) =>
    rows.map((r) => (r.getAttribute('data-testid') as string).replace('staff-item-', ''))
  );
}

test.describe('CUJ-3: Staff Management & Validation Flow', () => {
  test('3秒クイック登録 → 詳細設定の編集 → 永続化 → 提出画面での深夜遮断まで一貫すること', async ({
    page,
  }) => {
    test.setTimeout(120000);
    await page.goto('/admin/staff');

    const rows = page.locator('tbody tr');
    const initialCount = await rows.count();
    expect(initialCount, 'デモ名簿が描画されていること').toBeGreaterThan(0);
    await page.screenshot({ path: `${EV}/staff-validation-01-list.png`, fullPage: true });

    // --- 3秒クイック登録（氏名・時給・18歳未満の3項目のみ） ---
    await page.locator('[data-testid="btn-add-staff"]').click();
    await expect(page.locator('h2:has-text("新規スタッフ登録")')).toBeVisible();

    await page.locator('[data-testid="input-staff-name"]').fill(NEW_NAME);
    await page.locator('[data-testid="input-staff-wage"]').fill('1050');
    const minorCheckbox = page.locator('label:has-text("18歳未満 (22時以降禁止)") input[type="checkbox"]');
    await minorCheckbox.check();

    // 最低賃金バリデーションが実際に効いていること（保存されずモーダルが残る）
    await page.locator('[data-testid="input-staff-wage"]').fill('500');
    await page.locator('[data-testid="btn-save-staff"]').click();
    await expect(page.locator('h2:has-text("新規スタッフ登録")')).toBeVisible();
    await expect(page.locator('text=時給は地域別最低賃金')).toBeVisible();
    const midway = await readStoredRequest(page);
    expect(
      (midway?.staff_members ?? []).some((s: StaffMember) => s.name === NEW_NAME),
      '不正な時給のまま保存されていないこと'
    ).toBe(false);
    await page.locator('[data-testid="input-staff-wage"]').fill('1050');

    await page.screenshot({ path: `${EV}/staff-validation-02-quick-form.png`, fullPage: true });
    await page.locator('[data-testid="btn-save-staff"]').click();
    await expect(page.locator('h2:has-text("新規スタッフ登録")')).toHaveCount(0);

    // --- 一覧・LocalStorage の両方に同じ内容が入っていること ---
    const stored = (await readStoredRequest(page)) as ShiftOptimizeRequest;
    expect(stored, '保存後は LocalStorage に実データが存在すること').toBeTruthy();
    const created = stored.staff_members.find((s: StaffMember) => s.name === NEW_NAME) as StaffMember;
    expect(created, '登録したスタッフが保存されていること').toBeTruthy();
    expect(created.is_minor).toBe(true);
    expect(created.hourly_wage).toBe(1050);

    const newRow = page.locator(`[data-testid="staff-item-${created.id}"]`);
    await expect(newRow).toBeVisible();
    await expect(newRow).toContainText(NEW_NAME);
    await expect(newRow).toContainText('満18歳未満 (深夜不可)');
    await expect(newRow).toContainText('¥1,050');
    await expect(rows).toHaveCount(initialCount + 1);
    await page.screenshot({ path: `${EV}/staff-validation-03-created-row.png`, fullPage: true });

    // --- 詳細設定アコーディオンを実際に開いて編集し、結果が反映されること ---
    await page.locator(`[data-testid="btn-edit-${created.id}"]`).click();
    await expect(page.locator(`h2:has-text("スタッフ編集: ${NEW_NAME}")`)).toBeVisible();

    const advancedToggle = page.locator('[data-testid="btn-toggle-advanced-staff"]');
    const consecutiveInput = page.locator(
      '.form-group:has(label:has-text("連続勤務上限日数")) input'
    );
    // 開く前は詳細項目が存在しないこと（＝アコーディオンが本当に開閉している証拠）
    await expect(consecutiveInput).toHaveCount(0);
    await advancedToggle.click();
    await expect(consecutiveInput).toBeVisible();
    await expect(consecutiveInput).toHaveValue(String(created.max_consecutive_days));

    await consecutiveInput.fill('3');
    // 保有ロールも詳細設定内で変更する
    await page.locator('button:has-text("キッチン (kitchen)")').click();
    await page.screenshot({ path: `${EV}/staff-validation-04-advanced-open.png`, fullPage: true });
    await page.locator('[data-testid="btn-save-staff"]').click();
    await expect(page.locator(`h2:has-text("スタッフ編集: ${NEW_NAME}")`)).toHaveCount(0);

    await expect(newRow).toContainText('連勤上限: 3日');
    await expect(newRow).toContainText('kitchen');
    const afterEdit = ((await readStoredRequest(page)) as ShiftOptimizeRequest).staff_members.find(
      (s: StaffMember) => s.id === created.id
    ) as StaffMember;
    expect(afterEdit.max_consecutive_days).toBe(3);
    expect(afterEdit.roles).toContain('kitchen');
    expect(afterEdit.is_minor).toBe(true);

    // --- リロード後も保持されていること (Invariant 3) ---
    await page.reload();
    const reloadedRow = page.locator(`[data-testid="staff-item-${created.id}"]`);
    await expect(reloadedRow).toBeVisible();
    await expect(reloadedRow).toContainText('満18歳未満 (深夜不可)');
    await expect(reloadedRow).toContainText('連勤上限: 3日');
    await page.screenshot({ path: `${EV}/staff-validation-05-after-reload.png`, fullPage: true });

    // --- 「18歳未満」が表示だけでなく実挙動に効いていること ---
    await page.goto('/submit');
    const staffSelect = page.locator('[data-testid="select-staff"]');
    await expect(staffSelect).toBeVisible({ timeout: 15000 });
    await staffSelect.selectOption(created.id);

    const lateShift = stored.shifts.find((s) => s.is_late_night);
    expect(lateShift, '深夜枠が存在すること').toBeTruthy();
    const lateBtn = page.locator(`[data-testid="btn-slot-0-${lateShift?.id}"]`);
    await expect(lateBtn).toBeVisible();
    await page.screenshot({ path: `${EV}/staff-validation-06-submit-lockout.png`, fullPage: true });
    await expect(lateBtn).toContainText('深夜NG 深夜禁止');
    await expect(lateBtn).toBeDisabled();

    // 対照: 一般スタッフでは同じ枠がタップ可能（常時 disabled ではないこと）
    const adult = stored.staff_members.find((s: StaffMember) => !s.is_minor) as StaffMember;
    await staffSelect.selectOption(adult.id);
    await expect(lateBtn).toBeEnabled();
  });

  test('スタッフを削除すると一覧・保存データの両方から消えること', async ({ page }) => {
    test.setTimeout(60000);
    await page.goto('/admin/staff');
    const idsBefore = await staffIdsFromDom(page);
    expect(idsBefore.length).toBeGreaterThan(0);
    const victimId = idsBefore[idsBefore.length - 1];

    page.once('dialog', (d) => d.accept());
    await page.locator(`[data-testid="btn-delete-${victimId}"]`).click();

    await expect(page.locator(`[data-testid="staff-item-${victimId}"]`)).toHaveCount(0);
    await page.screenshot({ path: `${EV}/staff-validation-07-after-delete.png`, fullPage: true });

    const after = (await readStoredRequest(page)) as ShiftOptimizeRequest;
    expect(after, '削除操作が LocalStorage に永続化されていること').toBeTruthy();
    expect(after.staff_members.some((s: StaffMember) => s.id === victimId)).toBe(false);
    expect(after.staff_members.length).toBe(idsBefore.length - 1);
    // 削除したスタッフの希望データも残っていないこと
    expect(after.availabilities.some((a) => a.staff_id === victimId)).toBe(false);

    await page.reload();
    await expect(page.locator(`[data-testid="staff-item-${victimId}"]`)).toHaveCount(0);
  });
});
