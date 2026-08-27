import { test, expect, Page } from '@playwright/test';

const EVIDENCE = '/tmp/claude-0/-home-user-foodshift-ai-scheduler/8cea9e3e-1847-5cca-ac45-5ec023e8495a/scratchpad/evidence/a1';

/**
 * 画面幅 375px で横スクロールが発生していないことを確認する。
 *
 * 従来は `document.body.scrollWidth` だけを goto 直後に測っていた。
 * これには2つの穴があった:
 *   1. 描画前（まだ何も無いページ）を測ると必ず 375 以下になり素通りする。
 *   2. body に収まっていてもルート要素側にはみ出していれば
 *      利用者は実際に横スクロールできてしまう。
 * そのため「実物が描画済みであること」を呼び出し側で確定させたうえで、
 * body / documentElement の両方と、実際に横スクロールできてしまう量を測る。
 */
async function expectNoHorizontalOverflow(page: Page, label: string) {
  const metrics = await page.evaluate(() => {
    window.scrollTo(9999, 0);
    const scrolledX = window.scrollX;
    window.scrollTo(0, 0);
    return {
      body: document.body.scrollWidth,
      root: document.documentElement.scrollWidth,
      scrolledX,
      renderedChars: document.body.innerText.trim().length,
    };
  });
  await page.screenshot({ path: `${EVIDENCE}/mobile-responsiveness-${label}.png`, fullPage: true });

  // 空ページ・エラーページを「はみ出していない」と誤判定しないための下限
  expect(metrics.renderedChars).toBeGreaterThan(200);
  expect(metrics.body).toBeLessThanOrEqual(375);
  expect(metrics.root).toBeLessThanOrEqual(375);
  expect(metrics.scrolledX).toBe(0);
}

test.describe('CUJ-6: Mobile 375px Responsiveness Across All Admin & Staff Pages', () => {
  test.use({ viewport: { width: 375, height: 667 } }); // iPhone SE 375px

  test('should render /submit without horizontal overflow', async ({ page }) => {
    await page.goto('/submit');

    // 実際に希望入力UIが描かれてから計測する
    const submitBtn = page.locator('[data-testid="btn-submit-availability"]');
    await expect(submitBtn).toBeVisible();
    await expect(page.locator('[data-testid="btn-slot-0-morning"]')).toBeVisible();
    await expect(page.locator('[data-testid="btn-slot-6-late_night"]')).toBeVisible();
    // スタッフ選択肢が実在すること（空のドロップダウンで通さない）
    expect(await page.locator('[data-testid="select-staff"] option').count()).toBeGreaterThan(1);

    await expectNoHorizontalOverflow(page, 'submit');
  });

  test('should render /admin without horizontal overflow and allow navigation', async ({ page }) => {
    await page.goto('/admin');

    const optimizeBtn = page.locator('[data-testid="btn-optimize"]');
    await expect(optimizeBtn).toBeVisible();
    // 「最適化できない状態（必要人数0名）」の画面で通さない
    await expect(optimizeBtn).toContainText('シフトを最適化する');
    await expect(page.locator('[data-testid="daily-timeline-view"]')).toBeVisible();

    await expectNoHorizontalOverflow(page, 'admin');
  });

  test('should render /admin/staff and open add modal within 375px viewport', async ({ page }) => {
    await page.goto('/admin/staff');

    // 一覧に実データが描かれていること
    await expect(page.locator('[data-testid="staff-item-emp_01"]')).toBeVisible();

    const addBtn = page.locator('[data-testid="btn-add-staff"]');
    await expect(addBtn).toBeVisible();
    await addBtn.click();

    // 「モーダルが見える」だけでなく、新規追加フォームであること・
    // 375px の画面に収まっていることを確認する
    const modalDialog = page.locator('.modal-dialog');
    await expect(modalDialog).toBeVisible();
    await expect(modalDialog).toContainText('新規スタッフ');
    await expect(page.locator('[data-testid="btn-save-staff"]')).toBeVisible();

    const box = await modalDialog.boundingBox();
    expect(box).not.toBeNull();
    await page.screenshot({ path: `${EVIDENCE}/mobile-responsiveness-staff-modal.png`, fullPage: true });
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(375);

    await expectNoHorizontalOverflow(page, 'staff');
  });

  test('should render /admin/forecast within 375px viewport', async ({ page }) => {
    await page.goto('/admin/forecast');

    const heading = page.locator('h1:has-text("売上・需要予測シミュレーター")');
    await expect(heading).toBeVisible();

    // 見出しが出ているだけでは「予測が動いている」ことの証明にならない。
    // 実際の予測値（0円ではない売上）が描かれていることを確認する。
    const totalSales = page.locator('div.card', { hasText: '予測総売上' }).first();
    await expect(totalSales).toBeVisible();
    const salesText = (await totalSales.innerText()).replace(/\s/g, '');
    expect(salesText).toMatch(/¥[1-9][\d,]{5,}/);

    // 日別カード・シフト枠プレビューも実データで描かれていること
    await expect(page.locator('[data-testid="btn-profile-izakaya"]')).toBeVisible();
    await expect(page.getByText('シフト枠別 必要人数集約プレビュー')).toBeVisible();

    await expectNoHorizontalOverflow(page, 'forecast');
  });
});
