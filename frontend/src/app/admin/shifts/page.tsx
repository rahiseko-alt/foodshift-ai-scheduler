'use client';

import React, { useEffect, useState } from 'react';
import { AdminNavbar } from '@/components/navigation/AdminNavbar';
import { Shift, ShiftOptimizeRequest } from '@/lib/types';
import { DEMO_IZAKAYA_DATA } from '@/lib/mock-data';
import { loadSavedRequest, saveRequest } from '@/lib/storage';
import { getDateInfo } from '@/lib/date-utils';
import {
  normalizeNumberInput,
  checkTotalRequiredStaff,
  checkMissingRequiredRoles,
} from '@/lib/validation';

export default function ShiftsAdminPage() {
  const [requestData, setRequestData] = useState<ShiftOptimizeRequest>(DEMO_IZAKAYA_DATA);
  const [activeTab, setActiveTab] = useState<'slots' | 'requirements'>('slots');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // シフト枠追加・編集モーダル
  const [isSlotModalOpen, setIsSlotModalOpen] = useState(false);
  const [editingSlot, setEditingSlot] = useState<Shift | null>(null);
  const [slotId, setSlotId] = useState('');
  const [slotName, setSlotName] = useState('');
  const [slotStart, setSlotStart] = useState('10:00');
  const [slotEnd, setSlotEnd] = useState('15:00');
  const [slotHoursInput, setSlotHoursInput] = useState('5.0');
  const [slotBreakMinInput, setSlotBreakMinInput] = useState('0');
  const [slotIsLate, setSlotIsLate] = useState(false);
  const [slotError, setSlotError] = useState<string | null>(null);

  useEffect(() => {
    const saved = loadSavedRequest();
    setRequestData(saved);
  }, []);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // 15分刻みスナップヘルパー
  const snapTo15Min = (timeStr: string): string => {
    const [hStr, mStr] = timeStr.split(':');
    const h = parseInt(hStr, 10) || 0;
    const m = parseInt(mStr, 10) || 0;
    const snappedM = Math.round(m / 15) * 15;
    let finalH = h;
    let finalM = snappedM;
    if (snappedM === 60) {
      finalH = (h + 1) % 24;
      finalM = 0;
    }
    return `${String(finalH).padStart(2, '0')}:${String(finalM).padStart(2, '0')}`;
  };

  // 時刻から時間数を15分精度(0.25h)で自動計算 & 労基法休憩・深夜自動サジェスト
  const updateTimes = (start: string, end: string) => {
    const snappedStart = snapTo15Min(start);
    const snappedEnd = snapTo15Min(end);
    setSlotStart(snappedStart);
    setSlotEnd(snappedEnd);

    const [sH, sM] = snappedStart.split(':').map(Number);
    const [eH, eM] = snappedEnd.split(':').map(Number);
    let sMin = sH * 60 + (sM || 0);
    let eMin = eH * 60 + (eM || 0);
    if (eMin <= sMin) eMin += 24 * 60;
    const diffHours = (eMin - sMin) / 60;
    const roundedHours = Math.round(diffHours * 4) / 4;
    setSlotHoursInput(String(roundedHours));

    // 労基法第34条 休憩時間自動サジェスト
    if (roundedHours > 8.0) {
      setSlotBreakMinInput('60');
    } else if (roundedHours > 6.0) {
      setSlotBreakMinInput('45');
    }

    // 深夜自動判定 (22:00超または05:00前)
    const isLate = eMin > 22 * 60 || sMin < 5 * 60;
    setSlotIsLate(isLate);
  };

  const handleOpenAddSlot = () => {
    setEditingSlot(null);
    setSlotId(`shift_${Date.now().toString().slice(-4)}`);
    setSlotName('');
    updateTimes('11:00', '16:00');
    setSlotBreakMinInput('0');
    setSlotError(null);
    setIsSlotModalOpen(true);
  };

  const handleOpenEditSlot = (slot: Shift) => {
    setEditingSlot(slot);
    setSlotId(slot.id);
    setSlotName(slot.name);
    setSlotStart(slot.start);
    setSlotEnd(slot.end);
    setSlotHoursInput(String(slot.hours));
    setSlotBreakMinInput(String(slot.break_minutes || 0));
    setSlotIsLate(slot.is_late_night);
    setSlotError(null);
    setIsSlotModalOpen(true);
  };

  const handleDeleteSlot = (shiftId: string) => {
    if (requestData.shifts.length <= 1) {
      alert('シフト枠は最低1つ必要です。');
      return;
    }
    const target = requestData.shifts.find((s) => s.id === shiftId);
    if (!target) return;
    if (!window.confirm(`【確認】シフト枠「${target.name}」を削除しますか？\n（関連する日別必要人数データもすべて削除されます。この操作は取り消せません）`)) return;

    const updatedShifts = requestData.shifts.filter((s) => s.id !== shiftId);
    const updatedReqs = requestData.requirements.filter((r) => r.shift_id !== shiftId);
    const updatedAvail = requestData.availabilities.filter((a) => a.shift_id !== shiftId);

    const updatedData: ShiftOptimizeRequest = {
      ...requestData,
      shifts: updatedShifts,
      requirements: updatedReqs,
      availabilities: updatedAvail,
    };

    setRequestData(updatedData);
    saveRequest(updatedData);
    showToast(`シフト枠「${target.name}」を削除しました`);
  };

  // 破壊的操作: 全要件クリア (No. 226)
  const handleResetAllRequirements = () => {
    if (!window.confirm('【警告】すべての必要人数設定を「0名」にクリアしますか？\n（最適化を行うには再度必要人数を入力する必要があります）')) return;

    const updatedReqs = requestData.requirements.map((req) => ({
      ...req,
      min_staff: 0,
      required_roles: {},
    }));

    const updatedData: ShiftOptimizeRequest = {
      ...requestData,
      requirements: updatedReqs,
    };

    setRequestData(updatedData);
    saveRequest(updatedData);
    showToast('必要人数設定をすべて0名にリセットしました');
  };

  // 破壊的操作: 全シフト設定を初期プリセットへ完全復元
  const handleResetToPreset = () => {
    if (!window.confirm('【確認】シフト枠および必要人数を初期デモ設定に復元しますか？')) return;
    const updatedData: ShiftOptimizeRequest = {
      ...requestData,
      shifts: DEMO_IZAKAYA_DATA.shifts,
      requirements: DEMO_IZAKAYA_DATA.requirements,
    };
    setRequestData(updatedData);
    saveRequest(updatedData);
    showToast('初期シフト設定に復元しました');
  };

  const handleSaveSlot = (e: React.FormEvent) => {
    e.preventDefault();
    if (!slotName.trim()) {
      setSlotError('シフト枠名を入力してください');
      return;
    }

    const hours = normalizeNumberInput(slotHoursInput, 0);
    if (hours < 0.25 || hours > 24) {
      setSlotError('拘束時間は 0.25時間（15分）〜 24時間の範囲で入力してください');
      return;
    }

    const breakMin = normalizeNumberInput(slotBreakMinInput, 0);

    // 労基法第34条 休憩時間バリデーション (No. 268)
    if (hours > 8.0 && breakMin < 60) {
      setSlotError('【労基法第34条違反】8時間を超えるシフトには60分以上の休憩設定が必要です。');
      return;
    } else if (hours > 6.0 && breakMin < 45) {
      setSlotError('【労基法第34条違反】6時間を超えるシフトには45分以上の休憩設定が必要です。');
      return;
    }

    const newSlot: Shift = {
      id: slotId,
      name: slotName.trim(),
      start: slotStart,
      end: slotEnd,
      hours,
      break_minutes: breakMin,
      is_late_night: slotIsLate,
      min_interval_hours: 11,
    };

    let updatedShifts: Shift[];
    let updatedRequirements = [...requestData.requirements];

    if (editingSlot) {
      updatedShifts = requestData.shifts.map((s) => (s.id === editingSlot.id ? newSlot : s));
    } else {
      updatedShifts = [...requestData.shifts, newSlot];
      // 新規枠のデフォルト必要人数(2名)を全日数に追加
      for (let d = 0; d < requestData.period.days; d++) {
        updatedRequirements.push({
          day_offset: d,
          shift_id: newSlot.id,
          min_staff: 2,
          required_roles: {},
        });
      }
    }

    const updatedData: ShiftOptimizeRequest = {
      ...requestData,
      shifts: updatedShifts,
      requirements: updatedRequirements,
    };

    setRequestData(updatedData);
    saveRequest(updatedData);
    setIsSlotModalOpen(false);
    showToast(editingSlot ? `シフト枠「${slotName}」を更新しました` : `新規枠「${slotName}」を追加しました`);
  };

  // 必要人数変更ハンドラ (全角対応)
  const handleRequirementChange = (
    day_offset: number,
    shift_id: string,
    field: 'min_staff' | 'kitchen_leader' | 'hall_leader' | 'kitchen' | 'hall',
    value: number | string
  ) => {
    const numValue = typeof value === 'string' ? normalizeNumberInput(value, 0) : value;

    const updatedReqs = requestData.requirements.map((req) => {
      if (req.day_offset === day_offset && req.shift_id === shift_id) {
        if (field === 'min_staff') {
          return { ...req, min_staff: Math.min(50, Math.max(0, numValue)) };
        } else {
          const currentRoles = { ...req.required_roles };
          if (numValue > 0) {
            currentRoles[field] = numValue;
          } else {
            delete currentRoles[field];
          }
          return { ...req, required_roles: currentRoles };
        }
      }
      return req;
    });

    const updatedData: ShiftOptimizeRequest = {
      ...requestData,
      requirements: updatedReqs,
    };
    setRequestData(updatedData);
    saveRequest(updatedData);
  };

  // 一括設定プリセット適用
  const handleApplyBulkPattern = (type: 'weekday_weekend' | 'busy_weekend' | 'flat_two') => {
    const updatedReqs = requestData.requirements.map((req) => {
      const dateInfo = getDateInfo(requestData.period.start_date, req.day_offset);
      const isWeekend = dateInfo.isSaturday || dateInfo.isSunday;

      if (type === 'busy_weekend') {
        if (req.shift_id === 'dinner') {
          return {
            ...req,
            min_staff: isWeekend ? 4 : 3,
            required_roles: { kitchen_leader: 1, hall: 1 },
          };
        }
      } else if (type === 'flat_two') {
        return {
          ...req,
          min_staff: 2,
          required_roles: {},
        };
      }
      return req;
    });

    const updatedData: ShiftOptimizeRequest = {
      ...requestData,
      requirements: updatedReqs,
    };
    setRequestData(updatedData);
    saveRequest(updatedData);
    showToast('一括パターンを適用しました');
  };

  // バリデーションチェック (No. 201, 208)
  const reqTotalCheck = checkTotalRequiredStaff(requestData.requirements);
  const roleCheck = checkMissingRequiredRoles(requestData.requirements, requestData.staff_members);

  return (
    <main className="container" style={{ paddingBottom: '3rem' }}>
      <AdminNavbar />

      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem',
          marginBottom: '1.25rem',
        }}
      >
        <div>
          <h1 style={{ fontSize: '1.375rem', fontWeight: 700 }}>
            シフト枠 ＆ 必要人数管理
          </h1>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
            シフト時間帯・休憩設定・曜日別の必要人数 ＆ 必須ロール配置
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            onClick={() => setActiveTab('slots')}
            className={`btn btn-sm ${activeTab === 'slots' ? 'btn-primary' : 'btn-secondary'}`}
          >
            シフト時間帯設定
          </button>
          <button
            onClick={() => setActiveTab('requirements')}
            className={`btn btn-sm ${activeTab === 'requirements' ? 'btn-primary' : 'btn-secondary'}`}
          >
            日別必要人数マトリクス
          </button>
        </div>
      </header>

      {/* No. 201: 合計必要人数0名警告バナー */}
      {reqTotalCheck.isZero && (
        <div
          style={{
            backgroundColor: 'var(--danger-bg)',
            color: 'var(--danger)',
            border: '1px solid var(--danger-border)',
            padding: '0.75rem 1rem',
            borderRadius: 'var(--radius-sm)',
            marginBottom: '1rem',
            fontWeight: 700,
            fontSize: '0.875rem',
          }}
        >
          {reqTotalCheck.warning}
        </div>
      )}

      {/* No. 208: 必須ロール保有者0名警告バナー */}
      {roleCheck.warnings.length > 0 && (
        <div
          style={{
            backgroundColor: 'var(--warning-bg)',
            color: '#854d0e',
            border: '1px solid var(--warning-border)',
            padding: '0.75rem 1rem',
            borderRadius: 'var(--radius-sm)',
            marginBottom: '1rem',
            fontSize: '0.8125rem',
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: '0.25rem' }}>必須資格ロールの不足警告:</div>
          <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
            {roleCheck.warnings.map((warn, i) => (
              <li key={i}>{warn}</li>
            ))}
          </ul>
        </div>
      )}

      {toastMessage && (
        <div
          style={{
            backgroundColor: 'var(--success-bg)',
            color: 'var(--success)',
            border: '1px solid var(--success-border)',
            padding: '0.75rem 1rem',
            borderRadius: 'var(--radius-sm)',
            marginBottom: '1rem',
            fontWeight: 600,
            fontSize: '0.875rem',
          }}
        >
          {toastMessage}
        </div>
      )}

      {/* タブ1: シフト枠マスタ管理 */}
      {activeTab === 'slots' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button onClick={handleResetToPreset} className="btn btn-secondary btn-sm">
                ↺ 初期シフト枠に復元
              </button>
            </div>
            <button onClick={handleOpenAddSlot} className="btn btn-primary btn-sm" data-testid="btn-add-shift-slot">
              ＋ 新しいシフト枠を追加
            </button>
          </div>

          <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
            <table className="modern-table">
              <thead>
                <tr>
                  <th>シフト枠名 / ID</th>
                  <th>勤務時間帯</th>
                  <th>総拘束 / 実働時間</th>
                  <th>休憩時間</th>
                  <th>深夜割増 (22時以降)</th>
                  <th style={{ textAlign: 'right' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {requestData.shifts.map((slot) => {
                  const breakHours = (slot.break_minutes || 0) / 60;
                  const actualWork = Math.max(0, slot.hours - breakHours);
                  return (
                    <tr key={slot.id} data-testid={`slot-item-${slot.id}`}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{slot.name}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>ID: {slot.id}</div>
                      </td>
                      <td>
                        <span className="badge badge-primary">
                          {slot.start} 〜 {slot.end}
                        </span>
                      </td>
                      <td>
                        <div>
                          <strong>{actualWork}時間</strong> 実働
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          拘束: {slot.hours}時間
                        </div>
                      </td>
                      <td>
                        {slot.break_minutes ? (
                          <span className="badge badge-warning">{slot.break_minutes}分 休憩</span>
                        ) : (
                          <span style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>なし (0分)</span>
                        )}
                      </td>
                      <td>
                        {slot.is_late_night ? (
                          <span className="badge badge-danger">22時以降あり (18歳未満不可)</span>
                        ) : (
                          <span className="badge badge-muted">なし (全年齢対象)</span>
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: '0.25rem' }}>
                          <button
                            onClick={() => handleOpenEditSlot(slot)}
                            className="btn btn-secondary btn-sm"
                            data-testid={`btn-edit-slot-${slot.id}`}
                          >
                            編集
                          </button>
                          <button
                            onClick={() => handleDeleteSlot(slot.id)}
                            className="btn btn-danger btn-sm"
                            data-testid={`btn-delete-slot-${slot.id}`}
                          >
                            削除
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* タブ2: 日別必要人数マトリクス */}
      {activeTab === 'requirements' && (
        <div>
          {/* クイック適用ツールバー */}
          <div
            className="card"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '0.75rem',
              marginBottom: '1rem',
              padding: '0.75rem 1rem',
            }}
          >
            <div style={{ fontSize: '0.875rem', fontWeight: 600 }}>
              ワンクリック一括パターン適用:
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button
                onClick={() => handleApplyBulkPattern('busy_weekend')}
                className="btn btn-secondary btn-sm"
              >
                週末ディナー増員 (平日3名 / 金土日4名)
              </button>
              <button
                onClick={() => handleApplyBulkPattern('flat_two')}
                className="btn btn-secondary btn-sm"
              >
                全枠一律2名設定
              </button>
              <button
                onClick={handleResetAllRequirements}
                className="btn btn-danger btn-sm"
                style={{ fontSize: '0.75rem' }}
              >
                全日0名クリア (全休)
              </button>
            </div>
          </div>

          <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
            <table className="modern-table" style={{ minWidth: '900px' }}>
              <thead>
                <tr>
                  <th style={{ width: '130px', position: 'sticky', left: 0, backgroundColor: '#f8fafc', zIndex: 2 }}>
                    日付・曜日
                  </th>
                  {requestData.shifts.map((s) => (
                    <th key={s.id} style={{ minWidth: '220px', borderLeft: '1px solid var(--border)' }}>
                      <div>{s.name}</div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                        {s.start}-{s.end}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: requestData.period.days }, (_, d) => {
                  const dateInfo = getDateInfo(requestData.period.start_date, d);
                  return (
                    <tr key={d}>
                      <td
                        style={{
                          position: 'sticky',
                          left: 0,
                          backgroundColor: '#ffffff',
                          zIndex: 1,
                          fontWeight: 600,
                          borderRight: '1px solid var(--border)',
                          color: dateInfo.isSunday
                            ? 'var(--danger)'
                            : dateInfo.isSaturday
                            ? 'var(--primary)'
                            : 'var(--text-main)',
                        }}
                      >
                        <div>{dateInfo.dateFormatted}</div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Day {d + 1}</div>
                      </td>

                      {requestData.shifts.map((s) => {
                        const req = requestData.requirements.find(
                          (r) => r.day_offset === d && r.shift_id === s.id
                        );
                        const minStaff = req ? req.min_staff : 0;
                        const kitchenLeaderRequired = req?.required_roles?.kitchen_leader || 0;
                        const hallRequired = req?.required_roles?.hall || 0;

                        return (
                          <td
                            key={s.id}
                            style={{
                              borderLeft: '1px solid var(--border)',
                              padding: '0.5rem',
                              backgroundColor: minStaff === 0 ? '#fbfcfe' : dateInfo.isSunday || dateInfo.isSaturday ? '#fdfcfe' : '#ffffff',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}>
                              <label style={{ fontSize: '0.75rem', fontWeight: 600 }}>必要人数:</label>
                              <input
                                type="text"
                                value={minStaff}
                                onChange={(e) =>
                                  handleRequirementChange(d, s.id, 'min_staff', e.target.value)
                                }
                                style={{
                                  width: '56px',
                                  padding: '0.2rem 0.4rem',
                                  fontSize: '0.8125rem',
                                  border: '1px solid var(--border-dark)',
                                  borderRadius: '4px',
                                  fontWeight: 700,
                                  textAlign: 'center',
                                }}
                              />
                              <span style={{ fontSize: '0.75rem' }}>名</span>
                            </div>

                            {/* 必須ロール設定 */}
                            <div style={{ fontSize: '0.7rem', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                              <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                <input
                                  type="checkbox"
                                  checked={kitchenLeaderRequired > 0}
                                  onChange={(e) =>
                                    handleRequirementChange(
                                      d,
                                      s.id,
                                      'kitchen_leader',
                                      e.target.checked ? 1 : 0
                                    )
                                  }
                                />
                                <span>厨房責任者 (1名必須)</span>
                              </label>
                              <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                <input
                                  type="checkbox"
                                  checked={hallRequired > 0}
                                  onChange={(e) =>
                                    handleRequirementChange(
                                      d,
                                      s.id,
                                      'hall',
                                      e.target.checked ? 1 : 0
                                    )
                                  }
                                />
                                <span>ホールスタッフ (1名必須)</span>
                              </label>
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* シフト枠編集・追加モーダル */}
      {isSlotModalOpen && (
        <div className="modal-overlay" onClick={() => setIsSlotModalOpen(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <h2 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem' }}>
              {editingSlot ? `シフト枠編集: ${editingSlot.name}` : '新規シフト枠の追加'}
            </h2>

            {slotError && (
              <div
                style={{
                  backgroundColor: 'var(--danger-bg)',
                  color: 'var(--danger)',
                  border: '1px solid var(--danger-border)',
                  padding: '0.5rem 0.75rem',
                  borderRadius: 'var(--radius-sm)',
                  marginBottom: '1rem',
                  fontSize: '0.8125rem',
                }}
              >
                {slotError}
              </div>
            )}

            <form onSubmit={handleSaveSlot}>
              <div className="form-group">
                <label className="form-label">シフト枠識別ID (半角英数字)</label>
                <input
                  type="text"
                  className="form-input"
                  value={slotId}
                  onChange={(e) => setSlotId(e.target.value)}
                  disabled={Boolean(editingSlot)}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">表示名称 (例: 仕込み・ランチ)</label>
                <input
                  type="text"
                  className="form-input"
                  value={slotName}
                  onChange={(e) => setSlotName(e.target.value)}
                  placeholder="例: 深夜クローズ作業"
                  data-testid="input-slot-name"
                  required
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div className="form-group">
                  <label className="form-label">開始時刻 (HH:MM)</label>
                  <input
                    type="time"
                    className="form-input"
                    value={slotStart}
                    onChange={(e) => updateTimes(e.target.value, slotEnd)}
                    data-testid="input-slot-start"
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">終了時刻 (HH:MM)</label>
                  <input
                    type="time"
                    className="form-input"
                    value={slotEnd}
                    onChange={(e) => updateTimes(slotStart, e.target.value)}
                    data-testid="input-slot-end"
                    required
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div className="form-group">
                  <label className="form-label">総拘束時間 (時間)</label>
                  <input
                    type="text"
                    className="form-input"
                    value={slotHoursInput}
                    onChange={(e) => setSlotHoursInput(e.target.value)}
                    data-testid="input-slot-hours"
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">休憩時間 (分)</label>
                  <input
                    type="text"
                    className="form-input"
                    value={slotBreakMinInput}
                    onChange={(e) => setSlotBreakMinInput(e.target.value)}
                  />
                </div>
              </div>

              <div className="form-group">
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    fontSize: '0.875rem',
                    cursor: 'pointer',
                    padding: '0.5rem',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: slotIsLate ? 'var(--danger-bg)' : '#f8fafc',
                    border: '1px solid',
                    borderColor: slotIsLate ? 'var(--danger-border)' : 'var(--border)',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={slotIsLate}
                    onChange={(e) => setSlotIsLate(e.target.checked)}
                    style={{ width: '18px', height: '18px' }}
                  />
                  <span>
                    <strong>22:00以降の深夜シフト</strong>（満18歳未満の割当を自動的に禁止します）
                  </span>
                </label>
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: '0.75rem',
                  marginTop: '1.25rem',
                  paddingTop: '1rem',
                  borderTop: '1px solid var(--border)',
                }}
              >
                <button
                  type="button"
                  onClick={() => setIsSlotModalOpen(false)}
                  className="btn btn-secondary"
                >
                  キャンセル
                </button>
                <button type="submit" className="btn btn-primary" data-testid="btn-save-slot">
                  {editingSlot ? '変更を保存' : 'シフト枠を追加'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
