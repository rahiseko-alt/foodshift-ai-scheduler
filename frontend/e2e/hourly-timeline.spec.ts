import { test, expect } from '@playwright/test';

const EVIDENCE = '/tmp/claude-0/-home-user-foodshift-ai-scheduler/8cea9e3e-1847-5cca-ac45-5ec023e8495a/scratchpad/evidence/a1';

test.describe('CUJ-11: 1-Hour Time-Slot Shift & Dual-View (Daily Timeline & Monthly Matrix)', () => {
  test('should optimize with hourly time-slots, render 15-minute dotted grid, top-required/bottom-actual split, 15-min resize handles and Home button', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    // 1. API モックレスポンスを設定 (15分刻みシフト)
    //
    // ここで返す値をそのままアサートすると「モックが返した文字列を
    // 読み返しただけ」の閉ループになる。そうならないよう、以下では
    //   - 必要人数（画面はリクエスト側の hourly_requirements から描く）
    //   - 実配置人数（バーの重なりから画面側で数え直す値）
    //   - リサイズ後の休憩時間・実働時間（労基法計算を通した派生値）
    // といった「レスポンスに書いていない値」を検証対象にする。
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
              start_time: '10:15',
              end_time: '15:45',
              hours: 5.5,
              break_minutes: 0,
              hourly_wage: 1500,
              labor_cost: 8250,
              is_late_night: false,
            },
            {
              staff_id: 'emp_02',
              name: '田中 副店長 (社員)',
              day_offset: 0,
              date: '2026-09-01',
              start_time: '10:00',
              end_time: '14:30',
              hours: 4.5,
              break_minutes: 0,
              hourly_wage: 1400,
              labor_cost: 6300,
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

    // ホームボタンの存在確認
    const homeBtn = page.locator('[data-testid="nav-home-btn"]');
    await expect(homeBtn).toBeVisible();

    // 3. 最適化ボタンを押下
    const optimizeBtn = page.locator('[data-testid="btn-optimize"]');
    await expect(optimizeBtn).toBeVisible();
    await optimizeBtn.click();

    // サマリー表示の待機。金額・充足率が実際に整形描画されていること
    // （カードが「見えている」だけでは中身が空でも通ってしまう）
    const summaryCard = page.locator('[data-testid="cost-summary"]');
    await expect(summaryCard).toBeVisible({ timeout: 10000 });
    await expect(summaryCard).toContainText('¥320,000');
    await expect(summaryCard).toContainText('100%');
    await expect(page.locator('[data-testid="shortage-alert"]')).toHaveCount(0);

    // 4. 【日別タイムラインビュー】の検証
    await expect(page.locator('[data-testid="daily-timeline-view"]')).toBeVisible();

    // ③ 上が必要 / 下が配置 の検証。
    //    「要」「配」という固定ラベル文字の有無だけを見ていたため、
    //    数値が 0 でも空でも通る恒真アサーションになっていた。
    //    12時は必要5名（店舗設定側の値）に対し、10:15-15:45 と 10:00-14:30 の
    //    2本のバーが重なるので配置2名になるはず。
    const stat12 = page.locator('[data-testid="hourly-stat-12"]');
    await expect(stat12).toBeVisible();
    await expect(stat12).toContainText('要 5');
    await expect(stat12).toContainText('配 2');

    // 10時台は 10:15 開始の途中出勤も「その時間に勤務している」ので配置2名。
    // 時間の重なり判定を「開始が時刻ちょうど以前」にすり替えると 1名になる。
    await expect(page.locator('[data-testid="hourly-stat-10"]')).toContainText('要 2');
    await expect(page.locator('[data-testid="hourly-stat-10"]')).toContainText('配 2');
    // 15時台は 10:15-15:45 の1本だけが重なる（配置1名）
    await expect(page.locator('[data-testid="hourly-stat-15"]')).toContainText('配 1');
    // 20時台は誰も勤務していない（配置0名 / 必要6名 = 不足表示）
    await expect(page.locator('[data-testid="hourly-stat-20"]')).toContainText('配 0');

    await page.screenshot({ path: `${EVIDENCE}/hourly-timeline-01-hourly-stats.png`, fullPage: true });

    // ① 15分刻み点線サブスロット（10:15, 10:30, 10:45）の存在確認
    const subslot15 = page.locator('[data-testid="subslot-10-15"]').first();
    const subslot30 = page.locator('[data-testid="subslot-10-30"]').first();
    const subslot45 = page.locator('[data-testid="subslot-10-45"]').first();
    await expect(subslot15).toBeVisible();
    await expect(subslot30).toBeVisible();
    await expect(subslot45).toBeVisible();

    // ② 15分刻み出勤バー（10:15-15:45）およびリサイズハンドルの存在検証
    const shiftBar = page.locator('[data-testid="shift-bar-emp_01"]');
    await expect(shiftBar).toBeVisible();
    await expect(shiftBar).toContainText('10:15-15:45');
    await expect(shiftBar).toContainText('(5.5h)');

    // ★ 希望シフト下敷きバー（薄い青色）は「希望:」というラベルの有無ではなく、
    //    店舗設定側の希望時間帯（emp_01 は 10時〜24時）が出ているかを見る
    const prefShiftBar = page.locator('[data-testid="pref-shift-bar-emp_01"]');
    await expect(prefShiftBar).toBeVisible();
    await expect(prefShiftBar).toContainText('希望: 10:00-24:00');

    const resizeStart = page.locator('[data-testid="resize-start-emp_01"]');
    const resizeEnd = page.locator('[data-testid="resize-end-emp_01"]');
    await expect(resizeStart).toBeVisible();
    await expect(resizeEnd).toBeVisible();

    await page.screenshot({ path: `${EVIDENCE}/hourly-timeline-02-shift-bar.png`, fullPage: true });

    // 5. 【月間スタッフ一覧マトリクスビュー】への切り替えと検証。
    //    コンテナが見えるだけでは中身が空でも通るため、
    //    Day1 のセルに実際の勤務時間が入っていることまで見る。
    const monthlyTab = page.locator('[data-testid="tab-view-monthly"]');
    await monthlyTab.click();
    await expect(page.locator('[data-testid="monthly-matrix-view"]')).toBeVisible();
    const monthlyCell = page.locator('[data-testid="cell-emp_01-0"]');
    await expect(monthlyCell).toContainText('10-15');
    await expect(monthlyCell).toContainText('5.5h');
    await expect(page.locator('[data-testid="cell-emp_02-0"]')).toContainText('10-14');
    // 出勤していない日は空欄（セル自体が生成されない）
    await expect(page.locator('[data-testid="cell-emp_01-1"]')).toHaveCount(0);

    await page.screenshot({ path: `${EVIDENCE}/hourly-timeline-03-monthly-matrix.png`, fullPage: true });

    // 6. 再度日別タイムラインに戻る
    const timelineTab = page.locator('[data-testid="tab-view-timeline"]');
    await timelineTab.click();
    await expect(page.locator('[data-testid="daily-timeline-view"]')).toBeVisible();

    // 7. LINE共有テキストに実際のシフト行が含まれること (UAC-4)
    //
    // 1時間スロット経路のレスポンスは schedule が常に空で、割当は
    // assigned_shifts に入る。ExportModal が schedule だけを走査していたため、
    // 店長が配布するLINE本文にシフト行が1行も出ないまま
    // 「人件費」と「希望充足率」だけが載る状態だった。
    const copyLineBtn = page.locator('[data-testid="btn-copy-line"]');
    await expect(copyLineBtn).toBeVisible();
    await copyLineBtn.click();

    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toContain('【FoodShift 確定シフト】');
    expect(clipboardText).toContain('佐藤 店長 (社員)');
    expect(clipboardText).toContain('10:15-15:45');
    expect(clipboardText).toContain('田中 副店長 (社員)');
    expect(clipboardText).toContain('10:00-14:30');

    // 8. ★ リサイズハンドルは「見えている」だけでは意味がない。
    //    実際に右端を 18:00 までドラッグし、
    //    勤務時間・休憩時間（労基法第34条: 6時間超で45分）が
    //    再計算されて画面が変化することを確認する。
    //
    //    スマホ幅(393px)では、タイムライン行(728px)はビューポートの
    //    はるか外側（実測 x=213〜941 / y=1870）に位置する。
    //    スクロールせずに座標を計算すると、画面外の「何も無い場所」を
    //    掴んでドラッグすることになり、**操作が一切届かないまま
    //    「動かなかった」ことだけが分かる**という無意味な失敗になる。
    //    掴む位置と離す位置の両方をビューポート内へ入れてから操作する。
    const slotsRow = page.locator('[data-testid="timeline-slots-emp_01"]');
    await resizeEnd.scrollIntoViewIfNeeded();

    // タイムラインは 9:00〜24:00 の 900分。18:00 は左端から 60%
    const ratio18 = (18 * 60 - 9 * 60) / 900;
    let rowBox = await slotsRow.boundingBox();
    expect(rowBox).not.toBeNull();

    const viewportWidth = page.viewportSize()!.width;
    const wantX = rowBox!.x + rowBox!.width * ratio18;
    if (wantX > viewportWidth - 8) {
      // 横スクロールコンテナを動かして 18:00 の位置を画面内に入れる
      await page
        .locator('[data-testid="daily-timeline-view"]')
        .evaluate((el, dx) => {
          el.scrollLeft += dx;
        }, wantX - (viewportWidth - 8));
      rowBox = await slotsRow.boundingBox();
    }

    const handleBox = await resizeEnd.boundingBox();
    expect(handleBox).not.toBeNull();

    const targetX = rowBox!.x + rowBox!.width * ratio18;
    const centerY = rowBox!.y + rowBox!.height / 2;
    // 掴む位置・離す位置がどちらも画面内にあることを先に確定させる。
    // ここが外れていると、以降のアサーションは「ドラッグが効かない」のか
    // 「そもそも掴めていない」のかを区別できない。
    expect(handleBox!.x, 'リサイズハンドルが画面内にあること').toBeGreaterThanOrEqual(0);
    expect(targetX, 'ドラッグ先が画面内にあること').toBeLessThan(viewportWidth);

    await page.mouse.move(handleBox!.x + handleBox!.width / 2, centerY);
    await page.mouse.down();
    await page.mouse.move(targetX, centerY, { steps: 10 });
    await page.mouse.up();

    // 終了時刻が 18:00 になり、実働は 7.75h - 休憩45分 = 7h に再計算される
    await expect(shiftBar).toContainText('10:15-18:00');
    await expect(shiftBar).toContainText('(7h)');
    await expect(page.locator('[data-testid="admin-toast-banner"]')).toContainText('10:15〜18:00');

    // 配置人数の集計もドラッグ結果に追随する（17時台は元は0名）
    await expect(page.locator('[data-testid="hourly-stat-17"]')).toContainText('配 1');

    await page.screenshot({ path: `${EVIDENCE}/hourly-timeline-04-after-resize.png`, fullPage: true });
  });
});
