// FoodShift Progressive Web App Service Worker
const CACHE_VERSION = 'foodshift-v1.0.0';
const STATIC_CACHE_NAME = `static-${CACHE_VERSION}`;
const RUNTIME_CACHE_NAME = `runtime-${CACHE_VERSION}`;

// 初回インストール時に事前キャッシュするコアアセット
const PRECACHE_ASSETS = [
  '/',
  '/admin',
  '/submit',
  '/admin/staff',
  '/admin/shifts',
  '/admin/forecast',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
  '/icons/apple-touch-icon.png',
  '/icons/icon.svg',
];

// 1. インストールイベント: コアアセットの事前キャッシュ
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS).catch((err) => {
        console.warn('[SW] Pre-cache partial failure, continuing:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// 2. アクティベートイベント: 古いバージョンのキャッシュ削除
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (
            cacheName.startsWith('static-foodshift-') && cacheName !== STATIC_CACHE_NAME ||
            cacheName.startsWith('runtime-foodshift-') && cacheName !== RUNTIME_CACHE_NAME
          ) {
            console.log('[SW] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 3. フェッチイベント: キャッシュ戦略
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 非 GET リクエストやバックエンド API (/api/) は Network-Only
  if (request.method !== 'GET' || url.pathname.startsWith('/api/')) {
    return;
  }

  // Next.js 静的チャンク・画像・アイコン: Cache-First (高速ロード)
  if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.js')
  ) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(STATIC_CACHE_NAME).then((cache) => {
              cache.put(request, responseToCache);
            });
          }
          return networkResponse;
        });
      })
    );
    return;
  }

  // HTML ナビゲーションリクエスト: Stale-While-Revalidate (オフライン即時表示 + バックグラウンド更新)
  if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        const fetchPromise = fetch(request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              const responseToCache = networkResponse.clone();
              caches.open(RUNTIME_CACHE_NAME).then((cache) => {
                cache.put(request, responseToCache);
              });
            }
            return networkResponse;
          })
          .catch((err) => {
            console.warn('[SW] Offline navigate fallback:', err);
            // ネットワーク遮断時はキャッシュまたは /admin フォールバック
            return cachedResponse || caches.match('/admin');
          });

        return cachedResponse || fetchPromise;
      })
    );
    return;
  }

  // その他のリクエスト: Network First フォールバック
  event.respondWith(
    fetch(request).catch(() => caches.match(request))
  );
});
