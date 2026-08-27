import { test, expect, Page } from '@playwright/test';

const EVIDENCE = '/tmp/claude-0/-home-user-foodshift-ai-scheduler/8cea9e3e-1847-5cca-ac45-5ec023e8495a/scratchpad/evidence/a1';

interface StoredRequirement {
  day_offset: number;
  shift_id: string;
  min_staff: number;
}

/** KPIカード「予測総売上」の金額を数値で取り出す */
async function readForecastTotalSales(page: Page): Promise<number> {
  const card = page.locator('div.card', { hasText: '予測総売上' }).first();
  await expect(card).toBeVisible();
  const text = await card.innerText();
  const match = text.match(/¥([\d,]+)/);
  expect(match).not.toBeNull();
  return Number((match as RegExpMatchArray)[1].replace(/,/g, ''));
}

test.describe('CUJ-5: Demand Forecasting Simulator & Shift Integration Flow', () => {
  test('should simulate sales, switch business profiles, update labor productivity KPIs, and apply to shift requirements', async ({
    page,
  }) => {
    // 1. /admin/forecast にアクセス
    await page.goto('/admin/forecast');

    // 2. ページヘッダーとKPIカードの確認
    const heading = page.locator('h1:has-text("売上・需要予測シミュレーター")');
    await expect(heading).toBeVisible();

    // 「予測総売上」という見出し文字が見えるだけでは、0円でも空でも通る。
    // 実際の予測金額を数値として取り出して検証する。
    const izakayaSales = await readForecastTotalSales(page);
    expect(izakayaSales).toBeGreaterThan(0);
    await expect(page.getByText('¥5,800 /人時')).toBeVisible();

    await page.screenshot({ path: `${EVIDENCE}/forecast-01-izakaya-kpi.png`, fullPage: true });

    // 3. 業態プロファイルの切り替え（カフェ・ベーカリーを選択）。
    //
    // 従来はカフェ→居酒屋と押し戻すだけで何もアサートしておらず、
    // ボタンが完全な no-op でもテストは緑のままだった。
    // 切り替えで予測値そのものが変わることを確認する。
    const cafeBtn = page.locator('[data-testid="btn-profile-cafe"]');
    await expect(cafeBtn).toBeVisible({ timeout: 10000 });
    await cafeBtn.click();

    await expect(page.getByText('¥5,000 /人時')).toBeVisible();
    const cafeSales = await readForecastTotalSales(page);
    expect(cafeSales).toBeGreaterThan(0);
    expect(cafeSales).not.toBe(izakayaSales);

    await page.screenshot({ path: `${EVIDENCE}/forecast-02-cafe-kpi.png`, fullPage: true });

    // 4. 居酒屋に戻す（戻したら元の予測値に戻ること）
    const izakayaBtn = page.locator('[data-testid="btn-profile-izakaya"]');
    await expect(izakayaBtn).toBeVisible();
    await izakayaBtn.click();
    await expect(page.getByText('¥5,800 /人時')).toBeVisible();
    expect(await readForecastTotalSales(page)).toBe(izakayaSales);

    // 5. 反映前に「シフト枠別 必要人数集約プレビュー」が出している推奨人数を読む。
    //    この数字が、反映後にそのままシフト設定へ入っていなければならない。
    const previewCard = page.locator('div.card', { hasText: 'シフト枠別 必要人数集約プレビュー' }).last();
    await expect(previewCard).toBeVisible();
    const previewRows = previewCard.locator('tbody tr');
    await expect(previewRows).toHaveCount(3);

    const previewedMinStaff: number[] = [];
    for (let i = 0; i < 3; i++) {
      const cellText = await previewRows.nth(i).locator('td').last().innerText();
      const n = Number(cellText.replace(/[^\d]/g, ''));
      expect(n).toBeGreaterThan(0);
      previewedMinStaff.push(n);
    }

    await page.screenshot({ path: `${EVIDENCE}/forecast-03-slot-preview.png`, fullPage: true });

    // 6. 反映ボタン「この予測をシフト必要人数に反映する」を押下
    const applyBtn = page.getByRole('button', { name: 'この予測をシフト必要人数に反映する' }).first();
    await expect(applyBtn).toBeVisible();
    await applyBtn.click();

    // 7. 反映完了トースト通知の確認
    const toast = page.getByText('需要予測結果をシフト必要人数に反映・保存しました！');
    await expect(toast).toBeVisible({ timeout: 5000 });

    // 8. ★ トーストが出ただけでは何も反映されていなくても通る。
    //    保存されたシフト必要人数がプレビューの数字と一致することを検証する。
    const storedReqs = await page.evaluate(() => {
      const raw = localStorage.getItem('foodshift_req_store_default');
      return raw
        ? (JSON.parse(raw) as { requirements: StoredRequirement[]; shifts: { id: string }[] })
        : null;
    });
    expect(storedReqs).not.toBeNull();
    const shiftIds = storedReqs!.shifts.map((s) => s.id);
    expect(shiftIds).toHaveLength(3);

    const day0 = shiftIds.map(
      (id) => storedReqs!.requirements.find((r) => r.day_offset === 0 && r.shift_id === id)?.min_staff
    );
    expect(day0).toEqual(previewedMinStaff);
    // 予測は日ごとに変わるので、全日が同じ値のまま（＝実質未反映）ではないこと
    const allDayMorning = storedReqs!.requirements
      .filter((r) => r.shift_id === shiftIds[1])
      .map((r) => r.min_staff);
    expect(new Set(allDayMorning).size).toBeGreaterThan(1);

    // 9. /admin/shifts に遷移し、必要人数設定が画面にも反映されていることを確認
    await page.goto('/admin/shifts');
    const reqTab = page.getByRole('button', { name: '日別必要人数マトリクス' });
    await expect(reqTab).toBeVisible();
    await reqTab.click();

    // 「テーブルが見えている」だけでは中身が空でも通る。Day1 の各枠の
    // 入力欄に、予測から算出された値がそのまま入っていることを見る。
    const table = page.locator('table.modern-table');
    await expect(table).toBeVisible();
    const day1Inputs = table.locator('tbody tr').first().locator('input[type="text"]');
    await expect(day1Inputs).toHaveCount(3);
    for (let i = 0; i < 3; i++) {
      await expect(day1Inputs.nth(i)).toHaveValue(String(previewedMinStaff[i]));
    }

    await page.screenshot({ path: `${EVIDENCE}/forecast-04-applied-to-shifts.png`, fullPage: true });
  });
});
