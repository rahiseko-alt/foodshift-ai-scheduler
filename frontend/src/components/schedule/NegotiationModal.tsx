'use client';

import React, { useState } from 'react';
import { Shift, StaffMember, StaffAvailability, ScheduledShiftSlot } from '@/lib/types';
import { findShortageCandidates, CandidateScore } from '@/lib/negotiation';

interface NegotiationModalProps {
  isOpen: boolean;
  onClose: () => void;
  day_offset: number;
  shift: Shift;
  shifts?: Shift[];
  dateFormatted: string;
  staff_members: StaffMember[];
  availabilities: StaffAvailability[];
  currentSchedule: ScheduledShiftSlot[];
  required_roles?: Record<string, number>;
  showToast: (msg: string) => void;
}

export const NegotiationModal: React.FC<NegotiationModalProps> = ({
  isOpen,
  onClose,
  day_offset,
  shift,
  shifts = [shift],
  dateFormatted,
  staff_members,
  availabilities,
  currentSchedule,
  required_roles = {},
  showToast,
}) => {
  const [copiedStaffId, setCopiedStaffId] = useState<string | null>(null);

  if (!isOpen) return null;

  const candidates: CandidateScore[] = findShortageCandidates({
    day_offset,
    shift,
    shifts,
    dateFormatted,
    staff_members,
    availabilities,
    currentSchedule,
    required_roles,
  });

  const handleCopyMessage = async (candidate: CandidateScore) => {
    try {
      await navigator.clipboard.writeText(candidate.lineMessage);
      setCopiedStaffId(candidate.staff.id);
      showToast(`「${candidate.staff.name}」さん宛のお願いLINE文面をコピーしました！`);
      setTimeout(() => setCopiedStaffId(null), 3000);
    } catch {
      alert('クリップボードのコピーに失敗しました');
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: '1rem',
      }}
    >
      <div
        className="card"
        style={{
          width: '100%',
          maxWidth: '560px',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)',
          padding: 0,
          overflow: 'hidden',
        }}
      >
        {/* ヘッダー */}
        <div
          style={{
            padding: '1.25rem 1.5rem',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            backgroundColor: '#fff1f2',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '1.25rem' }}>🚨</span>
            <div>
              <h2 style={{ fontSize: '1.125rem', fontWeight: 800, margin: 0, color: '#be123c' }}>
                人手不足解消アシスタント
              </h2>
              <div style={{ fontSize: '0.75rem', color: '#9f1239' }}>
                {dateFormatted} 【{shift.name}】 ({shift.start}〜{shift.end}) の代打候補
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '1.25rem',
              cursor: 'pointer',
              color: '#be123c',
            }}
          >
            ✕
          </button>
        </div>

        {/* ボディ */}
        <div style={{ padding: '1.25rem 1.5rem', overflowY: 'auto', flex: 1 }}>
          <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
            労基法・週上限・連勤・保有ロール・公平性を数理評価し、<strong>今もっとも依頼しやすいスタッフTOP3</strong>を自動抽出しました。ワンタップでお願いLINEを送れます。
          </div>

          {candidates.length === 0 ? (
            <div
              style={{
                padding: '1.5rem',
                textAlign: 'center',
                backgroundColor: 'var(--surface-muted)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-muted)',
                fontSize: '0.875rem',
              }}
            >
              ⚠ 出勤可能な候補スタッフが見つかりませんでした。（全員が当日他シフトに入っているか、週上限・法令制約に達しています）
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {candidates.map((cand, rank) => {
                const isCopied = copiedStaffId === cand.staff.id;

                return (
                  <div
                    key={cand.staff.id}
                    className="card"
                    style={{
                      padding: '1rem',
                      border: rank === 0 ? '2px solid #6366f1' : '1px solid var(--border)',
                      backgroundColor: rank === 0 ? '#f5f3ff' : 'var(--surface)',
                      position: 'relative',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span
                          style={{
                            width: '24px',
                            height: '24px',
                            borderRadius: '9999px',
                            backgroundColor: rank === 0 ? '#6366f1' : 'var(--text-muted)',
                            color: '#ffffff',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontWeight: 800,
                            fontSize: '0.75rem',
                          }}
                        >
                          {rank + 1}
                        </span>
                        <span style={{ fontWeight: 800, fontSize: '1rem' }}>{cand.staff.name}</span>
                        {cand.staff.is_minor && (
                          <span className="badge badge-warning" style={{ fontSize: '0.65rem' }}>
                            年少者
                          </span>
                        )}
                      </div>

                      <div style={{ textAlign: 'right' }}>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>適格スコア</span>
                        <div style={{ fontSize: '1.125rem', fontWeight: 800, color: '#6366f1' }}>
                          {cand.score} <span style={{ fontSize: '0.75rem', fontWeight: 500 }}>点</span>
                        </div>
                      </div>
                    </div>

                    {/* スコア理由リスト */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginBottom: '0.75rem' }}>
                      {cand.reasons.map((reason, rIdx) => (
                        <span
                          key={rIdx}
                          style={{
                            fontSize: '0.7rem',
                            padding: '0.15rem 0.4rem',
                            backgroundColor: '#ffffff',
                            border: '1px solid var(--border)',
                            borderRadius: '4px',
                            color: '#475569',
                          }}
                        >
                          {reason}
                        </span>
                      ))}
                    </div>

                    {/* アクションボタン */}
                    <button
                      type="button"
                      data-testid={`btn-copy-negotiation-${cand.staff.id}`}
                      onClick={() => handleCopyMessage(cand)}
                      className={`btn btn-sm ${isCopied ? 'btn-success' : 'btn-primary'}`}
                      style={{
                        width: '100%',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '0.4rem',
                        padding: '0.5rem',
                        fontWeight: 700,
                      }}
                    >
                      <span>{isCopied ? '✓ LINE文面をコピーしました！' : '💬 お願いLINE文面をコピー'}</span>
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* フッター */}
        <div
          style={{
            padding: '0.75rem 1.5rem',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'flex-end',
            backgroundColor: 'var(--surface)',
          }}
        >
          <button type="button" onClick={onClose} className="btn btn-secondary btn-sm">
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
};
