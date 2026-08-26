/**
 * CUJ-8: 人員不足の検出 ➔ 代打候補スコアリング ➔ お願いLINE文面コピー（実バックエンド接続）
 *
 * 【修正前に何が起きていたか】
 * 旧テストは optimize を丸ごとモックし、しかも本番に存在しない形状を返していた:
 *   - 全21枠に同じ emp_01 を割り当てた schedule（Invariant 2「同日1枠まで」に違反する架空データ）
 *   - 不足枠の shift_id を 'dinner' としていたが、本番（hourly_solver 経路）の
 *     unfilled_requirements.shift_id は 'hour_18' のような時間帯IDである
 * その上でアサーションは `text=適格スコア` が見えるかと、トーストの部分文字列だけ。
 * 誰が候補に出たのか、コピーされた文面が何なのかを一切見ていなかった
 * （clipboard 権限を取得しながらクリップボードを読んでいない）。
 *
 * 【このテストの方針】
 * 実ソルバーが返した実際の不足枠を使い、
 *  - 画面の不足ボタン群が実レスポンスの unfilled_requirements と件数・内容で一致するか
 *  - 候補カードに実在スタッフが出ているか
 *  - コピーされた文面が、画面に出ている候補名・日付・シフト時刻と一致するか
 * を検証する。
 */
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { ShiftOptimizeResponse, ShiftOptimizeRequest } from '../src/lib/types';

const EV = '/tmp/claude-0/-home-user-foodshift-ai-scheduler/8cea9e3e-1847-5cca-ac45-5ec023e8495a/scratchpad/evidence/a2';

/**
 * 実バックエンド (127.0.0.1:8000) に実際に解かせる。
 * /api/v1/optimize は 5req/分のレート制限付きなので、429 のときは
 * 画面に出る「再試行」ボタン（＝ユーザーと同じ操作）で再実行する。
 */
async function optimizeForReal(page: Page): Promise<ShiftOptimizeResponse> {
  const optimizeBtn = page.locator('[data-testid="btn-optimize"]');
  await expect(optimizeBtn).toBeVisible({ timeout: 30000 });

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

async function readStoredRequest(page: Page): Promise<ShiftOptimizeRequest> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('foodshift_req_store_default');
    return JSON.parse(raw as string);
  });
}

test.describe('CUJ-8: Shortage Candidate Scoring & LINE Negotiation Flow (実API)', () => {
  test('実ソルバーの不足枠から代打アシスタントを開き、コピーされた文面が画面の候補と一致する', async ({
    page,
    context,
  }) => {
    test.setTimeout(180000);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    await page.goto('/admin');
    const res = await optimizeForReal(page);
    const unfilled = res.summary.unfilled_requirements;
    expect(unfilled.length, 'デモデータの実求解で人員不足が発生していること').toBeGreaterThan(0);

    await page.locator('[data-testid="tab-view-slots"]').click();
    await expect(page.locator('[data-testid="unfilled-requirements-alert"]')).toBeVisible();

    // 不足ボタンが実レスポンスの不足枠と1対1で対応していること（固定モックなら数が合わない）
    const unfilledButtons = page.locator('[data-testid^="btn-unfilled-slot-"]');
    await expect(unfilledButtons).toHaveCount(unfilled.length);
    await expect(page.locator('[data-testid="unfilled-requirements-alert"]')).toContainText(
      `${unfilled.length} 枠で人員不足`
    );

    // 実レスポンスの1件目を対象にする
    const target = unfilled[0];
    const targetBtn = page.locator(
      `[data-testid="btn-unfilled-slot-${target.day_offset}-${target.shift_id}"]`
    );
    await expect(targetBtn).toBeVisible();
    await expect(targetBtn).toContainText(`${target.shortage}名不足`);
    await page.screenshot({
      path: `${EV}/negotiation-flow-01-unfilled-buttons.png`,
      fullPage: true,
    });

    await targetBtn.click();

    // モーダルの中身を「実物」として読む
    const modal = page.locator('h2:has-text("人手不足解消アシスタント")');
    await expect(modal).toBeVisible();
    const copyButtons = page.locator('[data-testid^="btn-copy-negotiation-"]');
    const candidateCount = await copyButtons.count();
    expect(candidateCount, '候補が1名以上提示されること（0なら文面も出ない）').toBeGreaterThan(0);
    expect(candidateCount, 'TOP3までであること').toBeLessThanOrEqual(3);

    const request = await readStoredRequest(page);
    const staffById = new Map(request.staff_members.map((s) => [s.id, s]));

    // 候補IDを取得し、実在スタッフであること・氏名とスコアがカードに描画されていることを確認
    const candidateIds: string[] = [];
    for (let i = 0; i < candidateCount; i++) {
      const testId = await copyButtons.nth(i).getAttribute('data-testid');
      const staffId = (testId as string).replace('btn-copy-negotiation-', '');
      candidateIds.push(staffId);
      const staff = staffById.get(staffId);
      expect(staff, `候補 ${staffId} が実在するスタッフであること`).toBeTruthy();
      const card = copyButtons.nth(i).locator('xpath=ancestor::div[contains(@class,"card")][1]');
      await expect(card).toContainText((staff as { name: string }).name);
      await expect(card).toContainText('適格スコア');
      const scoreText = await card.innerText();
      const scoreMatch = scoreText.match(/適格スコア\s*(\d+)\s*点/);
      expect(scoreMatch, 'スコアが数値として描画されていること').toBeTruthy();
      expect(Number((scoreMatch as RegExpMatchArray)[1])).toBeGreaterThan(0);
    }

    await page.screenshot({
      path: `${EV}/negotiation-flow-02-candidates.png`,
      fullPage: true,
    });

    // モーダルヘッダに出ている日付・シフト名・時刻（＝店長が読む情報）を控える
    const header = page.locator('div:has(> h2:has-text("人手不足解消アシスタント"))').first();
    const headerText = await header.innerText();
    const headerMatch = headerText.match(/(\d+\/\d+ \([日月火水木金土]\))\s*【(.+?)】\s*\((\d{2}:\d{2})〜(\d{2}:\d{2})\)/);
    expect(headerMatch, 'モーダルに日付・シフト名・時刻が表示されていること').toBeTruthy();
    const [, headerDate, headerShiftName, headerStart, headerEnd] = headerMatch as RegExpMatchArray;

    // 1位候補の文面をコピー
    const topId = candidateIds[0];
    const topStaff = staffById.get(topId) as { name: string };
    await copyButtons.nth(0).click();

    // 状態変化: ボタン文言とトースト
    await expect(copyButtons.nth(0)).toContainText('LINE文面をコピーしました！');
    const toast = page.locator('[data-testid="admin-toast-banner"]');
    await expect(toast).toBeVisible();
    await expect(toast).toContainText(`「${topStaff.name}」さん宛`);
    await page.screenshot({
      path: `${EV}/negotiation-flow-03-copied.png`,
      fullPage: true,
    });

    // 実際にクリップボードへ入った文面が、画面に出ている情報と一致すること
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toContain(`${topStaff.name}さん`);
    expect(clip).toContain(headerDate);
    expect(clip).toContain(`【${headerShiftName}】`);
    expect(clip).toContain(`(${headerStart}〜${headerEnd})`);
    expect(clip).toContain('出勤をお願いできないでしょうか');
    // 他人の名前が混ざっていないこと
    for (const id of candidateIds.slice(1)) {
      const other = staffById.get(id) as { name: string };
      expect(clip).not.toContain(`${other.name}さん、お疲れ様です`);
    }
  });

  test('深夜(22時以降)の不足枠で、年少者や当日既に出勤済みのスタッフを代打候補に出さない', async ({
    page,
  }) => {
    test.setTimeout(180000);
    await page.goto('/admin');
    const res = await optimizeForReal(page);

    // 22時以降の不足枠を実レスポンスから探す
    const lateUnfilled = res.summary.unfilled_requirements.filter((u) => {
      const m = u.shift_id.match(/^hour_(\d{2})$/);
      return m ? Number(m[1]) >= 22 || Number(m[1]) < 5 : false;
    });
    expect(lateUnfilled.length, '深夜帯の不足枠が実求解に存在すること').toBeGreaterThan(0);
    const target = lateUnfilled[0];
    const targetHour = Number((target.shift_id.match(/^hour_(\d{2})$/) as RegExpMatchArray)[1]);

    await page.locator('[data-testid="tab-view-slots"]').click();
    await page
      .locator(`[data-testid="btn-unfilled-slot-${target.day_offset}-${target.shift_id}"]`)
      .click();
    await expect(page.locator('h2:has-text("人手不足解消アシスタント")')).toBeVisible();
    await page.screenshot({
      path: `${EV}/negotiation-flow-04-late-night-candidates.png`,
      fullPage: true,
    });

    const request = await readStoredRequest(page);
    const staffById = new Map(request.staff_members.map((s) => [s.id, s]));

    const copyButtons = page.locator('[data-testid^="btn-copy-negotiation-"]');
    const count = await copyButtons.count();
    const candidateIds: string[] = [];
    for (let i = 0; i < count; i++) {
      const testId = await copyButtons.nth(i).getAttribute('data-testid');
      candidateIds.push((testId as string).replace('btn-copy-negotiation-', ''));
    }

    // 1. 労基法第60条: 22時以降の枠に年少者を推薦してはならない
    for (const id of candidateIds) {
      const staff = staffById.get(id);
      expect(
        staff?.is_minor,
        `${staff?.name} は18歳未満。${targetHour}:00台の不足枠の代打候補に出してはならない`
      ).not.toBe(true);
    }

    // 2. 提示される時間帯が、不足している時間帯を含んでいること
    //    （不足は hour_XX、モーダルが表示するのはシフト枠の時刻）
    const header = page.locator('div:has(> h2:has-text("人手不足解消アシスタント"))').first();
    const headerText = await header.innerText();
    const times = headerText.match(/\((\d{2}):(\d{2})〜(\d{2}):(\d{2})\)/) as RegExpMatchArray;
    const startH = Number(times[1]);
    const endH = Number(times[3]) === 0 ? 24 : Number(times[3]);
    expect(
      targetHour >= startH && targetHour < endH,
      `不足しているのは ${targetHour}:00台なのに、依頼文面のシフト時刻は ${times[0]}`
    ).toBe(true);

    // 3. その日すでに出勤しているスタッフを「代打」として推薦しないこと
    const workingThatDay = new Set(
      (res.assigned_shifts ?? [])
        .filter((s) => s.day_offset === target.day_offset)
        .map((s) => s.staff_id)
    );
    for (const id of candidateIds) {
      expect(
        workingThatDay.has(id),
        `${staffById.get(id)?.name} は ${target.date} に既に出勤済みなのに代打候補に出ている`
      ).toBe(false);
    }
  });
});
