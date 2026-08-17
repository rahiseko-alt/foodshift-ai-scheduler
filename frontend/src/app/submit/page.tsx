'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { AvailabilityStatus, ShiftOptimizeRequest, ShiftOptimizeResponse } from '@/lib/types';
import { loadSavedRequest, loadSavedResponse, saveRequest } from '@/lib/storage';
import { getDateInfo } from '@/lib/date-utils';
import { OfflineBanner } from '@/components/navigation/OfflineBanner';
import { encodeSubmissionCode } from '@/lib/line-codec';

export default function SubmitPage() {
  const [requestData, setRequestData] = useState<ShiftOptimizeRequest | null>(null);
  const [response, setResponse] = useState<ShiftOptimizeResponse | null>(null);
  const [selectedStaffId, setSelectedStaffId] = useState<string>('');
  const [availabilities, setAvailabilities] = useState<Record<string, AvailabilityStatus>>({});
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    const req = loadSavedRequest();
    setRequestData(req);
    if (req.staff_members.length > 0) {
      setSelectedStaffId(req.staff_members[0].id);
    }
    const res = loadSavedResponse();
    setResponse(res);
  }, []);

  // スタッフ切り替え時に既存の希望データを読み込み
  useEffect(() => {
    if (!requestData || !selectedStaffId) return;
    const initialMap: Record<string, AvailabilityStatus> = {};
    for (const a of requestData.availabilities) {
      if (a.staff_id === selectedStaffId) {
        initialMap[`${a.day_offset}_${a.shift_id}`] = a.status;
      }
    }
    setAvailabilities(initialMap);
  }, [selectedStaffId, requestData]);

  if (!requestData) return null;

  const currentStaff = requestData.staff_members.find((s) => s.id === selectedStaffId);
  const days = Math.min(7, requestData.period.days); // スマホでは直近7日間を表示
  const shifts = requestData.shifts;

  // タップでステータス切り替え: available (空) -> want (◎) -> unavailable (✕) -> available
  const handleToggleStatus = (day_offset: number, shift_id: string) => {
    const key = `${day_offset}_${shift_id}`;
    const current = availabilities[key] || 'available';
    let next: AvailabilityStatus = 'want';
    if (current === 'want') next = 'unavailable';
    else if (current === 'unavailable') next = 'available';

    setAvailabilities((prev) => ({
      ...prev,
      [key]: next,
    }));
    setSubmitted(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStaffId) return;

    // requestData の availabilities を更新して保存
    const otherStaffAvail = requestData.availabilities.filter(
      (a) => a.staff_id !== selectedStaffId
    );

    const newStaffAvail = Object.entries(availabilities).map(([key, status]) => {
      const [dStr, shiftId] = key.split('_');
      return {
        staff_id: selectedStaffId,
        day_offset: parseInt(dStr, 10),
        shift_id: shiftId,
        status,
      };
    });

    const updatedRequest: ShiftOptimizeRequest = {
      ...requestData,
      availabilities: [...otherStaffAvail, ...newStaffAvail],
    };

    setRequestData(updatedRequest);
    saveRequest(updatedRequest);
    setSubmitted(true);
  };

  // 自分の確定シフト一覧を取得
  const myConfirmedShifts = response
    ? response.schedule.filter((slot) =>
        slot.assigned_staff.some((s) => s.id === selectedStaffId)
      )
    : [];

  // 年収の壁計算
  const ytd = currentStaff?.annual_earnings_ytd || 0;
  const taxWall = currentStaff?.tax_wall;
  const remainingBudget = taxWall ? Math.max(0, taxWall - ytd) : 0;
  const progressPercent = taxWall ? Math.min(100, Math.round((ytd / taxWall) * 100)) : 0;

  return (
    <main
      className="container"
      style={{ maxWidth: '520px', padding: '1rem 0.75rem', minHeight: '100dvh' }}
    >
      <OfflineBanner />

      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '1rem',
          paddingBottom: '0.75rem',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 700 }}>📱 シフト希望提出</h1>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            期間: {requestData.period.start_date} から {days}日間
          </p>
        </div>
        <Link
          href="/admin"
          className="btn btn-secondary btn-sm"
          style={{ fontSize: '0.75rem' }}
        >
          🏢 店長画面へ
        </Link>
      </header>

      {/* スタッフ選択 */}
      <div className="card" style={{ marginBottom: '1rem', padding: '1rem' }}>
        <label
          htmlFor="staff-select"
          style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, marginBottom: '0.4rem' }}
        >
          あなたの名前を選択してください
        </label>
        <select
          id="staff-select"
          data-testid="select-staff"
          value={selectedStaffId}
          onChange={(e) => setSelectedStaffId(e.target.value)}
          className="form-select"
          style={{ fontSize: '0.9375rem', minHeight: '44px', fontWeight: 600 }}
        >
          {requestData.staff_members.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} {s.is_minor ? '(18歳未満)' : ''}
            </option>
          ))}
        </select>

        {/* 年収の壁（103万/130万）インジケーター */}
        {taxWall && (
          <div
            style={{
              marginTop: '0.75rem',
              padding: '0.625rem 0.75rem',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: '#f8fafc',
              border: '1px solid var(--border)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '0.75rem',
                marginBottom: '0.35rem',
              }}
            >
              <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>
                💰 年収の壁（{(taxWall / 10000).toFixed(0)}万円）管理
              </span>
              <span style={{ color: progressPercent > 90 ? 'var(--danger)' : 'var(--text-muted)' }}>
                残り ¥{remainingBudget.toLocaleString()} ({progressPercent}%)
              </span>
            </div>

            {/* プログレスバー */}
            <div
              style={{
                height: '8px',
                backgroundColor: '#e2e8f0',
                borderRadius: '9999px',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${progressPercent}%`,
                  backgroundColor:
                    progressPercent > 90
                      ? 'var(--danger)'
                      : progressPercent > 75
                      ? 'var(--warning)'
                      : 'var(--success)',
                  borderRadius: '9999px',
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
              累計: ¥{ytd.toLocaleString()} / 上限: ¥{taxWall.toLocaleString()}
            </div>
          </div>
        )}
      </div>

      {/* 希望入力カレンダー (スマホ用: 30タップ以内完結) */}
      <form onSubmit={handleSubmit}>
        <div className="card" style={{ marginBottom: '1rem', padding: '0.75rem' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '0.75rem',
              fontSize: '0.75rem',
              color: 'var(--text-muted)',
              borderBottom: '1px solid var(--border)',
              paddingBottom: '0.5rem',
            }}
          >
            <span>枠タップで切替:</span>
            <span>
              <strong style={{ color: 'var(--success)' }}>◎ 希望</strong> /{' '}
              <strong style={{ color: 'var(--danger)' }}>✕ 不可</strong> / － 通常
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {Array.from({ length: days }, (_, d) => {
              const dateInfo = getDateInfo(requestData.period.start_date, d);
              const headerColor = dateInfo.isSunday
                ? 'var(--danger)'
                : dateInfo.isSaturday
                ? 'var(--primary)'
                : 'var(--text-main)';

              return (
                <div
                  key={d}
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '0.5rem',
                    backgroundColor: dateInfo.isSunday || dateInfo.isSaturday ? '#fbfcfe' : '#ffffff',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      fontSize: '0.8125rem',
                      fontWeight: 700,
                      marginBottom: '0.35rem',
                      color: headerColor,
                    }}
                  >
                    <span>📅 {dateInfo.dateFormatted}</span>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 'normal' }}>
                      Day {d + 1}
                    </span>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: `repeat(${shifts.length}, 1fr)`, gap: '0.35rem' }}>
                    {shifts.map((s) => {
                      const isEndLate = (() => {
                        const [h, m] = (s.end || '00:00').split(':').map(Number);
                        const [sH] = (s.start || '00:00').split(':').map(Number);
                        return (h === 22 && (m || 0) > 0) || h > 22 || h < 5 || sH < 5;
                      })();
                      const isMinorLate = Boolean(currentStaff?.is_minor && (s.is_late_night || isEndLate));
                      const key = `${d}_${s.id}`;
                      const status = availabilities[key] || 'available';

                      return (
                        <button
                          type="button"
                          key={s.id}
                          disabled={isMinorLate}
                          onClick={() => handleToggleStatus(d, s.id)}
                          data-testid={`btn-slot-${d}-${s.id}`}
                          style={{
                            minHeight: '48px',
                            padding: '0.35rem 0.2rem',
                            borderRadius: 'var(--radius-sm)',
                            border: '1px solid',
                            borderColor:
                              status === 'want'
                                ? 'var(--success)'
                                : status === 'unavailable'
                                ? 'var(--danger)'
                                : 'var(--border)',
                            backgroundColor:
                              status === 'want'
                                ? 'var(--success-bg)'
                                : status === 'unavailable'
                                ? 'var(--danger-bg)'
                                : isMinorLate
                                ? '#f8fafc'
                                : '#ffffff',
                            color:
                              status === 'want'
                                ? 'var(--success)'
                                : status === 'unavailable'
                                ? 'var(--danger)'
                                : isMinorLate
                                ? '#94a3b8'
                                : 'var(--text-main)',
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            cursor: isMinorLate ? 'not-allowed' : 'pointer',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            lineHeight: 1.2,
                          }}
                        >
                          <div style={{ fontSize: '0.7rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>
                            {s.name}
                          </div>
                          <div style={{ fontSize: '0.625rem', color: 'var(--text-muted)', marginBottom: '2px' }}>
                            {s.start}-{s.end}
                          </div>
                          <div style={{ fontWeight: 700 }}>
                            {isMinorLate
                              ? '🈲 深夜禁止'
                              : status === 'want'
                              ? '◎ 希望'
                              : status === 'unavailable'
                              ? '✕ 不可'
                              : '－ 通常'}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <button
          type="submit"
          className="btn btn-primary"
          data-testid="btn-submit-availability"
          style={{ width: '100%', fontSize: '1rem', minHeight: '46px' }}
        >
          シフト希望を提出する
        </button>

        {submitted && (
          <div
            data-testid="submit-success-banner"
            style={{
              marginTop: '1rem',
              padding: '1rem',
              backgroundColor: 'var(--success-bg)',
              border: '1px solid var(--success-border)',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            <div style={{ textAlign: 'center', color: 'var(--success)', fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.75rem' }}>
              ✓ 希望を保存しました！
            </div>

            {/* LINE提出コード共有カード */}
            <div
              style={{
                backgroundColor: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                padding: '0.75rem',
              }}
            >
              <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
                💬 店舗LINEグループ提出用コード (店長へ共有)
              </div>
              <div
                style={{
                  fontFamily: 'monospace',
                  fontSize: '0.8125rem',
                  padding: '0.5rem',
                  backgroundColor: 'var(--surface-muted)',
                  borderRadius: '4px',
                  wordBreak: 'break-all',
                  userSelect: 'all',
                  marginBottom: '0.5rem',
                }}
              >
                {encodeSubmissionCode({
                  staff_id: selectedStaffId,
                  period_start: requestData.period.start_date,
                  days,
                  shift_ids: shifts.map((s) => s.id),
                  availabilities: Object.entries(availabilities).map(([key, status]) => {
                    const [dStr, shiftId] = key.split('_');
                    return {
                      staff_id: selectedStaffId,
                      day_offset: parseInt(dStr, 10),
                      shift_id: shiftId,
                      status,
                    };
                  }),
                })}
              </div>

              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  type="button"
                  data-testid="btn-copy-line-code"
                  onClick={async () => {
                    const code = encodeSubmissionCode({
                      staff_id: selectedStaffId,
                      period_start: requestData.period.start_date,
                      days,
                      shift_ids: shifts.map((s) => s.id),
                      availabilities: Object.entries(availabilities).map(([key, status]) => {
                        const [dStr, shiftId] = key.split('_');
                        return {
                          staff_id: selectedStaffId,
                          day_offset: parseInt(dStr, 10),
                          shift_id: shiftId,
                          status,
                        };
                      }),
                    });
                    const msg = `【FoodShift希望提出: ${currentStaff?.name}】\n期間: ${requestData.period.start_date}〜\n提出コード: ${code}`;
                    await navigator.clipboard.writeText(msg);
                    alert('LINE提出用テキストをコピーしました！店舗LINEに貼り付けて送信してください。');
                  }}
                  className="btn btn-primary btn-sm"
                  style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem' }}
                >
                  <span>📋 LINE提出テキストをコピー</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </form>

      {/* 確定シフト確認エリア */}
      {response && (
        <div className="card" style={{ marginTop: '1.25rem' }} data-testid="confirmed-shift-section">
          <h2 style={{ fontSize: '0.9375rem', fontWeight: 700, marginBottom: '0.75rem' }}>
            📅 あなたの確定シフト ({currentStaff?.name})
          </h2>
          {myConfirmedShifts.length === 0 ? (
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
              現在確定している出勤シフトはありません。
            </p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0 }}>
              {myConfirmedShifts.map((slot) => {
                const shiftObj = shifts.find((s) => s.id === slot.shift_id);
                const assigned = slot.assigned_staff.find((st) => st.id === selectedStaffId);
                const dateInfo = getDateInfo(requestData.period.start_date, slot.day_offset);

                return (
                  <li
                    key={`${slot.date}_${slot.shift_id}`}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '0.5rem 0',
                      borderBottom: '1px solid var(--border)',
                      fontSize: '0.8125rem',
                    }}
                  >
                    <span>
                      📅 <strong>{dateInfo.dateFormatted}</strong> ({shiftObj?.name}{' '}
                      {shiftObj?.start}-{shiftObj?.end})
                    </span>
                    <span
                      style={{
                        padding: '0.15rem 0.5rem',
                        borderRadius: '9999px',
                        fontSize: '0.7rem',
                        fontWeight: 600,
                        backgroundColor: assigned?.is_want_fulfilled
                          ? 'var(--success-bg)'
                          : 'var(--warning-bg)',
                        color: assigned?.is_want_fulfilled ? 'var(--success)' : '#854d0e',
                      }}
                    >
                      {assigned?.is_want_fulfilled ? '◎ 希望通り' : '◯ 割当'}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </main>
  );
}
