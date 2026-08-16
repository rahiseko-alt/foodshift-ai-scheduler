'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { OfflineBanner } from './OfflineBanner';

export const AdminNavbar: React.FC = () => {
  const pathname = usePathname();

  const navItems = [
    { label: '⚡ シフト作成・最適化', href: '/admin' },
    { label: '👥 スタッフマスタ管理', href: '/admin/staff' },
    { label: '⏰ シフト枠・必要人数設定', href: '/admin/shifts' },
    { label: '📖 機能解説・ルール仕様', href: '/admin/guide' },
  ];

  return (
    <nav style={{ marginBottom: '1.5rem' }}>
      <OfflineBanner />

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem',
          paddingBottom: '1rem',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '8px',
              backgroundColor: 'var(--primary)',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 800,
              fontSize: '1.125rem',
            }}
          >
            FS
          </div>
          <div>
            <div style={{ fontSize: '1.125rem', fontWeight: 700, letterSpacing: '-0.02em' }}>
              FoodShift AI
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              飲食店特化型 シフト自動スケジューラー
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Link
            href="/submit"
            className="btn btn-secondary btn-sm"
            data-testid="nav-link-submit"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
          >
            <span>📱 スタッフ希望入力 (/submit)</span>
          </Link>
        </div>
      </div>

      <div className="nav-tab-bar" style={{ marginTop: '0.75rem' }}>
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`nav-tab-item ${isActive ? 'active' : ''}`}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
};
