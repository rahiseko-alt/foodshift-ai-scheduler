/**
 * CUJ-1: 店長のワンクリック最適化 ＆ 配布フロー（実バックエンド接続）
 *
 * 【修正前に何が起きていたか】
 * 旧テストは `page.route('**\/api\/v1\/optimize')` で固定JSONを返し、
 * その固定値が画面に出たことだけを確認していた（閉ループ）。しかも返していた形状が
 * 本番と違った:
 *   - 旧モック: { schedule: [ ...1件... ] } で assigned_shifts なし
 *   - 実バックエンド: 管理画面は必ず hourly_requirements を送るため hourly_solver 経由になり、
 *     schedule は常に [] で、割当は assigned_shifts / hourly_schedule に入る
 * つまり本番では絶対に通らないコードパスだけを検証していた。
 * さらに `toContainText('100%遵守')` のように、根拠のない固定表示文字列を
 * アサートしていた（虚偽表示の検証）。
 *
 * 【このテストの方針】
 * モックを一切使わず 127.0.0.1:8000 の実ソルバーに解かせ、
 * 「画面に出ている数値・氏名・時刻が、その実レスポンスから導かれた値と一致するか」
 * だけをアサートする。期待値をテスト内にハードコードしない。
 */
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { ShiftOptimizeResponse } from '../src/lib/types';

const EV = '/tmp/claude-0/-home-user-foodshift-ai-scheduler/8cea9e3e-1847-5cca-ac45-5ec023e8495a/scratchpad/evidence/a2';

/**
 * 実バックエンド (127.0.0.1:8000) に実際に解かせる。
 * /api/v1/optimize は 5req/分のレート制限付きなので、429 のときは
 * 画面に出る「再試行」ボタン（＝ユーザーと同じ操作）で再実行する。
 */
async function optimizeForReal(page: Page): Promise<ShiftOptimizeResponse> {
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
    const res = await responsePromise;

    if (res.status() === 429) {
      // レート制限。UIが入力を保持したまま再試行可能であること (RAC-1) も同時に確認する
      await expect(page.locator('[data-testid="error-message"]')).toContainText(
        'リクエスト回数制限'
      );
      await page.waitForTimeout(20000);
      continue;
    }

    expect(res.status(), '実バックエンドが200を返すこと').toBe(200);
    const body = (await res.json()) as ShiftOptimizeResponse;

    // 本番形状であることの確認。ここが崩れると以降のアサーションの意味が失われる。
    expect(
      body.assigned_shifts?.length,
      '本番レスポンスは assigned_shifts に割当を返す（ここが0なら誰も出勤していない＝画面は空）'
    ).toBeGreaterThan(0);

    // ローディング（AI計算中...）が消えるまで待つ = 描画完了
    await expect(page.locator('[data-testid="loading-spinner"]')).toHaveCount(0);
    return body;
  }
  throw new Error('optimize がレート制限で完了しませんでした');
}

test.describe('CUJ-1: Admin Schedule Optimization & Sharing Flow (実API)', () => {
  test('実ソルバーの解が、サマリー数値・タイムライン・LINE配布文・リロード後に一致して現れる', async ({
    page,
    context,
  }) => {
    test.setTimeout(180000);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    await page.goto('/admin');
    await expect(page.locator('[data-testid="btn-optimize"]')).toBeVisible({ timeout: 60000 });
    // 最適化前はサマリーカードが存在しないこと（＝この後の数値が本当に今回の解由来である証拠）
    await expect(page.locator('[data-testid="cost-summary"]')).toHaveCount(0);
    await page.screenshot({ path: `${EV}/schedule-flow-01-before-optimize.png`, fullPage: true });

    const res = await optimizeForReal(page);
    const summary = res.summary;

    const costSummary = page.locator('[data-testid="cost-summary"]');
    await expect(costSummary).toBeVisible({ timeout: 15000 });

    await page.screenshot({ path: `${EV}/schedule-flow-02-summary.png`, fullPage: true });

    // --- サマリーカードの各数値が「実レスポンスの値」と一致すること ---
    await expect(costSummary).toContainText(`¥${summary.total_labor_cost.toLocaleString()}`);
    await expect(costSummary).toContainText(`${summary.total_work_hours}`);
    await expect(costSummary).toContainText(`${Math.round(summary.wants_fulfillment_rate * 100)}%`);
    await expect(costSummary).toContainText(`最大${summary.max_staff_day_difference}日差`);
    // 法令チェック欄は compliance_warnings の件数を反映する（無条件の「100%遵守」表示ではない）
    const warnCount = summary.compliance_warnings?.length ?? 0;
    if (warnCount > 0) {
      await expect(costSummary).toContainText(`${warnCount} 件の要確認`);
    } else {
      await expect(costSummary).not.toContainText('件の要確認');
    }
    // 人員不足バナーの件数も実レスポンス由来であること
    const shortageCount = summary.unfilled_requirements.length;
    if (shortageCount > 0) {
      await expect(page.locator('[data-testid="shortage-alert"]')).toContainText(
        `${shortageCount} 箇所`
      );
    } else {
      await expect(page.locator('[data-testid="shortage-alert"]')).toHaveCount(0);
    }

    // --- 日別タイムライン（初期表示ビュー）に、実際の割当が描かれていること ---
    const day0 = (res.assigned_shifts ?? []).filter((s) => s.day_offset === 0);
    expect(day0.length, 'Day1に1人以上の割当があること').toBeGreaterThan(0);
    await expect(page.locator('[data-testid="daily-timeline-view"]')).toBeVisible();
    for (const shift of day0) {
      const bar = page.locator(`[data-testid="shift-bar-${shift.staff_id}"]`);
      await expect(bar, `${shift.name} の出勤バーが描画されていること`).toBeVisible();
      await expect(bar).toContainText(`${shift.start_time}-${shift.end_time}`);
      await expect(bar).toContainText(`${shift.hours}h`);
    }
    // 割当が無いスタッフにはバーが無いこと（バーが常時描かれる実装なら検出される）
    const assignedDay0Ids = new Set(day0.map((s) => s.staff_id));
    const allStaffIds: string[] = await page.evaluate(() => {
      const raw = localStorage.getItem('foodshift_req_store_default');
      return raw ? JSON.parse(raw).staff_members.map((s: { id: string }) => s.id) : [];
    });
    const idleIds = allStaffIds.filter((id) => !assignedDay0Ids.has(id));
    expect(idleIds.length, 'Day1に非番のスタッフが存在すること（比較対象）').toBeGreaterThan(0);
    for (const id of idleIds) {
      await expect(page.locator(`[data-testid="shift-bar-${id}"]`)).toHaveCount(0);
    }
    await page.screenshot({ path: `${EV}/schedule-flow-03-timeline-day1.png`, fullPage: true });

    // --- 月間マトリクスも同じ解を描いていること ---
    await page.locator('[data-testid="tab-view-monthly"]').click();
    await expect(page.locator('[data-testid="monthly-matrix-view"]')).toBeVisible();
    const sample = day0[0];
    const cell = page.locator(`[data-testid="cell-${sample.staff_id}-0"]`);
    await expect(cell).toContainText(
      `${sample.start_time.split(':')[0]}-${sample.end_time.split(':')[0]}`
    );
    await expect(cell).toContainText(`${sample.hours}h`);
    await page.screenshot({ path: `${EV}/schedule-flow-04-monthly-matrix.png`, fullPage: true });

    // --- LINE配布テキスト: 実際に割り当てられた全員の氏名と時刻が入っていること ---
    const copyLineBtn = page.locator('[data-testid="btn-copy-line"]');
    await copyLineBtn.click();
    await expect(copyLineBtn).toContainText('コピー完了');
    await page.screenshot({ path: `${EV}/schedule-flow-05-line-copied.png`, fullPage: true });

    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toContain('【FoodShift 確定シフト】');
    expect(clipboardText).toContain(`¥${summary.total_labor_cost.toLocaleString()}`);
    expect(clipboardText).toContain(
      `希望充足率: ${Math.round(summary.wants_fulfillment_rate * 100)}%`
    );
    for (const shift of day0) {
      expect(
        clipboardText,
        `LINE本文に ${shift.name} の ${shift.start_time}-${shift.end_time} が含まれること`
      ).toContain(`${shift.start_time}-${shift.end_time}: ${shift.name}`);
    }
    // 配布文に日付行と、割当のある日数分の行があること（空配布の検出）
    const bodyLines = clipboardText.split('\n').filter((l) => l.trim().startsWith('・'));
    expect(bodyLines.length, 'LINE本文のシフト行数が実割当件数と一致すること').toBe(
      (res.assigned_shifts ?? []).length
    );

    // --- リロード後も同じ解が復元されること (UAC-5 / Invariant 3) ---
    await page.reload();
    await expect(costSummary).toBeVisible({ timeout: 15000 });
    await page.screenshot({ path: `${EV}/schedule-flow-06-after-reload.png`, fullPage: true });
    await expect(costSummary).toContainText(`¥${summary.total_labor_cost.toLocaleString()}`);
    await expect(costSummary).toContainText(`${Math.round(summary.wants_fulfillment_rate * 100)}%`);
    for (const shift of day0) {
      const bar = page.locator(`[data-testid="shift-bar-${shift.staff_id}"]`);
      await expect(bar).toContainText(`${shift.start_time}-${shift.end_time}`);
    }
    // LocalStorage の保存内容が画面と一致すること
    const stored = await page.evaluate(() => {
      const raw = localStorage.getItem('foodshift_res_store_default');
      return raw ? JSON.parse(raw) : null;
    });
    expect(stored?.summary?.total_labor_cost).toBe(summary.total_labor_cost);
    expect(stored?.assigned_shifts?.length).toBe((res.assigned_shifts ?? []).length);
  });

  test('枠別マトリクスが、実レスポンスの割当を描画すること', async ({ page }) => {
    test.setTimeout(180000);
    await page.goto('/admin');
    const res = await optimizeForReal(page);
    const day0 = (res.assigned_shifts ?? []).filter((s) => s.day_offset === 0);

    await page.locator('[data-testid="tab-view-slots"]').click();
    const matrix = page.locator('[data-testid="shift-matrix"]');
    await expect(matrix).toBeVisible();
    await page.screenshot({ path: `${EV}/schedule-flow-07-slots-matrix.png`, fullPage: true });

    // 「表が出ている」だけでは何も見ていない。Day1に出勤する人のセルが
    // 「-」ではなく実際のシフト名で埋まっていることを見る。
    for (const shift of day0) {
      const cellText = await page
        .locator(`[data-testid="shift-cell-${shift.staff_id}-day_0"]`)
        .innerText();
      expect(
        cellText.trim(),
        `${shift.name} は Day1 に ${shift.start_time}-${shift.end_time} で出勤しているのに枠別マトリクスが空`
      ).not.toBe('-');
    }
  });

  test('CSVダウンロードの中身に、実レスポンスの割当が入っていること', async ({ page }) => {
    test.setTimeout(180000);
    await page.goto('/admin');
    const res = await optimizeForReal(page);
    const day0 = (res.assigned_shifts ?? []).filter((s) => s.day_offset === 0);

    const downloadPromise = page.waitForEvent('download');
    await page.locator('[data-testid="btn-download-csv"]').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^shift_\d{4}-\d{2}-\d{2}\.csv$/);
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(Buffer.from(c));
    const csv = Buffer.concat(chunks).toString('utf-8');
    await page.screenshot({ path: `${EV}/schedule-flow-08-csv-downloaded.png`, fullPage: true });

    // ファイル名だけを見るテストは、中身が空でも緑になる
    expect(csv).toContain('スタッフ名');
    for (const shift of day0) {
      const row = csv.split('\n').find((l) => l.startsWith(`"${shift.name}"`));
      expect(row, `${shift.name} の行がCSVに存在すること`).toBeTruthy();
      const day1Cell = (row as string).split(',')[3];
      expect(day1Cell, `${shift.name} は Day1 に ${shift.start_time}-${shift.end_time} で出勤しているのにCSVが「休」`).not.toBe(
        '"休"'
      );
    }
  });
});
