'use client';

import React, { useEffect, useState } from 'react';

/**
 * オフライン検知バナー (No. 221: Wi-Fi断線・オフライン未認知によるパニック防止)
 */
export const OfflineBanner: React.FC = () => {
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    setIsOnline(navigator.onLine);

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (isOnline) return null;

  return (
    <div
      data-testid="offline-banner"
      style={{
        backgroundColor: '#dc2626',
        color: '#ffffff',
        padding: '0.625rem 1rem',
        borderRadius: 'var(--radius-sm)',
        marginBottom: '1rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '0.5rem',
        fontWeight: 700,
        fontSize: '0.875rem',
        boxShadow: '0 2px 4px rgba(220, 38, 38, 0.2)',
        zIndex: 9999,
      }}
    >
      <span style={{ fontWeight: 800 }}>[オフライン]</span>
      <span>
        現在オフラインです。インターネット接続が切断されているため、最適化計算やデータ送信が行えません。Wi-Fiまたはモバイル通信をご確認ください。
      </span>
    </div>
  );
};
