import { test, expect } from '@playwright/test';

const EVIDENCE = '/tmp/claude-0/-home-user-foodshift-ai-scheduler/8cea9e3e-1847-5cca-ac45-5ec023e8495a/scratchpad/evidence/a1';

interface StoredAvailability {
  staff_id: string;
  day_offset: number;
  shift_id: string;
  status: string;
}

test.describe('CUJ-2: Mobile Staff Availability Submission Flow (375px)', () => {
  test.use({ viewport: { width: 375, height: 667 } }); // iPhone SE / 標準スマホ幅

  test('should submit availability without horizontal overflow within 30 taps', async ({
    page,
  }) => {
    // 1. /submit にアクセス
    await page.goto('/submit');

    // 2. 画面が実際に描画されてから計測する。
    //
    // 従来は goto 直後に scrollWidth を測っていた。/submit は
    // requestData が入るまで null を返すため、まだ何も描かれていない
    // 空ページの幅（＝常に 375）を測って合格していた恐れがある。
    // 「実物が描かれていること」を先に確定させてから計測する。
    const selectStaff = page.locator('[data-testid="select-staff"]');
    await expect(selectStaff).toBeVisible();
    await expect(page.locator('[data-testid="btn-slot-6-morning"]')).toBeVisible();

    // 3. スタッフ選択（選択結果が画面に反映されていることまで確認する）
    await selectStaff.selectOption({ index: 1 }); // 2人目のスタッフ
    const selectedStaffId = await selectStaff.inputValue();
    expect(selectedStaffId).not.toBe('');
    const selectedStaffName = await selectStaff
      .locator(`option[value="${selectedStaffId}"]`)
      .textContent();
    expect((selectedStaffName || '').trim().length).toBeGreaterThan(0);

    // 4. 横スクロールなし (scrollWidth <= 375)
    //    body だけでなくルート要素も見る（body に収まっていても
    //    html 側にはみ出していれば利用者は横スクロールできてしまう）。
    const widths = await page.evaluate(() => ({
      body: document.body.scrollWidth,
      root: document.documentElement.scrollWidth,
    }));
    await page.screenshot({ path: `${EVIDENCE}/mobile-submit-375-rendered.png`, fullPage: true });
    expect(widths.body).toBeLessThanOrEqual(375);
    expect(widths.root).toBeLessThanOrEqual(375);

    // 5. マスをタップして希望を入力。
    //
    // 「タップ数」を自前のカウンタで数えて 30 以下と主張しても、
    // それはループ回数を書き写しただけの恒真アサーションだった。
    // 1タップごとに当該枠が実際に「希望」へ変化したことを確認し、
    // 画面上の希望枠の数とタップ数が一致することで初めて意味を持つ。
    let tapCount = 0;
    for (let d = 0; d < 7; d++) {
      const slotBtn = page.locator(`[data-testid="btn-slot-${d}-morning"]`);
      await expect(slotBtn).toContainText('－ 通常');
      await slotBtn.click();
      tapCount++;
      await expect(slotBtn).toContainText('希望 希望');
    }
    expect(tapCount).toBeLessThanOrEqual(30);

    // 画面上で「希望」になっている枠がタップ数と一致すること
    const wantSlots = await page.locator('button[data-testid^="btn-slot-"]', { hasText: '希望 希望' }).count();
    expect(wantSlots).toBe(tapCount);

    await page.screenshot({ path: `${EVIDENCE}/mobile-submit-7slots-want.png`, fullPage: true });

    // 6. 提出ボタン押下
    const submitBtn = page.locator('[data-testid="btn-submit-availability"]');
    await expect(submitBtn).toBeVisible();
    await submitBtn.click();

    // 7. 完了メッセージ確認
    const successBanner = page.locator('[data-testid="submit-success-banner"]');
    await expect(successBanner).toBeVisible();
    await expect(successBanner).toContainText('希望を保存しました');
    // 提出コード（店長へ渡す実体）が空でないこと
    await expect(successBanner).toContainText(/FS2\|/);

    await page.screenshot({ path: `${EVIDENCE}/mobile-submit-success-banner.png`, fullPage: true });

    // 8. 「送信しました」表示だけでは中身が空でも通ってしまう。
    //    実際に保存された希望データそのものを検証する。
    const stored = await page.evaluate(() => {
      const raw = localStorage.getItem('foodshift_req_store_default');
      return raw ? (JSON.parse(raw) as { availabilities: StoredAvailability[] }) : null;
    });
    expect(stored).not.toBeNull();

    const mine = (stored as { availabilities: StoredAvailability[] }).availabilities.filter(
      (a) => a.staff_id === selectedStaffId
    );
    expect(mine).toHaveLength(7);
    expect(mine.every((a) => a.shift_id === 'morning')).toBe(true);
    expect(mine.every((a) => a.status === 'want')).toBe(true);
    expect(mine.map((a) => a.day_offset).sort((x, y) => x - y)).toEqual([0, 1, 2, 3, 4, 5, 6]);

    // 9. 提出後も横スクロールが発生していないこと（成功カードの追加後）
    const widthsAfter = await page.evaluate(() => ({
      body: document.body.scrollWidth,
      root: document.documentElement.scrollWidth,
    }));
    expect(widthsAfter.body).toBeLessThanOrEqual(375);
    expect(widthsAfter.root).toBeLessThanOrEqual(375);
  });
});
