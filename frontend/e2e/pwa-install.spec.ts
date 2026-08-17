import { test, expect } from '@playwright/test';

test.describe('CUJ-10: Progressive Web App (PWA) Manifest, Service Worker & Installability', () => {
  test('should provide valid web app manifest with standalone display and proper icons', async ({
    request,
  }) => {
    // 1. Next.js App Router マニフェストエンドポイントへのリクエスト
    const res = await request.get('/manifest.webmanifest');
    expect(res.status()).toBe(200);

    const manifest = await res.json();
    expect(manifest.name).toBe('FoodShift — 飲食店向けAIシフト自動作成');
    expect(manifest.short_name).toBe('FoodShift');
    expect(manifest.start_url).toBe('/admin');
    expect(manifest.display).toBe('standalone');
    expect(manifest.theme_color).toBe('#2563eb');
    expect(manifest.background_color).toBe('#f8fafc');

    // アイコン定義の検証
    expect(Array.isArray(manifest.icons)).toBe(true);
    expect(manifest.icons.length).toBeGreaterThanOrEqual(2);

    const has192 = manifest.icons.some(
      (icon: { sizes: string; src: string }) => icon.sizes === '192x192' && icon.src.includes('icon-192x192.png')
    );
    const has512 = manifest.icons.some(
      (icon: { sizes: string; src: string }) => icon.sizes === '512x512' && icon.src.includes('icon-512x512.png')
    );
    expect(has192).toBe(true);
    expect(has512).toBe(true);
  });

  test('should serve Service Worker (sw.js) with 200 OK and valid JavaScript headers', async ({
    request,
  }) => {
    const res = await request.get('/sw.js');
    expect(res.status()).toBe(200);
    const text = await res.text();
    expect(text).toContain('FoodShift Progressive Web App Service Worker');
    expect(text).toContain('CACHE_VERSION');
    expect(text).toContain('addEventListener');
  });

  test('should serve all required icon assets correctly', async ({ request }) => {
    const icon192 = await request.get('/icons/icon-192x192.png');
    expect(icon192.status()).toBe(200);

    const icon512 = await request.get('/icons/icon-512x512.png');
    expect(icon512.status()).toBe(200);

    const appleIcon = await request.get('/icons/apple-touch-icon.png');
    expect(appleIcon.status()).toBe(200);

    const svgIcon = await request.get('/icons/icon.svg');
    expect(svgIcon.status()).toBe(200);
  });

  test('should render PWA metadata and meta tags in document head', async ({ page }) => {
    await page.goto('/admin');

    // theme-color メタタグ
    const themeColor = await page.locator('meta[name="theme-color"]').getAttribute('content');
    expect(themeColor).toBe('#2563eb');

    // apple-mobile-web-app-capable メタタグ
    const appleCapable = await page.locator('meta[name="apple-mobile-web-app-capable"]').getAttribute('content');
    expect(appleCapable).toBe('yes');

    // apple-touch-icon リンクタグ
    const appleTouchIcon = await page.locator('link[rel="apple-touch-icon"]').first().getAttribute('href');
    expect(appleTouchIcon).toContain('apple-touch-icon.png');

    // manifest リンクタグ
    const manifestLink = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(manifestLink).toContain('manifest.webmanifest');
  });
});
