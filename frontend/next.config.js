const isProd = process.env.NODE_ENV === 'production';

// API の接続先。本番では実際に使うホストだけを許可する。
// 以前は `https://*.onrender.com` を丸ごと許可しており、
// onrender.com 上の任意のサービスへ通信できる状態だった。
const apiOrigin = (() => {
  const url = process.env.NEXT_PUBLIC_API_URL || 'https://foodshift-api.onrender.com';
  try {
    return new URL(url).origin;
  } catch {
    return 'https://foodshift-api.onrender.com';
  }
})();

// 開発時のみ localhost への接続と Next.js の eval を許可する。
// 本番ビルドにこれらが残っていると CSP の意味が薄れる。
const connectSrc = ["'self'", apiOrigin]
  .concat(isProd ? [] : ['http://localhost:8000', 'http://127.0.0.1:8000'])
  .join(' ');
const scriptSrc = ["'self'", "'unsafe-inline'"]
  .concat(isProd ? [] : ["'unsafe-eval'"])
  .join(' ');

const cspHeader = `
    default-src 'self';
    script-src ${scriptSrc};
    style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
    img-src 'self' blob: data:;
    font-src 'self' https://fonts.gstatic.com;
    object-src 'none';
    base-uri 'self';
    form-action 'self';
    frame-ancestors 'none';
    connect-src ${connectSrc};
`
  .replace(/\s{2,}/g, ' ')
  .trim();

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Content-Security-Policy', value: cspHeader },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'geolocation=(), microphone=(), camera=()' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
