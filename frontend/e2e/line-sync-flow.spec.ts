import { test, expect } from '@playwright/test';

const EVIDENCE = '/tmp/claude-0/-home-user-foodshift-ai-scheduler/8cea9e3e-1847-5cca-ac45-5ec023e8495a/scratchpad/evidence/a1';

interface StoredAvailability {
  staff_id: string;
  day_offset: number;
  shift_id: string;
  status: string;
}

test.describe('CUJ-7: LINE Submission & Manager Bulk Import Flow (0-Yen Stateless Sync)', () => {
  test('should generate LINE submission code on staff submit and successfully import it on admin dashboard', async ({
    page,
  }) => {
    // 1. スタッフ希望提出画面 (/submit) にアクセス
    await page.goto('/submit');

    // 2. スタッフを選択
    const staffSelect = page.locator('[data-testid="select-staff"]');
    await expect(staffSelect).toBeVisible();
    await staffSelect.selectOption({ index: 1 }); // 2番目のスタッフを選択
    const staffId = await staffSelect.inputValue();
    const staffName = (
      await staffSelect.locator(`option[value="${staffId}"]`).textContent()
    )?.trim();
    expect(staffId).not.toBe('');
    expect(staffName).toBeTruthy();

    // 3. 3状態（希望 / 可 / 不可）すべてを実際にタップして作る。
    //
    // 以前は `if (count > 0)` で囲まれた曖昧なテキスト検索で、
    // 一致しなければ何もタップせずに素通りしていた。その結果
    // 希望ゼロのコード（FS2|...|1|）を提出しており、
    // 「提出して取り込む」という筋書きでありながら中身を一切検証できていなかった。
    // さらに「希望が1つでもある」だけでは 2bit エンコードの取り違えを
    // 検出できないため、3状態を別々の枠に作り分けて往復させる。
    const wantA = page.locator('[data-testid="btn-slot-0-morning"]');
    const wantB = page.locator('[data-testid="btn-slot-3-dinner"]');
    const availableSlot = page.locator('[data-testid="btn-slot-5-late_night"]');

    await wantA.click(); // available -> want
    await expect(wantA).toContainText('希望 希望');
    await wantB.click(); // available -> want
    await expect(wantB).toContainText('希望 希望');

    await availableSlot.click(); // -> want
    await expect(availableSlot).toContainText('希望 希望');
    await availableSlot.click(); // -> unavailable
    await expect(availableSlot).toContainText('不可 不可');
    await availableSlot.click(); // -> available (通常)
    await expect(availableSlot).toContainText('－ 通常');

    await page.screenshot({ path: `${EVIDENCE}/line-sync-01-staff-input.png`, fullPage: true });

    // 4. 「シフト希望を提出する」を押下
    const submitBtn = page.locator('[data-testid="btn-submit-availability"]');
    await expect(submitBtn).toBeVisible();
    await submitBtn.click();

    // 5. 提出完了カードおよび LINE 提出コードが表示されていることを確認
    const banner = page.locator('[data-testid="submit-success-banner"]');
    await expect(banner).toBeVisible();

    const fullText = (await banner.textContent()) || '';
    expect(fullText).toContain('FS2|');

    // 提出コードを抽出
    // FS2 は日数フィールドを持つ（送信側と受信側の日数不一致による破損を防ぐため）
    const match = fullText.match(/FS2\|[a-zA-Z0-9_\-]+\|\d{4}-\d{2}-\d{2}\|\d+\|[a-zA-Z0-9]+\|[0-9a-fA-F]{4}/);
    expect(match).not.toBeNull();
    const lineCode = match ? match[0] : '';
    // コードの staff_id / 日数が実際に選んだ内容と一致していること
    expect(lineCode.split('|')[1]).toBe(staffId);
    expect(lineCode.split('|')[3]).toBe('7');

    await page.screenshot({ path: `${EVIDENCE}/line-sync-02-submission-code.png`, fullPage: true });

    // 6. 店長画面 (/admin) に遷移
    await page.goto('/admin');

    // 7. 「LINE希望取込」ボタンを押下してモーダルを開く
    const openImportBtn = page.locator('[data-testid="btn-open-line-import"]');
    await expect(openImportBtn).toBeVisible();
    await openImportBtn.click();

    // 8. LINEトーク履歴風のテキスト（雑談混ざり）をテキストエリアに入力
    const lineTextArea = page.locator('textarea');
    await expect(lineTextArea).toBeVisible();
    await lineTextArea.fill(`店長お疲れ様です！希望提出します！ ${lineCode} よろしくお願いします！`);

    // 9. 「提出コードを解析する」を押下
    await page.getByRole('button', { name: '提出コードを解析する' }).click();

    // 10. 解析結果プレビューが「誰の・どんな中身か」まで表示していることを確認。
    //     バッジの有無だけでは、全枠 unavailable の空提出でも通ってしまう。
    await expect(page.getByText('取込可能', { exact: true })).toBeVisible();
    await expect(page.locator('span', { hasText: staffName as string }).last()).toBeVisible();
    const breakdown = page.getByText(/希望 \d+枠 \/ 可 \d+枠 \/ 不可 \d+枠/);
    await expect(breakdown).toBeVisible();
    // 内訳は 14日 × 3枠 = 42枠。うちスタッフ画面で触れるのは直近7日分（21枠）のみで、
    // 8日目以降（21枠）は提出範囲外のため「不可」として取り込まれる。
    //
    // 提出された21枠のうち、このテストがタップするのは「希望」2枠だけ。
    // 残り19枠は未タップ＝画面の凡例どおり「－ 通常（＝出勤可能）」として送信される。
    // ここを 'unavailable' 既定にしていたため、**1枠だけタップして提出すると
    // 触っていない残り全部が「不可」で送られる**という不具合があった
    // （画面表示と送信内容が食い違っていた / line-codec.ts:113-120 で修正済み）。
    // 既定値がまた反転したら、この3つの数字が必ず動く。
    await expect(breakdown).toContainText('希望 2枠');
    await expect(breakdown).toContainText('可 19枠');
    await expect(breakdown).toContainText('不可 21枠');

    // 総数の恒等式。3つの内訳が 14日×3枠 を過不足なく分割していること。
    // 個別の数字だけだと、枠の取りこぼし（合計が42未満）を見逃す。
    const breakdownText = (await breakdown.textContent()) ?? '';
    const [want, ok, ng] = Array.from(breakdownText.matchAll(/(\d+)枠/g)).map((m) => Number(m[1]));
    expect(want + ok + ng, `内訳の合計が 14日×3枠=42 にならない: ${breakdownText}`).toBe(42);

    await page.screenshot({ path: `${EVIDENCE}/line-sync-03-import-preview.png`, fullPage: true });

    // 11. 「有効な 1 件を一括反映する」を押下
    const applyBtn = page.getByRole('button', { name: /一括反映する/ });
    await expect(applyBtn).toBeVisible();
    await expect(applyBtn).toBeEnabled();
    await applyBtn.click();

    // 12. トースト通知が表示され、モーダルが閉じることを確認
    const toast = page.locator('[data-testid="admin-toast-banner"]');
    await expect(toast).toBeVisible({ timeout: 5000 });
    await expect(toast).toContainText('LINEから 1 名分');
    await expect(lineTextArea).toHaveCount(0);

    await page.screenshot({ path: `${EVIDENCE}/line-sync-04-import-applied.png`, fullPage: true });

    // 13. 取り込んだ希望が「入力した日付・枠のまま」保存されていること
    //
    // 従来はスタッフ側が7日分で送信し店長側が14日分として解釈していたため、
    // Day1〜7 の希望が Day8〜14 にズレて取り込まれ、Day1〜7 は全て「不可」に
    // なっていた。しかもエラーにならず成功トーストが出るため誰も気づけなかった。
    // 形式の検証だけでは検出できないので、枠ごとの状態そのものを検証する。
    const stored = await page.evaluate(() => {
      const raw = localStorage.getItem('foodshift_req_store_default');
      return raw ? (JSON.parse(raw) as { availabilities: StoredAvailability[] }) : null;
    });
    expect(stored).not.toBeNull();

    const mine = (stored as { availabilities: StoredAvailability[] }).availabilities.filter(
      (a) => a.staff_id === staffId
    );
    const statusAt = (day: number, shift: string) =>
      mine.find((a) => a.day_offset === day && a.shift_id === shift)?.status;

    expect(statusAt(0, 'morning')).toBe('want');
    expect(statusAt(3, 'dinner')).toBe('want');
    expect(statusAt(5, 'late_night')).toBe('available');
    expect(mine.filter((a) => a.status === 'want')).toHaveLength(2);
    // 未タップの枠は「通常（＝出勤可能）」として送られる（line-codec.ts:113-120）。
    // 提出範囲の 7日×3枠=21枠 のうち、タップした「希望」2枠を除く 19枠。
    expect(mine.filter((a) => a.status === 'available')).toHaveLength(19);
    // 8日目以降の 21枠は提出範囲外なので「不可」で埋まる
    expect(mine.filter((a) => a.status === 'unavailable')).toHaveLength(21);

    // スタッフ画面は直近7日分しか入力できないため、
    // 取り込み結果が8日目以降に現れたら日付がズレている
    const submitted = mine.filter((a) => a.status !== 'unavailable');
    expect(submitted.length).toBeGreaterThan(0);
    const maxDay = Math.max(...submitted.map((a) => a.day_offset));
    expect(maxDay).toBeLessThan(7);
  });
});
