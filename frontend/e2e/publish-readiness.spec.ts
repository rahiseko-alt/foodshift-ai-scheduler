/**
 * 公開に必要な導線と表示の検証。
 *
 * 個人情報を扱うサービスとして、データの保存場所をユーザーが確認できる
 * ことを保証する。ページが存在するだけでなく、トップから到達できること、
 * 実際に内容が表示されることまで確認する。
 */
import { test, expect } from '@playwright/test';

const EV =
  '/tmp/claude-0/-home-user-foodshift-ai-scheduler/8cea9e3e-1847-5cca-ac45-5ec023e8495a/scratchpad/evidence/mine';

test.describe('公開準備', () => {
  test('トップページから個人情報の取り扱いへ到達し、内容が表示される', async ({ page }) => {
    await page.goto('/');
    const link = page.locator('[data-testid="link-privacy"]');
    await expect(link).toBeVisible();
    await link.click();

    await expect(page).toHaveURL(/\/privacy$/);
    // 見出しだけでなく、主張の中身が実際に描画されていることを確認する
    const body = page.locator('body');
    await expect(body).toContainText('データはお使いの端末の中だけに保存されます');
    await expect(body).toContainText('保存せずに破棄します');
    await expect(body).toContainText('サーバーへは送信されず');
    await page.screenshot({ path: `${EV}/09-privacy-page.png`, fullPage: true });

    // トップへ戻れる
    await page.locator('[data-testid="privacy-back-home"]').click();
    await expect(page).toHaveURL(/\/$/);
  });

  test('スタッフ画面のホームが管理画面ではなく入口ページを指す', async ({ page }) => {
    // 認証が無いため、ここが /admin を指していると
    // スタッフが全員の時給・年収を見られてしまう
    await page.goto('/submit');
    const home = page.locator('[data-testid="nav-home-btn"]');
    await expect(home).toBeVisible();
    await home.click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('body')).not.toContainText('スタッフ管理');
    await page.screenshot({ path: `${EV}/10-staff-home-goes-to-top.png`, fullPage: true });
  });
});

test.describe('画面の到達性', () => {
  test('需要予測ページへ管理画面のナビゲーションから到達できる', async ({ page }) => {
    // 820行の実装がありながら、アプリ内のどこからもリンクされておらず
    // URL直打ちでしか開けない孤児ルートになっていた
    await page.goto('/admin');
    const link = page.locator('a[href="/admin/forecast"]').first();
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(/\/admin\/forecast$/);
    // ページが実際に描画されていること（空でないこと）
    await expect(page.locator('body')).toContainText('予測');
    await page.screenshot({ path: `${EV}/11-forecast-reachable.png`, fullPage: true });
  });
});
