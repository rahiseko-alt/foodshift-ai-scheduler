import type { Metadata } from 'next';
import '../styles/globals.css';

export const metadata: Metadata = {
  title: 'FoodShift — 飲食店向けAIシフト自動作成',
  description: '労基法18歳未満深夜禁止・希望・スキルを100%遵守する飲食店特化型シフト最適化アプリ',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
