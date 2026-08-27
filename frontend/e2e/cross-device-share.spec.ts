/**
 * 店長の名簿がスタッフの「別端末」に届き、希望が店長に戻ることの検証。
 *
 * バックエンドは店舗データを保存しないため、スタッフの端末が自店の名簿を
 * 知る手段が無く、/submit を開いても常にサンプルの15人が表示されていた
 * （自分の名前が絶対に出ない = 実店舗では運用できない）。
 *
 * 既存の line-sync-flow.spec.ts は同一 page（＝同一 LocalStorage）で
 * /submit と /admin を往復しているだけで、端末を跨ぐ検証になっていなかった。
 * このテストは 2つの独立した BrowserContext を使い、
 * 店長とスタッフが別端末であることを保証する。
 */
import { test, expect } from '@playwright/test';

const EV = '/tmp/claude-0/-home-user-foodshift-ai-scheduler/8cea9e3e-1847-5cca-ac45-5ec023e8495a/scratchpad/evidence/mine';

test('CUJ-13: 店長の名簿がスタッフの別端末に届き、希望が店長に戻る', async ({ browser, baseURL }) => {
  test.setTimeout(180000);
    // 店長とスタッフを「別端末」として完全に分離する
  const managerCtx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const staffCtx = await browser.newContext();
  const manager = await managerCtx.newPage();
  const staff = await staffCtx.newPage();

  // --- 店長: 自店を立ち上げてスタッフを登録 ---
  await manager.goto(`${baseURL}/admin`);
  await manager.locator('[data-testid="btn-open-store-setup"]').click();
  await manager.locator('[data-testid="input-new-store-name"]').fill('炉端焼き ためし屋');
  manager.on('dialog', (d) => d.accept());
  await manager.locator('[data-testid="btn-fresh-start"]').click();
  // 初期化が実際に効いたことを確認してから進む。
  // 確認せずに進むと、デモの15人を名簿として配ってしまい
  // 「スタッフに自分の名前が出ない」不具合を検出できないまま緑になる。
  await expect(manager.locator('[data-testid="demo-data-banner"]')).toHaveCount(0);

  await manager.goto(`${baseURL}/admin/staff`);
  for (const name of ['青木 一郎', '井上 二郎']) {
    await manager.locator('[data-testid="btn-add-staff"]').click();
    await manager.locator('[data-testid="input-staff-name"]').fill(name);
    await manager.locator('[data-testid="input-staff-wage"]').fill('1100');
    await manager.locator('[data-testid="btn-save-staff"]').click();
    await manager.waitForTimeout(500);
  }
  await manager.screenshot({ path: `${EV}/01-manager-staff-registered.png`, fullPage: true });

  // シフト枠はデモ復元ではなく手動追加が必要なため、プリセットを使う
  await manager.goto(`${baseURL}/admin/shifts`);
  await manager.locator('[data-testid="btn-reset-preset"]').click();
  await manager.screenshot({ path: `${EV}/02-manager-shifts.png`, fullPage: true });

  // --- 店長: 提出リンクを作る ---
  await manager.goto(`${baseURL}/admin`);
  await expect(manager.locator('[data-testid="share-submit-link"]')).toContainText('2名');
  await manager.locator('[data-testid="btn-generate-submit-link"]').click();
  const linkText = await manager.locator('[data-testid="submit-link-text"]').inputValue();
  await manager.screenshot({ path: `${EV}/03-manager-link-generated.png`, fullPage: true });
  const url = linkText.match(/https?:\/\/\S+/)?.[0] || '';
  expect(url).toContain('/submit#r=');

  // --- スタッフ: 別端末でリンクを開く ---
  await staff.goto(url);
  await expect(staff.locator('[data-testid="roster-loaded-banner"]')).toBeVisible();
  await staff.screenshot({ path: `${EV}/04-staff-roster-loaded.png`, fullPage: true });

  // 自分の名前が出る（従来はサンプルの15人しか出なかった）
  const options = await staff.locator('[data-testid="select-staff"] option').allTextContents();
  expect(options.join('|')).toContain('青木 一郎');
  expect(options.join('|')).not.toContain('佐藤 店長');

  // --- スタッフ: 自分の名前を選び、Day1に希望を出して提出 ---
  await staff.locator('[data-testid="select-staff"]').selectOption({ label: '青木 一郎' });
  const slot = staff.locator('[data-testid^="btn-slot-0-"]').first();
  await slot.click();
  await expect(slot).toContainText('希望');
  await staff.screenshot({ path: `${EV}/05-staff-marked-day1.png`, fullPage: true });

  await staff.locator('[data-testid="btn-submit-availability"]').click();
  const banner = staff.locator('[data-testid="submit-success-banner"]');
  await expect(banner).toBeVisible();
  await staff.screenshot({ path: `${EV}/06-staff-submitted.png`, fullPage: true });

  const bannerText = (await banner.textContent()) || '';
  const code =
    bannerText.match(/FS2\|[a-zA-Z0-9_\-]+\|\d{4}-\d{2}-\d{2}\|\d+\|[a-zA-Z0-9]+\|[0-9a-fA-F]{4}/)?.[0] || '';
  expect(code).not.toBe('');

  // --- 店長: 別端末で受け取ったコードを取り込む ---
  await manager.goto(`${baseURL}/admin`);
  await manager.locator('[data-testid="btn-open-line-import"]').click();
  await manager.locator('textarea').first().fill(`お疲れ様です！希望です ${code}`);
  await manager.locator('button:has-text("提出コードを解析する")').click();
  await expect(manager.locator('text=取込可能')).toBeVisible();
  await manager.screenshot({ path: `${EV}/07-manager-import-preview.png`, fullPage: true });

  await manager.locator('button:has-text("一括反映する")').click();
  await expect(manager.locator('[data-testid="admin-toast-banner"]')).toBeVisible({ timeout: 5000 });
  await manager.screenshot({ path: `${EV}/08-manager-imported.png`, fullPage: true });

  // 取り込んだ希望が、スタッフが入力した Day1 のまま入っていること
  const stored = await manager.evaluate(() => {
    const raw = localStorage.getItem('foodshift_req_store_default');
    return raw ? JSON.parse(raw) : null;
  });
  const wants = (stored.availabilities || []).filter(
    (a: { status: string }) => a.status === 'want'
  );
  expect(wants.length).toBeGreaterThan(0);
  expect(wants.every((a: { day_offset: number }) => a.day_offset === 0)).toBe(true);
  expect(wants.every((a: { staff_id: string }) => a.staff_id === stored.staff_members[0].id)).toBe(
    true
  );

  // 14. スタッフの意思が、最適化が実際に読む側のデータに入っていること
  //
  // 管理画面の最適化は hourly_availabilities を読む経路に到達する。
  // 従来この値はタップ内容を一切見ず is_available: true 固定で生成されており、
  // **スタッフが「不可」と提出した日にもシフトが入れられていた**。
  // availabilities（タップの記録）だけを見るテストでは検出できないため、
  // ソルバーが読む側を直接検証する。
  const storedHourly = await manager.evaluate(() => {
    const raw = localStorage.getItem('foodshift_req_store_default');
    return raw ? JSON.parse(raw).hourly_availabilities || [] : [];
  });
  const day0 = storedHourly.find(
    (a: { staff_id: string; day_offset: number }) =>
      a.staff_id === stored.staff_members[0].id && a.day_offset === 0
  );
  expect(day0, 'Day1 の勤務可能時間が保存されていない').toBeTruthy();
  expect(day0.is_preferred, 'Day1 を希望したのに is_preferred が立っていない').toBe(true);
  expect(day0.is_available, 'Day1 が出勤不可になっている').toBe(true);

  // タップしていない日を勝手に「不可」にしない。
  // 画面の既定表示は「－ 通常」なので、触っていない枠は出勤可能として扱う。
  // ここが 'unavailable' だと、1枠だけタップして提出したスタッフが
  // 残り全部「不可」の人として店長に届き、実際には出られる日にも
  // 人員不足が発生する。
  const untouched = storedHourly.find(
    (a: { staff_id: string; day_offset: number }) =>
      a.staff_id === stored.staff_members[0].id && a.day_offset === 2
  );
  expect(untouched.is_available, 'タップしていない日が不可になっている').toBe(true);

  await managerCtx.close();
  await staffCtx.close();
});
