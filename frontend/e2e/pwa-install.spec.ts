/**
 * CUJ-10: PWA マニフェスト / Service Worker / インストール導線
 *
 * 【修正前に何が起きていたか】
 *  - `expect(manifest.icons.length).toBeGreaterThanOrEqual(2)` のような恒真に近い比較。
 *  - アイコン検証が `expect(res.status()).toBe(200)` のみ。Next.js は存在しないパスでも
 *    HTMLの404ページを返す構成があり得るため、「200が返る」だけでは画像が実在する証拠にならない。
 *    （0バイトや壊れたPNGでも緑になる）
 *  - sw.js は「ファイル内に文字列が含まれるか」を見るだけで、ブラウザに登録され
 *    activate したか・実際にキャッシュが作られたかという実物は一度も見ていなかった。
 *  - インストール導線 (PwaInstallPrompt) は存在自体がテストされていなかった。
 *
 * 【このテストの方針】
 *  バイト列（PNGシグネチャ）、ブラウザ内の ServiceWorkerRegistration の実状態、
 *  CacheStorage の実内容、実際の UI 操作の状態変化を見る。
 */
import { test, expect } from '@playwright/test';

const EV = '/tmp/claude-0/-home-user-foodshift-ai-scheduler/8cea9e3e-1847-5cca-ac45-5ec023e8495a/scratchpad/evidence/a2';

/**
 * クライアント側の useEffect が動いた（＝ハイドレーション完了）ことを待つ。
 * SSR済みHTMLに対する toBeVisible はハイドレーション前でも通ってしまい、
 * その状態で SW 登録やイベントハンドラを期待すると「実物を見ていない」テストになる。
 */
async function waitForHydration(page: import('@playwright/test').Page) {
  await expect(page.locator('[data-testid="btn-optimize"]')).toBeVisible({ timeout: 60000 });
  await expect(page.locator('[data-testid="demo-data-banner"]')).toBeVisible({ timeout: 60000 });
}

test.describe('CUJ-10: PWA Manifest, Service Worker & Installability', () => {
  test('マニフェストが standalone / アイコン定義を正しく返すこと', async ({ request }) => {
    const res = await request.get('/manifest.webmanifest');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('json');

    const manifest = await res.json();
    expect(manifest.name).toBe('FoodShift — 飲食店向けAIシフト自動作成');
    expect(manifest.short_name).toBe('FoodShift');
    expect(manifest.start_url).toBe('/admin');
    expect(manifest.display).toBe('standalone');
    expect(manifest.scope).toBe('/');
    expect(manifest.theme_color).toBe('#2563eb');
    expect(manifest.background_color).toBe('#f8fafc');

    // アイコン定義は「2個以上あればOK」ではなく、実際の定義そのものを固定する
    const icons = (manifest.icons as Array<{ src: string; sizes: string; type: string; purpose: string }>).map(
      (i) => `${i.src}|${i.sizes}|${i.type}|${i.purpose}`
    );
    expect(icons.sort()).toEqual(
      [
        '/icons/icon-192x192.png|192x192|image/png|maskable',
        '/icons/icon-512x512.png|512x512|image/png|maskable',
        '/icons/icon-192x192.png|192x192|image/png|any',
        '/icons/icon-512x512.png|512x512|image/png|any',
        '/icons/icon.svg|any|image/svg+xml|any',
      ].sort()
    );
  });

  test('マニフェストが指すアイコンが実在する画像ファイルであること（200を返すHTMLではない）', async ({
    request,
  }) => {
    // devサーバのコンパイル直後は 404 HTML が返ることがあるため、JSONが返るまで待つ
    let manifest: { icons: Array<{ src: string; sizes: string }> } | null = null;
    for (let i = 0; i < 10 && !manifest; i++) {
      const r = await request.get('/manifest.webmanifest');
      if (r.status() === 200 && (r.headers()['content-type'] || '').includes('json')) {
        manifest = await r.json();
      } else {
        await new Promise((res) => setTimeout(res, 1000));
      }
    }
    expect(manifest, 'マニフェストがJSONとして配信されること').toBeTruthy();
    const icons = (manifest as { icons: Array<{ src: string; sizes: string }> }).icons;
    const srcs: string[] = Array.from(new Set(icons.map((i) => i.src)));
    srcs.push('/icons/apple-touch-icon.png');

    for (const src of srcs) {
      const res = await request.get(src);
      expect(res.status(), `${src} が配信されること`).toBe(200);
      const buf = await res.body();
      expect(buf.length, `${src} が空ファイルでないこと`).toBeGreaterThan(500);

      if (src.endsWith('.png')) {
        expect(res.headers()['content-type']).toContain('image/png');
        // PNG シグネチャ (89 50 4E 47 0D 0A 1A 0A)
        expect(
          buf.subarray(0, 8).toString('hex'),
          `${src} が本物のPNGであること`
        ).toBe('89504e470d0a1a0a');
        // IHDR から実解像度を読み、宣言サイズと一致することを確認
        const width = buf.readUInt32BE(16);
        const height = buf.readUInt32BE(20);
        const declared = icons.find((i) => i.src === src)?.sizes;
        if (declared && declared !== 'any') {
          expect(`${width}x${height}`, `${src} の実解像度が宣言と一致すること`).toBe(declared);
        }
      } else if (src.endsWith('.svg')) {
        expect(res.headers()['content-type']).toContain('svg');
        expect(buf.toString('utf-8')).toContain('<svg');
      }
    }
  });

  test('Service Worker が実際に登録・activate され、コアアセットをキャッシュすること', async ({
    page,
  }) => {
    test.setTimeout(90000);
    const swRes = await page.request.get('/sw.js');
    expect(swRes.status()).toBe(200);
    expect(swRes.headers()['content-type']).toContain('javascript');

    await page.goto('/admin');
    await waitForHydration(page);

    // ブラウザ内の実際の登録状態を見る（ファイル内の文字列ではない）。
    // 「sw.js が200で配信される」ことと「ブラウザに登録されている」ことは別物。
    const swState = await page.evaluate(async () => {
      const deadline = Date.now() + 20000;
      let regs = await navigator.serviceWorker.getRegistrations();
      while (regs.length === 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 500));
        regs = await navigator.serviceWorker.getRegistrations();
      }
      if (regs.length === 0) {
        return {
          registrationCount: 0,
          scope: null as string | null,
          scriptURL: null as string | null,
          state: null as string | null,
          readyState: document.readyState,
        };
      }
      const reg = await navigator.serviceWorker.ready;
      // activate は非同期に進むため、遷移途中(activating)を拾わないよう待つ。
      // ここを待たずに1回サンプリングすると、登録自体は成功しているのに
      // 「activating」で落ちるフレーキーなテストになる。
      const activateDeadline = Date.now() + 10000;
      while (reg.active?.state !== 'activated' && Date.now() < activateDeadline) {
        await new Promise((r) => setTimeout(r, 100));
      }
      return {
        registrationCount: regs.length,
        scope: reg.scope,
        scriptURL: reg.active?.scriptURL ?? null,
        state: reg.active?.state ?? null,
        readyState: document.readyState,
      };
    });
    await page.screenshot({ path: `${EV}/pwa-install-01-sw-registration.png`, fullPage: true });

    expect(
      swState.registrationCount,
      `ハイドレーション完了後 (document.readyState=${swState.readyState}) でも Service Worker の登録が0件。` +
        ' sw.js は配信されているがブラウザには登録されていない（オフライン動作・インストール性が成立しない）'
    ).toBeGreaterThan(0);
    expect(swState.scriptURL, 'sw.js が active な Service Worker として登録されていること').toContain(
      '/sw.js'
    );
    expect(swState.state).toBe('activated');
    expect(swState.scope).toMatch(/\/$/);

    // CacheStorage に静的キャッシュが作られ、実アセットが入っていること
    const cacheInfo = await page.evaluate(async () => {
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        const keys = await caches.keys();
        const staticKey = keys.find((k) => k.startsWith('static-foodshift-'));
        if (staticKey) {
          const cache = await caches.open(staticKey);
          const reqs = await cache.keys();
          const paths = reqs.map((r) => new URL(r.url).pathname);
          if (paths.length > 0) return { keys, staticKey, paths };
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      return { keys: await caches.keys(), staticKey: null, paths: [] as string[] };
    });

    expect(cacheInfo.staticKey, `static キャッシュが作られること (${cacheInfo.keys})`).toBeTruthy();
    expect(cacheInfo.paths, 'アイコンが事前キャッシュされていること').toContain(
      '/icons/icon-192x192.png'
    );

    // キャッシュされた中身が本物のPNGであること
    const cachedIsPng = await page.evaluate(async (staticKey: string) => {
      const cache = await caches.open(staticKey);
      const res = await cache.match('/icons/icon-192x192.png');
      if (!res) return null;
      const buf = new Uint8Array(await res.arrayBuffer());
      return Array.from(buf.slice(0, 8))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    }, cacheInfo.staticKey as string);
    expect(cachedIsPng).toBe('89504e470d0a1a0a');
  });

  test('インストール案内バナーが beforeinstallprompt で出て、「閉じる」で抑止されること', async ({
    page,
  }) => {
    test.setTimeout(90000);
    await page.goto('/admin');
    await waitForHydration(page);

    const banner = page.locator('[data-testid="pwa-install-banner"]');
    await expect(banner, 'イベント前はバナーが出ていないこと').toHaveCount(0);

    // Chromium はテスト環境で beforeinstallprompt を発火しないため、
    // アプリ側のハンドラに実イベントを流し込んで挙動を確認する
    await page.evaluate(() => {
      const ev = new Event('beforeinstallprompt') as Event & {
        prompt?: () => Promise<void>;
        userChoice?: Promise<{ outcome: string }>;
      };
      ev.prompt = async () => undefined;
      ev.userChoice = Promise.resolve({ outcome: 'dismissed' });
      window.dispatchEvent(ev);
    });

    await expect(banner).toBeVisible();
    await expect(banner).toContainText('FoodShift をホーム画面に追加');
    await expect(page.locator('[data-testid="btn-pwa-install"]')).toBeVisible();
    await page.screenshot({ path: `${EV}/pwa-install-02-banner.png`, fullPage: true });

    await page.locator('[data-testid="btn-pwa-dismiss"]').click();
    await expect(banner).toHaveCount(0);

    // 「あとで」の抑止が実際に永続化され、再表示されないこと
    const dismissedAt = await page.evaluate(() =>
      localStorage.getItem('foodshift_pwa_prompt_dismissed')
    );
    expect(Number(dismissedAt)).toBeGreaterThan(0);

    await page.reload();
    await waitForHydration(page);
    await page.evaluate(() => window.dispatchEvent(new Event('beforeinstallprompt')));
    await expect(banner, '7日間は再表示されないこと').toHaveCount(0);
    await page.screenshot({ path: `${EV}/pwa-install-03-dismissed.png`, fullPage: true });
  });

  test('PWA メタタグが document head に出力されること', async ({ page }) => {
    await page.goto('/admin');
    expect(await page.locator('meta[name="theme-color"]').getAttribute('content')).toBe('#2563eb');
    expect(
      await page.locator('meta[name="apple-mobile-web-app-capable"]').getAttribute('content')
    ).toBe('yes');
    expect(
      await page.locator('link[rel="apple-touch-icon"]').first().getAttribute('href')
    ).toContain('apple-touch-icon.png');
    expect(await page.locator('link[rel="manifest"]').getAttribute('href')).toContain(
      'manifest.webmanifest'
    );
  });
});
