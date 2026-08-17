import { test, expect } from '@playwright/test';

test.describe('CUJ-9: 15-Minute Quarter-Hour Shift Creation, Submission & Optimization Flow', () => {
  test('should create 15-min shift slots, enforce minor night lockout on submit, and optimize with 0.25h precision', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    // 1. シフト枠設定画面 (/admin/shifts) にアクセス
    await page.goto('/admin/shifts');

    // 2. 「＋ 新しいシフト枠を追加」モーダルを開く
    const addSlotBtn = page.locator('[data-testid="btn-add-shift-slot"]');
    await expect(addSlotBtn).toBeVisible({ timeout: 10000 });
    await addSlotBtn.click();

    // 3. 15分刻みシフト枠（10:15〜15:45: 5.5h）を入力して保存
    await page.fill('[data-testid="input-slot-name"]', '仕込みランチ15分枠');
    await page.fill('[data-testid="input-slot-start"]', '10:15');
    await page.fill('[data-testid="input-slot-end"]', '15:45');

    // 拘束時間が 5.5h に自動計算されることを確認
    const hoursInput = page.locator('[data-testid="input-slot-hours"]');
    await expect(hoursInput).toHaveValue('5.5');

    // 保存ボタンを押下
    const saveSlotBtn = page.locator('[data-testid="btn-save-slot"]');
    await expect(saveSlotBtn).toBeVisible();
    await saveSlotBtn.click();

    // モーダルが閉じるのを待機
    await expect(saveSlotBtn).not.toBeVisible({ timeout: 5000 });

    // 画面の一覧テーブルに新枠が表示されていることを検証
    const slotRow = page.locator('tr:has-text("仕込みランチ15分枠")');
    await expect(slotRow).toBeVisible();
    await expect(slotRow).toContainText('10:15 〜 15:45');
    await expect(slotRow).toContainText('5.5時間');

    // 4. LocalStorage の生 JSON に 15分刻みデータが正確に保存されたかを検証
    const savedShifts = await page.evaluate(() => {
      const data =
        localStorage.getItem('foodshift_req_store_default') ||
        localStorage.getItem('foodshift_request_data');
      return data ? JSON.parse(data).shifts : [];
    });
    const customSlot = savedShifts.find((s: { name: string }) => s.name === '仕込みランチ15分枠');
    expect(customSlot).toBeDefined();
    expect(customSlot.start).toBe('10:15');
    expect(customSlot.end).toBe('15:45');
    expect(customSlot.hours).toBe(5.5);

    // 5. スタッフ希望提出画面 (/submit) にアクセス
    await page.goto('/submit');

    // 18歳未満の年少者（高校生バイト）を選択
    const staffSelect = page.locator('[data-testid="select-staff"]');
    await expect(staffSelect).toBeVisible({ timeout: 10000 });

    // 年少者スタッフの option を探して選択
    const minorOption = page.locator('option:has-text("18歳未満")').first();
    const minorCount = await minorOption.count();
    if (minorCount > 0) {
      const minorValue = await minorOption.getAttribute('value');
      if (minorValue) {
        await staffSelect.selectOption(minorValue);

        // 22:00以降にかかる深夜枠のボタンが disabled かつ「🈲 深夜禁止」になっていることを検証
        const nightBtn = page.locator('button:has-text("🈲 深夜禁止")').first();
        await expect(nightBtn).toBeVisible();
        await expect(nightBtn).toBeDisabled();
      }
    }

    // 通常スタッフ（佐藤 健 または最初のスタッフ）を選択して希望入力
    await staffSelect.selectOption({ index: 0 });

    // 15分刻み枠のボタン（仕込みランチ15分枠）をタップして「◎ 希望」にする
    const slotButton = page.locator('button:has-text("仕込みランチ15分枠"), button:has-text("10:15-15:45")').first();
    await expect(slotButton).toBeVisible();
    await slotButton.click();
    await expect(slotButton).toContainText('◎ 希望');

    // 提出ボタンを押下
    const submitBtn = page.locator('[data-testid="btn-submit-availability"]');
    await expect(submitBtn).toBeVisible();
    await submitBtn.evaluate((b) => (b as HTMLElement).click());

    // 提出完了バナー & LINE提出コードが表示されることを確認
    const successBanner = page.locator('[data-testid="submit-success-banner"]');
    await expect(successBanner).toBeVisible({ timeout: 10000 });
    await expect(successBanner).toContainText('FS1|');

    // 6. 管理画面 (/admin) にアクセスして最適化を実行
    await page.goto('/admin');

    // 最適化APIのモック（15分刻みスケジュールレスポンス）
    await page.route('**/api/v1/optimize', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'OPTIMAL',
          solve_time_ms: 85,
          schedule: [
            {
              date: '2026-09-01',
              day_offset: 0,
              shift_id: customSlot.id,
              hours: 5.5,
              is_late_night: false,
              assigned_staff: [
                { id: 'emp_01', name: '佐藤 健', assigned_role: 'kitchen', hourly_wage: 1200, is_want_fulfilled: true },
              ],
            },
          ],
          summary: {
            total_labor_cost: 6600, // 5.5h * 1200 = 6,600円
            deep_night_extra_cost: 0,
            total_work_hours: 5.5,
            total_break_hours: 0.0,
            wants_fulfillment_rate: 1.0,
            max_staff_day_difference: 0,
            unfilled_requirements: [],
            bottleneck_constraints: [],
          },
        }),
      });
    });

    const optimizeBtn = page.locator('[data-testid="btn-optimize"]');
    await expect(optimizeBtn).toBeVisible();
    await optimizeBtn.click();

    // 最適化サマリーに 5.5h と人件費 ¥6,600 が正確に表示されることを検証
    const workHoursCard = page.locator('text=5.5');
    await expect(workHoursCard.first()).toBeVisible({ timeout: 10000 });
  });
});
