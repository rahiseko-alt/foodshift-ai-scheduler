import { test, expect } from '@playwright/test';

test.describe('CUJ-8: Shortage Candidate Scoring & LINE Negotiation Flow', () => {
  test('should detect unfilled slot, open negotiation assistant, display ranked candidates, and copy request LINE message', async ({
    page,
    context,
  }) => {
    // クリップボード権限の付与
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    // 1. 最適化APIのモック（7日間分の完全なスケジュールと不足枠1件）をgoto前に設定
    const fullSchedule: Array<Record<string, unknown>> = [];
    const shifts = ['lunch', 'dinner', 'late'];
    for (let d = 0; d < 7; d++) {
      for (const s of shifts) {
        fullSchedule.push({
          day_offset: d,
          date: `2026-09-0${d + 1}`,
          shift_id: s,
          hours: s === 'dinner' ? 5.5 : 4.0,
          is_late_night: s === 'late',
          assigned_staff:
            d === 4 && s === 'dinner'
              ? [] // 金曜ディナーを不足にする
              : [{ id: 'emp_01', name: '佐藤 健', assigned_role: 'キッチン', hourly_wage: 1200, is_want_fulfilled: true }],
        });
      }
    }

    await page.route('**/api/v1/optimize', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'FEASIBLE_WITH_SHORTAGE',
          solve_time_ms: 120,
          schedule: fullSchedule,
          summary: {
            total_labor_cost: 250000,
            total_work_hours: 180.0,
            total_break_hours: 15.0,
            deep_night_extra_cost: 15000,
            wants_fulfillment_rate: 0.85,
            max_staff_day_difference: 2,
            unfilled_requirements: [
              {
                date: '2026-09-05',
                day_offset: 4,
                shift_id: 'dinner',
                required_count: 2,
                assigned_count: 0,
                shortage: 2,
                reason: '金曜ディナー希望者不足',
              },
            ],
            bottleneck_constraints: [],
          },
        }),
      });
    });

    // 2. 管理画面 (/admin) にアクセス
    await page.goto('/admin');

    const optimizeBtn = page.locator('[data-testid="btn-optimize"]');
    await expect(optimizeBtn).toBeVisible();

    const responsePromise = page.waitForResponse((res) => res.url().includes('optimize'));
    await optimizeBtn.click();
    await responsePromise;

    // 3. 不足アラートバナー内の「🚨 ... 不足 (代打を探す)」ボタンを押下
    const shortageAlertBtn = page.locator('[data-testid*="btn-unfilled-slot"]').first();
    await expect(shortageAlertBtn).toBeVisible({ timeout: 10000 });
    await shortageAlertBtn.click();

    // 4. 人手不足解消アシスタントモーダルが表示されることを確認
    const modalHeading = page.locator('h2:has-text("人手不足解消アシスタント")');
    await expect(modalHeading).toBeVisible();

    // 候補スタッフカードが描画されていることを確認
    const candidateCards = page.locator('text=適格スコア');
    await expect(candidateCards.first()).toBeVisible();

    // 5. 1位の候補の「お願いLINE文面をコピー」ボタンを押下
    const copyBtn = page.locator('button:has-text("お願いLINE文面をコピー")').first();
    await expect(copyBtn).toBeVisible();
    await copyBtn.click();

    // 6. コピー完了トーストまたはボタン状態変化を確認
    const toast = page.locator('[data-testid="admin-toast-banner"]');
    await expect(toast).toBeVisible();
    await expect(toast).toContainText('LINE文面をコピーしました');
  });
});
