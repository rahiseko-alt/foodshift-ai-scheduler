import type { Metadata, Viewport } from 'next';
import '../styles/globals.css';
import ServiceWorkerRegister from '../components/pwa/ServiceWorkerRegister';
import PwaInstallPrompt from '../components/pwa/PwaInstallPrompt';

export const metadata: Metadata = {
  title: 'FoodShift — 飲食店向けAIシフト自動作成',
  description: '労基法18歳未満深夜禁止・希望・スキルを100%遵守する飲食店特化型シフト最適化アプリ',
  manifest: '/manifest.webmanifest',
  applicationName: 'FoodShift',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'FoodShift',
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: '/icons/icon-192x192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512x512.png', sizes: '512x512', type: 'image/png' },
      { url: '/icons/icon.svg', type: 'image/svg+xml' },
    ],
    apple: [
      { url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  },
};

export const viewport: Viewport = {
  themeColor: '#2563eb',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <head>
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="FoodShift" />
      </head>
      <body>
        <ServiceWorkerRegister />
        {children}
        <PwaInstallPrompt />
      </body>
    </html>
  );
}
