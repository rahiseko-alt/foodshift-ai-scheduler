'use client';

import React, { useState } from 'react';
import { ShiftOptimizeRequest } from '@/lib/types';
import { startFreshStore } from '@/lib/storage';

interface Props {
  request: ShiftOptimizeRequest;
  isDemoData: boolean;
  isOpen: boolean;
  onToggle: () => void;
  onChange: (next: ShiftOptimizeRequest) => void;
  onFreshStart: (next: ShiftOptimizeRequest) => void;
  onNotify: (msg: string) => void;
}

/**
 * 店舗情報（店舗名・対象期間）の設定と、自店データの新規作成。
 *
 * 従来は対象期間を編集するUIがアプリ全体に存在せず、
 * 新規の店長は永久に「2026-09-01から14日間」のシフトしか作れなかった。
 * また自店を立ち上げる手段が無く、デモの15人を1人ずつ削除するしかなかった。
 */
export const StoreSetupPanel: React.FC<Props> = ({
  request,
  isDemoData,
  isOpen,
  onToggle,
  onChange,
  onFreshStart,
  onNotify,
}) => {
  const [newStoreName, setNewStoreName] = useState('');

  const updatePeriod = (patch: Partial<{ start_date: string; days: number }>) => {
    onChange({ ...request, period: { ...request.period, ...patch } });
  };

  const handleFreshStart = () => {
    const name = newStoreName.trim();
    if (!name) {
      onNotify('店舗名を入力してください');
      return;
    }
    if (
      !window.confirm(
        `「${name}」として新しく始めます。\n現在表示中のデータ（スタッフ・シフト枠・必要人数）はすべて削除されます。よろしいですか？`
      )
    ) {
      return;
    }
    const fresh = startFreshStore(name, request.period.start_date, request.period.days);
    onFreshStart(fresh);
    onNotify(`「${name}」を作成しました。スタッフを登録してください`);
  };

  return (
    <div style={{ marginBottom: '1rem' }}>
      {isDemoData && (
        <div
          data-testid="demo-data-banner"
          style={{
            backgroundColor: 'var(--warning-bg)',
            color: 'var(--warning)',
            border: '1px solid var(--warning-border)',
            borderRadius: 'var(--radius-sm)',
            padding: '0.875rem 1.25rem',
            marginBottom: '0.75rem',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.5rem',
          }}
        >
          <span style={{ fontWeight: 600 }}>
            これはサンプルデータです（居酒屋・15名）。自分のお店のデータではありません。
          </span>
          <button
            type="button"
            data-testid="btn-open-store-setup"
            className="btn"
            onClick={onToggle}
            style={{ whiteSpace: 'nowrap' }}
          >
            自分のお店で始める
          </button>
        </div>
      )}

      <div className="card" style={{ padding: '1rem' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ fontWeight: 700 }}>
            {request.store_name || (isDemoData ? 'サンプル店舗' : '店舗名未設定')}
          </div>
          <button
            type="button"
            data-testid="btn-toggle-store-setup"
            className="btn btn-secondary"
            onClick={onToggle}
          >
            {isOpen ? '閉じる' : '店舗・期間の設定'}
          </button>
        </div>

        {isOpen && (
          <div style={{ marginTop: '1rem', display: 'grid', gap: '1rem' }}>
            <div style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
              <label style={{ display: 'grid', gap: '0.25rem' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>店舗名</span>
                <input
                  data-testid="input-store-name"
                  type="text"
                  value={request.store_name || ''}
                  placeholder="例: 居酒屋 まんぷく 渋谷店"
                  onChange={(e) => onChange({ ...request, store_name: e.target.value })}
                />
              </label>

              <label style={{ display: 'grid', gap: '0.25rem' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>開始日</span>
                <input
                  data-testid="input-period-start"
                  type="date"
                  value={request.period.start_date}
                  onChange={(e) => updatePeriod({ start_date: e.target.value })}
                />
              </label>

              <label style={{ display: 'grid', gap: '0.25rem' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>日数（1〜31）</span>
                <input
                  data-testid="input-period-days"
                  type="number"
                  min={1}
                  max={31}
                  value={request.period.days}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isFinite(n)) {
                      updatePeriod({ days: Math.min(31, Math.max(1, Math.trunc(n))) });
                    }
                  }}
                />
              </label>
            </div>

            <div
              style={{
                borderTop: '1px solid var(--border)',
                paddingTop: '1rem',
                display: 'grid',
                gap: '0.5rem',
              }}
            >
              <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>ゼロから始める</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                表示中のスタッフ・シフト枠・必要人数をすべて削除し、空の状態から作成します。
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <input
                  data-testid="input-new-store-name"
                  type="text"
                  value={newStoreName}
                  placeholder="新しい店舗名"
                  onChange={(e) => setNewStoreName(e.target.value)}
                  style={{ flex: '1 1 200px' }}
                />
                <button
                  type="button"
                  data-testid="btn-fresh-start"
                  className="btn btn-danger"
                  onClick={handleFreshStart}
                >
                  データを全消去して開始
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
