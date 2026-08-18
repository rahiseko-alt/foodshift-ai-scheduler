import { test, expect } from '@playwright/test';

test.describe('CUJ-11: 1-Hour Time-Slot Shift & Dual-View (Daily Timeline & Monthly Matrix)', () => {
  test('should optimize with hourly time-slots and switch between Daily Timeline and Monthly Matrix views', async ({
    page,
  }) => {
    // 1. API モックレスポンスを設定
    await page.route('**/api/v1/optimize', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'OPTIMAL',
          solve_time_ms: 42,
          summary: {
            total_labor_cost: 320000,
            total_work_hours: 240.0,
            total_break_hours: 18.0,
            deep_night_extra_cost: 15000,
            wants_fulfillment_rate: 1.0,
            max_staff_day_difference: 2,
            unfilled_requirements: [],
            bottleneck_constraints: [],
          },
          schedule: [],
          assigned_shifts: [
            {
              staff_id: 'emp_01',
              name: '佐藤 店長 (社員)',
              day_offset: 0,
              date: '2026-09-01',
              start_time: '11:00',
              end_time: '15:00',
              hours: 4.0,
              break_minutes: 0,
              hourly_wage: 1500,
              labor_cost: 6000,
              is_late_night: false,
            },
            {
              staff_id: 'emp_02',
              name: '田中 副店長 (社員)',
              day_offset: 0,
              date: '2026-09-01',
              start_time: '10:00',
              end_time: '14:00',
              hours: 4.0,
              break_minutes: 0,
              hourly_wage: 1400,
              labor_cost: 5600,
              is_late_night: false,
            },
            {
              staff_id: 'emp_01',
              name: '佐藤 店長 (社員)',
              day_offset: 1,
              date: '2026-09-02',
              start_time: '17:00',
              end_time: '22:00',
              hours: 5.0,
              break_minutes: 45,
              hourly_wage: 1500,
              labor_cost: 7500,
              is_late_night: false,
            },
          ],
          hourly_schedule: [
            {
              date: '2026-09-01',
              day_offset: 0,
              hour: 12,
              required_count: 5,
              assigned_staff_ids: ['emp_01', 'emp_02'],
              shortage: 0,
            },
          ],
        }),
      });
    });

    // 2. 管理画面 (/admin) にアクセス
    await page.goto('/admin');

    // 3. タブ切り替えボタンの存在確認
    const timelineTab = page.locator('[data-testid="tab-view-timeline"]');
    const monthlyTab = page.locator('[data-testid="tab-view-monthly"]');
    const slotsTab = page.locator('[data-testid="tab-view-slots"]');

    await expect(timelineTab).toBeVisible();
    await expect(monthlyTab).toBeVisible();
    await expect(slotsTab).toBeVisible();

    // 4. 最適化ボタンを押下
    const optimizeBtn = page.locator('[data-testid="btn-optimize"]');
    await expect(optimizeBtn).toBeVisible();
    await optimizeBtn.click();

    // サマリー表示の待機
    await expect(page.locator('[data-testid="roi-summary-card"]')).toBeVisible({ timeout: 10000 });

    // 5. 【日別タイムラインビュー】の検証
    await expect(page.locator('[data-testid="daily-timeline-view"]')).toBeVisible();
    await expect(page.locator('[data-testid="current-day-label"]')).toContainText('Day 1');

    // 1時間ごとの充足状況（12時）の表示確認
    const stat12 = page.locator('[data-testid="hourly-stat-12"]');
    await expect(stat12).toBeVisible();

    // 翌日ボタンで日付を切り替え
    const nextDayBtn = page.locator('[data-testid="btn-next-day"]');
    await nextDayBtn.click();
    await expect(page.locator('[data-testid="current-day-label"]')).toContainText('Day 2');

    // 6. 【月間スタッフ一覧マトリクスビュー】への切り替えと検証
    await monthlyTab.click();
    await expect(page.locator('[data-testid="monthly-matrix-view"]')).toBeVisible();

    // スタッフの月間一覧行が表示されること
    const staffRow = page.locator('[data-testid^="monthly-row-"]').first();
    await expect(staffRow).toBeVisible();

    // 7. 再度日別タイムラインに戻れること
    await timelineTab.click();
    await expect(page.locator('[data-testid="daily-timeline-view"]')).toBeVisible();
  });
});
