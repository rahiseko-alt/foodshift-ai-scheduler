'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { AvailabilityStatus, ShiftOptimizeRequest, ShiftOptimizeResponse } from '@/lib/types';
import { loadSavedRequest, loadSavedResponse, saveRequest } from '@/lib/storage';

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

  return (
    <main
      className="container"
      style={{ maxWidth: '480px', padding: '1rem', minHeight: '100dvh' }}
    >
      <header style={{ marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 700 }}>📱 シフト希望提出</h1>
          <Link href="/admin" style={{ fontSize: '0.8125rem', color: 'var(--primary)' }}>
            管理者画面へ
          </Link>
        </div>
        <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
          期間: {requestData.period.start_date} から {days}日間
        </p>
      </header>

      {/* スタッフ選択 */}
      <div className="card" style={{ marginBottom: '1.25rem' }}>
        <label
          htmlFor="staff-select"
          style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.5rem' }}
        >
          あなたの名前を選択してください
        </label>
        <select
          id="staff-select"
          data-testid="select-staff"
          value={selectedStaffId}
          onChange={(e) => setSelectedStaffId(e.target.value)}
          style={{
            width: '100%',
            padding: '0.625rem',
            fontSize: '1rem',
            borderRadius: '6px',
            border: '1px solid var(--border-dark)',
            minHeight: '44px',
          }}
        >
          {requestData.staff_members.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} {s.is_minor ? '(18歳未満)' : ''}
            </option>
          ))}
        </select>
      </div>

      {/* 希望入力カレンダー (スマホ用) */}
      <form onSubmit={handleSubmit}>
        <div className="card" style={{ marginBottom: '1.25rem', padding: '0.75rem' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '0.75rem',
              fontSize: '0.8125rem',
              color: 'var(--text-muted)',
            }}
          >
            <span>マスをタップして切替:</span>
            <span>
              <strong style={{ color: 'var(--success)' }}>◎ 希望</strong> /{' '}
              <strong style={{ color: 'var(--danger)' }}>✕ 不可</strong> / － 通常
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {Array.from({ length: days }, (_, d) => (
              <div
                key={d}
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                  padding: '0.5rem',
                  backgroundColor: '#ffffff',
                }}
              >
                <div style={{ fontSize: '0.8125rem', fontWeight: 600, marginBottom: '0.375rem' }}>
                  Day {d + 1}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.375rem' }}>
                  {shifts.map((s) => {
                    const isMinorLate = currentStaff?.is_minor && (s.is_late_night || s.id === 'late_night');
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
                          minHeight: '44px',
                          padding: '0.25rem',
                          borderRadius: '4px',
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
                              ? '#f1f5f9'
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
                        }}
                      >
                        <div>{s.name}</div>
                        <div>
                          {isMinorLate
                            ? '深夜禁止'
                            : status === 'want'
                            ? '◎ 希望'
                            : status === 'unavailable'
                            ? '✕ 不可'
                            : '－'}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        <button
          type="submit"
          className="btn btn-primary"
          data-testid="btn-submit-availability"
          style={{ width: '100%', fontSize: '1rem' }}
        >
          シフト希望を提出する
        </button>

        {submitted && (
          <div
            data-testid="submit-success-banner"
            style={{
              marginTop: '1rem',
              padding: '0.75rem',
              backgroundColor: 'var(--success-bg)',
              color: 'var(--success)',
              borderRadius: '6px',
              textAlign: 'center',
              fontWeight: 600,
            }}
          >
            ✓ 希望を保存しました！
          </div>
        )}
      </form>

      {/* 確定シフト確認エリア */}
      {response && (
        <div className="card" style={{ marginTop: '1.5rem' }} data-testid="confirmed-shift-section">
          <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.75rem' }}>
            📅 あなたの確定シフト ({currentStaff?.name})
          </h2>
          {myConfirmedShifts.length === 0 ? (
            <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
              現在確定している出勤シフトはありません。
            </p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0 }}>
              {myConfirmedShifts.map((slot) => {
                const shiftObj = shifts.find((s) => s.id === slot.shift_id);
                const assigned = slot.assigned_staff.find((st) => st.id === selectedStaffId);

                return (
                  <li
                    key={`${slot.date}_${slot.shift_id}`}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '0.5rem 0',
                      borderBottom: '1px solid var(--border)',
                      fontSize: '0.875rem',
                    }}
                  >
                    <span>
                      📅 {slot.date} ({shiftObj?.name} {shiftObj?.start}-{shiftObj?.end})
                    </span>
                    <span
                      style={{
                        padding: '0.125rem 0.5rem',
                        borderRadius: '4px',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        backgroundColor: assigned?.is_want_fulfilled ? 'var(--success-bg)' : 'var(--warning-bg)',
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
