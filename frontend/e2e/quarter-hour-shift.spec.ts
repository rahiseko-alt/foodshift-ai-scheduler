/**
 * CUJ-9: 15分刻みシフト枠の作成 ➔ スタッフ提出 ➔ 実ソルバーでの最適化
 *
 * 【修正前に何が起きていたか】
 *  1. 年少者の深夜ロックアウト検証が条件付きスキップだった:
 *       const minorCount = await minorOption.count();
 *       if (minorCount > 0) { ...ここでしか検証していない... }
 *     名簿に年少者が居ない状態（自店データに入れ替えた直後など）では
 *     労基法第60条の検証を1つもせずに緑になる。
 *  2. 最後の「最適化結果の検証」が `page.locator('text=5.5')` だった。
 *     この画面には作成した枠の「5.5時間」表示など 5.5 を含む要素が常にあるため、
 *     最適化が1件も返ってこなくても通る恒真アサーションだった。
 *  3. optimize を本番に存在しない形状（schedule に割当を詰め、assigned_shifts 無し）で
 *     モックしていたため、15分枠が実APIのスキーマ検証を通るのかを一切確認していなかった。
 */
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { ShiftOptimizeRequest, ShiftOptimizeResponse, StaffMember } from '../src/lib/types';

const EV = '/tmp/claude-0/-home-user-foodshift-ai-scheduler/8cea9e3e-1847-5cca-ac45-5ec023e8495a/scratchpad/evidence/a2';

const SLOT_NAME = '仕込みランチ15分枠';

async function readStoredRequest(page: Page): Promise<ShiftOptimizeRequest> {
  return page.evaluate(() => JSON.parse(localStorage.getItem('foodshift_req_store_default') as string));
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

/** /admin/shifts で 10:15〜15:45 (5.5h) の枠を作成し、保存された Shift を返す */
async function createQuarterHourSlot(page: Page) {
  await page.goto('/admin/shifts');
  const addSlotBtn = page.locator('[data-testid="btn-add-shift-slot"]');
  await expect(addSlotBtn).toBeVisible({ timeout: 60000 });
  await addSlotBtn.click();

  await page.fill('[data-testid="input-slot-name"]', SLOT_NAME);
  await page.fill('[data-testid="input-slot-start"]', '10:15');
  await page.fill('[data-testid="input-slot-end"]', '15:45');

  // 15分刻みの拘束時間が自動計算されること
  await expect(page.locator('[data-testid="input-slot-hours"]')).toHaveValue('5.5');
  await page.screenshot({ path: `${EV}/quarter-hour-01-slot-modal.png`, fullPage: true });

  const saveSlotBtn = page.locator('[data-testid="btn-save-slot"]');
  await saveSlotBtn.click();
  await expect(saveSlotBtn).not.toBeVisible({ timeout: 10000 });

  const stored = await readStoredRequest(page);
  const slot = stored.shifts.find((s) => s.name === SLOT_NAME);
  expect(slot, '作成した枠が LocalStorage に保存されていること').toBeDefined();
  return slot as NonNullable<typeof slot>;
}

test.describe('CUJ-9: 15-Minute Quarter-Hour Shift Creation, Submission & Optimization (実API)', () => {
  test('15分刻み枠が保存・描画され、実バックエンドの最適化に受理される', async ({ page }) => {
    test.setTimeout(180000);
    const slot = await createQuarterHourSlot(page);

    expect(slot.start).toBe('10:15');
    expect(slot.end).toBe('15:45');
    expect(slot.hours).toBe(5.5);
    expect(slot.is_late_night).toBe(false);

    // 一覧テーブルの該当行（IDで特定。テキスト一致の曖昧マッチではない）
    const row = page.locator(`[data-testid="slot-item-${slot.id}"]`);
    await expect(row).toBeVisible();
    await expect(row).toContainText('10:15 〜 15:45');
    await expect(row).toContainText('5.5時間');
    await page.screenshot({ path: `${EV}/quarter-hour-02-slot-row.png`, fullPage: true });

    // --- 実バックエンドが 0.25h 精度の枠を受理し、その解が画面に出ること ---
    await page.goto('/admin');
    const { apiResponse: res, body } = await optimizeForReal(page);

    // 送信ペイロードに 15分刻み枠が含まれていること（送っていなければ検証にならない）
    const sentPayload = JSON.parse(res.request().postData() as string) as ShiftOptimizeRequest;
    const sentSlot = sentPayload.shifts.find((s) => s.id === slot.id);
    expect(sentSlot, '15分刻み枠がAPIリクエストに含まれること').toBeTruthy();
    expect(sentSlot?.start).toBe('10:15');
    expect(sentSlot?.hours).toBe(5.5);
    expect(body.assigned_shifts?.length).toBeGreaterThan(0);

    await expect(page.locator('[data-testid="loading-spinner"]')).toHaveCount(0);
    const costSummary = page.locator('[data-testid="cost-summary"]');
    await expect(costSummary).toBeVisible({ timeout: 15000 });
    await page.screenshot({ path: `${EV}/quarter-hour-03-optimized-summary.png`, fullPage: true });

    // 「5.5 という文字列がどこかにある」ではなく、実レスポンスの値と一致することを見る
    await expect(costSummary).toContainText(`¥${body.summary.total_labor_cost.toLocaleString()}`);
    await expect(costSummary).toContainText(`${body.summary.total_work_hours}`);
    // Day1 の割当がタイムラインに描かれていること（条件付きスキップにしない）
    const day0 = (body.assigned_shifts ?? []).filter((s) => s.day_offset === 0);
    expect(day0.length, 'Day1に1人以上の割当があること').toBeGreaterThan(0);
    for (const shift of day0) {
      await expect(page.locator(`[data-testid="shift-bar-${shift.staff_id}"]`)).toContainText(
        `${shift.start_time}-${shift.end_time}`
      );
    }
  });

  test('年少者は深夜枠をタップできず、一般スタッフは同じ枠をタップできる（条件付きスキップなし）', async ({
    page,
  }) => {
    test.setTimeout(180000);
    await createQuarterHourSlot(page);

    await page.goto('/submit');
    const staffSelect = page.locator('[data-testid="select-staff"]');
    await expect(staffSelect).toBeVisible({ timeout: 60000 });

    const stored = await readStoredRequest(page);
    const minor = stored.staff_members.find((s: StaffMember) => s.is_minor);
    const adult = stored.staff_members.find((s: StaffMember) => !s.is_minor);
    // 名簿に年少者が居ないなら、この検証自体が成立しないので明示的に失敗させる
    expect(minor, '検証対象の年少者スタッフが名簿に存在すること').toBeTruthy();
    expect(adult, '対照群となる一般スタッフが名簿に存在すること').toBeTruthy();
    const lateShift = stored.shifts.find((s) => s.is_late_night);
    expect(lateShift, '22時以降にかかる深夜枠が存在すること').toBeTruthy();

    const lateBtn = page.locator(`[data-testid="btn-slot-0-${lateShift?.id}"]`);

    // --- 年少者: 深夜枠は disabled かつ「深夜禁止」表示 ---
    await staffSelect.selectOption((minor as StaffMember).id);
    await expect(lateBtn).toBeVisible();
    await page.screenshot({ path: `${EV}/quarter-hour-04-minor-lockout.png`, fullPage: true });
    await expect(lateBtn).toContainText('深夜NG 深夜禁止');
    await expect(lateBtn).toBeDisabled();

    // 実際にクリックイベントを飛ばしても状態が変わらないこと（見た目だけの disabled でないこと）
    await lateBtn.evaluate((b) => (b as HTMLElement).click());
    await expect(lateBtn).toContainText('深夜NG 深夜禁止');
    await expect(lateBtn).not.toContainText('希望 希望');

    // --- 一般スタッフ: 同じ枠がタップでき、状態が「希望」に変わること ---
    await staffSelect.selectOption((adult as StaffMember).id);
    await expect(lateBtn).toBeEnabled();
    await expect(lateBtn).toContainText('－ 通常');
    await lateBtn.click();
    await expect(lateBtn).toContainText('希望 希望');
    await page.screenshot({ path: `${EV}/quarter-hour-05-adult-can-tap.png`, fullPage: true });
  });

  test('15分刻み枠への希望提出が、正しい shift_id で保存される', async ({ page }) => {
    test.setTimeout(180000);
    const slot = await createQuarterHourSlot(page);

    await page.goto('/submit');
    const staffSelect = page.locator('[data-testid="select-staff"]');
    await expect(staffSelect).toBeVisible({ timeout: 60000 });

    const before = await readStoredRequest(page);
    const adult = before.staff_members.find((s: StaffMember) => !s.is_minor) as StaffMember;
    await staffSelect.selectOption(adult.id);

    // 作成した15分枠のボタンをIDで特定してタップ
    const slotButton = page.locator(`[data-testid="btn-slot-0-${slot.id}"]`);
    await expect(slotButton).toBeVisible();
    await expect(slotButton).toContainText('10:15-15:45');
    await slotButton.click();
    await expect(slotButton).toContainText('希望 希望');
    await page.screenshot({ path: `${EV}/quarter-hour-06-want-tapped.png`, fullPage: true });

    await page.locator('[data-testid="btn-submit-availability"]').click();
    const banner = page.locator('[data-testid="submit-success-banner"]');
    await expect(banner).toBeVisible({ timeout: 10000 });
    await expect(banner).toContainText('FS2|');
    await page.screenshot({ path: `${EV}/quarter-hour-07-submitted.png`, fullPage: true });

    // 提出された希望が、タップした枠のIDで保存されていること
    const after = await readStoredRequest(page);
    const mine = after.availabilities.filter((a) => a.staff_id === adult.id);
    const want = mine.find((a) => a.day_offset === 0 && a.status === 'want');
    expect(want, '希望が1件保存されていること').toBeTruthy();
    expect(
      want?.shift_id,
      `タップしたのは ${slot.id} なのに ${want?.shift_id} として保存されている（この希望はどのシフト枠にも紐付かない）`
    ).toBe(slot.id);
  });
});
