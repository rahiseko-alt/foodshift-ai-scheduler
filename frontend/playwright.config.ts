import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // 画面をまたぐ一連の操作（希望提出→コード生成→取込→検証、バックアップ→復元 など）は
  // dev サーバーのルート初回コンパイルを含むため、実測で30秒ぎりぎりに達していた。
  // その結果、中身とは無関係に「たまたま遅かった回」だけが赤くなる。
  // アサーションを削って軽くするのではなく、時間の枠を現実に合わせる。
  timeout: 60000,
  expect: {
    timeout: 5000,
  },
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'Desktop Chrome',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
