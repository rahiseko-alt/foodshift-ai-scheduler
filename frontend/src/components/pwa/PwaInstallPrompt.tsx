'use client';

import { useState, useEffect } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const STORAGE_KEY_DISMISSED = 'foodshift_pwa_prompt_dismissed';

export default function PwaInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // スタンドアロン（すでにインストール済み）の判定
    const isStandaloneMode =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true;

    setIsStandalone(isStandaloneMode);
    if (isStandaloneMode) return;

    // 過去に「あとで」を押したか（7日間非表示）
    const dismissedTime = localStorage.getItem(STORAGE_KEY_DISMISSED);
    if (dismissedTime && Date.now() - parseInt(dismissedTime, 10) < 7 * 24 * 60 * 60 * 1000) {
      return;
    }

    // iOS 判定
    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIosDevice = /iphone|ipad|ipod/.test(userAgent);
    setIsIOS(isIosDevice);

    if (isIosDevice) {
      // iOS は beforeinstallprompt が発火しないため、一定時間後にガイド表示
      const timer = setTimeout(() => {
        setShowPrompt(true);
      }, 4000);
      return () => clearTimeout(timer);
    }

    // Android / Chrome / Edge 用 beforeinstallprompt イベント
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setShowPrompt(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === 'accepted') {
      setShowPrompt(false);
    }
    setDeferredPrompt(null);
  };

  const handleDismiss = () => {
    setShowPrompt(false);
    localStorage.setItem(STORAGE_KEY_DISMISSED, Date.now().toString());
  };

  if (isStandalone || !showPrompt) return null;

  return (
    <aside
      role="region"
      aria-label="PWAインストール案内"
      data-testid="pwa-install-banner"
      style={{
        position: 'fixed',
        bottom: '1rem',
        left: '50%',
        transform: 'translateX(-50%)',
        width: 'calc(100% - 2rem)',
        maxWidth: '480px',
        backgroundColor: '#ffffff',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        padding: '0.875rem 1rem',
        boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.15), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
        animation: 'slideUp 0.3s ease-out',
      }}
    >
      <div
        style={{
          width: '40px',
          height: '40px',
          borderRadius: '10px',
          backgroundColor: 'var(--primary)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          color: '#ffffff',
          fontWeight: 700,
          fontSize: '1.2rem',
        }}
      >
        FS
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--text-main)' }}>
          FoodShift をホーム画面に追加
        </div>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.3 }}>
          {isIOS
            ? '共有ボタン (□↑) をタップし「ホーム画面に追加」'
            : 'アプリとして全画面で快適にシフト管理'}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '0.35rem', flexShrink: 0 }}>
        {!isIOS && deferredPrompt && (
          <button
            type="button"
            data-testid="btn-pwa-install"
            onClick={handleInstallClick}
            className="btn btn-primary btn-sm"
            style={{ fontSize: '0.75rem', padding: '0.35rem 0.65rem' }}
          >
            追加
          </button>
        )}
        <button
          type="button"
          data-testid="btn-pwa-dismiss"
          onClick={handleDismiss}
          className="btn btn-secondary btn-sm"
          style={{ fontSize: '0.75rem', padding: '0.35rem 0.5rem' }}
          aria-label="閉じる"
        >
          不可
        </button>
      </div>
    </aside>
  );
}
