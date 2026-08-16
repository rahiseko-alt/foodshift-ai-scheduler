'use client';

import React, { useState } from 'react';
import {
  AssignedStaff,
  ScheduledShiftSlot,
  ShiftOptimizeRequest,
  ShiftOptimizeResponse,
  StaffMember,
} from '@/lib/types';
import { getDateInfo } from '@/lib/date-utils';
import { recalculateScheduleSummary } from '@/lib/schedule-calc';
import { saveResponse } from '@/lib/storage';
import { NegotiationModal } from './NegotiationModal';

interface Props {
  request: ShiftOptimizeRequest;
  response: ShiftOptimizeResponse | null;
  onResponseChange?: (updatedResponse: ShiftOptimizeResponse) => void;
  showToast?: (msg: string) => void;
}

interface CellClickState {
  dayOffset: number;
  shiftId: string;
  slotDate: string;
}

export const ShiftMatrix: React.FC<Props> = ({ request, response, onResponseChange, showToast }) => {
  const days = request.period.days;
  const staffList = request.staff_members;
  const shifts = request.shifts;

  // 手動編集モーダル用ステート
  const [activeCell, setActiveCell] = useState<CellClickState | null>(null);
  const [selectedStaffToAdd, setSelectedStaffToAdd] = useState<string>('');
  const [manualWarning, setManualWarning] = useState<string | null>(null);
  const [negotiationCell, setNegotiationCell] = useState<CellClickState | null>(null);

  // マップ作成: (staff_id, day_offset) -> 割当シフト情報
  const assignmentMap = new Map<
    string,
    { shiftName: string; isWant: boolean; shiftId: string; role: string }
  >();
  // 不足マップ: (day_offset, shift_id) -> shortage
  const shortageMap = new Map<string, { shortage: number; reason: string; required: number; assigned: number }>();

  if (response) {
    for (const slot of response.schedule) {
      const shiftObj = shifts.find((s) => s.id === slot.shift_id);
      const shiftName = shiftObj ? shiftObj.name : slot.shift_id;
      for (const st of slot.assigned_staff) {
        assignmentMap.set(`${st.id}_${slot.day_offset}`, {
          shiftName,
          isWant: st.is_want_fulfilled,
          shiftId: slot.shift_id,
          role: st.assigned_role,
        });
      }
    }

    for (const u of response.summary.unfilled_requirements) {
      shortageMap.set(`${u.day_offset}_${u.shift_id}`, {
        shortage: u.shortage,
        reason: u.reason,
        required: u.required_count,
        assigned: u.assigned_count,
      });
    }
  }

  // 手動アサイン調整ハンドラ
  const handleCellClick = (dayOffset: number, shiftId: string) => {
    if (!response) return;
    const dateInfo = getDateInfo(request.period.start_date, dayOffset);
    setActiveCell({
      dayOffset,
      shiftId,
      slotDate: dateInfo.dateFormatted,
    });
    setSelectedStaffToAdd('');
    setManualWarning(null);
  };

  const getSlotAssignedStaff = (dayOffset: number, shiftId: string): AssignedStaff[] => {
    if (!response) return [];
    const slot = response.schedule.find(
      (s) => s.day_offset === dayOffset && s.shift_id === shiftId
    );
    return slot ? slot.assigned_staff : [];
  };

  const handleAddStaffToSlot = () => {
    if (!response || !activeCell || !selectedStaffToAdd) return;
    const { dayOffset, shiftId } = activeCell;
    const targetStaff = staffList.find((s) => s.id === selectedStaffToAdd);
    const targetShift = shifts.find((s) => s.id === shiftId);
    if (!targetStaff || !targetShift) return;

    // 労基法 Invariant 1 チェック (未成年深夜禁止)
    if (targetStaff.is_minor && (targetShift.is_late_night || targetShift.id === 'late_night')) {
      setManualWarning(
        `【労働基準法 第60条違反】${targetStaff.name} は18歳未満のため、22:00以降の深夜シフトには割り当てられません。`
      );
      return;
    }

    // 同日重複チェック
    const isAlreadyAssignedToday = response.schedule.some(
      (s) => s.day_offset === dayOffset && s.assigned_staff.some((ast) => ast.id === targetStaff.id)
    );
    if (isAlreadyAssignedToday) {
      setManualWarning(`【警告】${targetStaff.name} は同日の別シフト枠に既に割り当てられています。`);
      return;
    }

    // NGペアチェック
    const currentAssigned = getSlotAssignedStaff(dayOffset, shiftId);
    const hasNgConflict = currentAssigned.some((ast) => {
      const assignedStaffObj = staffList.find((s) => s.id === ast.id);
      return (
        targetStaff.ng_staff_ids?.includes(ast.id) ||
        assignedStaffObj?.ng_staff_ids?.includes(targetStaff.id)
      );
    });
    if (hasNgConflict) {
      setManualWarning(
        `【NGペア警告】${targetStaff.name} はこの枠に既にアサインされているスタッフと「相性NG」に設定されています。`
      );
    } else {
      setManualWarning(null);
    }

    // 希望チェック
    const isWant = request.availabilities.some(
      (a) => a.staff_id === targetStaff.id && a.day_offset === dayOffset && a.shift_id === shiftId && a.status === 'want'
    );

    const newAssigned: AssignedStaff = {
      id: targetStaff.id,
      name: targetStaff.name,
      assigned_role: targetStaff.roles[0] || 'staff',
      hourly_wage: targetStaff.hourly_wage,
      is_want_fulfilled: isWant,
    };

    const newSchedule = response.schedule.map((slot) => {
      if (slot.day_offset === dayOffset && slot.shift_id === shiftId) {
        return {
          ...slot,
          assigned_staff: [...slot.assigned_staff, newAssigned],
        };
      }
      return slot;
    });

    // スロットが存在しない場合は追加
    const slotExists = newSchedule.some(
      (s) => s.day_offset === dayOffset && s.shift_id === shiftId
    );
    let finalSchedule: ScheduledShiftSlot[] = newSchedule;
    if (!slotExists) {
      finalSchedule = [
        ...newSchedule,
        {
          date: getDateInfo(request.period.start_date, dayOffset).isoDate,
          day_offset: dayOffset,
          shift_id: shiftId,
          assigned_staff: [newAssigned],
        },
      ];
    }

    const updatedSummary = recalculateScheduleSummary(request, finalSchedule);
    const updatedResponse: ShiftOptimizeResponse = {
      ...response,
      schedule: finalSchedule,
      summary: updatedSummary,
    };

    saveResponse(updatedResponse);
    if (onResponseChange) onResponseChange(updatedResponse);
    setSelectedStaffToAdd('');
  };

  const handleRemoveStaffFromSlot = (staffId: string) => {
    if (!response || !activeCell) return;
    const { dayOffset, shiftId } = activeCell;

    const newSchedule = response.schedule.map((slot) => {
      if (slot.day_offset === dayOffset && slot.shift_id === shiftId) {
        return {
          ...slot,
          assigned_staff: slot.assigned_staff.filter((ast) => ast.id !== staffId),
        };
      }
      return slot;
    });

    const updatedSummary = recalculateScheduleSummary(request, newSchedule);
    const updatedResponse: ShiftOptimizeResponse = {
      ...response,
      schedule: newSchedule,
      summary: updatedSummary,
    };

    saveResponse(updatedResponse);
    if (onResponseChange) onResponseChange(updatedResponse);
    setManualWarning(null);
  };

  return (
    <div className="card" style={{ padding: '1rem', overflowX: 'auto' }} data-testid="shift-matrix">
      {/* 人手不足アラートバナー (直接交渉アシスタントを呼び出し可能) */}
      {response && response.summary.unfilled_requirements.length > 0 && (
        <div
          data-testid="unfilled-requirements-alert"
          style={{
            backgroundColor: '#fff1f2',
            border: '1px solid #fecdd3',
            borderRadius: 'var(--radius-sm)',
            padding: '0.75rem 1rem',
            marginBottom: '1rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '1.125rem' }}>🚨</span>
            <strong style={{ color: '#be123c', fontSize: '0.875rem' }}>
              {response.summary.unfilled_requirements.length} 枠で人員不足が発生しています
            </strong>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            {response.summary.unfilled_requirements.map((u, uIdx) => {
              const dInfo = getDateInfo(request.period.start_date, u.day_offset);
              const sh = shifts.find((s) => s.id === u.shift_id);
              return (
                <button
                  key={uIdx}
                  type="button"
                  data-testid={`btn-unfilled-slot-${u.day_offset}-${u.shift_id}`}
                  onClick={() => {
                    setNegotiationCell({
                      dayOffset: u.day_offset,
                      shiftId: u.shift_id,
                      slotDate: dInfo.dateFormatted,
                    });
                  }}
                  className="btn btn-sm"
                  style={{
                    backgroundColor: '#ffe4e6',
                    border: '1px solid #fda4af',
                    color: '#9f1239',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                  }}
                >
                  <span>
                    🚨 {dInfo.dateFormatted} {sh?.name || u.shift_id}: {u.shortage}名不足 (代打を探す)
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: '0.8125rem',
          minWidth: `${days * 110 + 190}px`,
        }}
      >
        <thead>
          <tr style={{ backgroundColor: '#f8fafc', borderBottom: '2px solid var(--border)' }}>
            <th
              style={{
                padding: '0.75rem',
                textAlign: 'left',
                position: 'sticky',
                left: 0,
                backgroundColor: '#f8fafc',
                zIndex: 2,
                minWidth: '170px',
                borderRight: '1px solid var(--border)',
              }}
            >
              スタッフ ({staffList.length}名)
            </th>
            {Array.from({ length: days }, (_, d) => {
              const dateInfo = getDateInfo(request.period.start_date, d);
              const headerColor = dateInfo.isSunday
                ? 'var(--danger)'
                : dateInfo.isSaturday
                ? 'var(--primary)'
                : 'var(--text-main)';

              return (
                <th
                  key={d}
                  style={{
                    padding: '0.5rem',
                    textAlign: 'center',
                    borderLeft: '1px solid var(--border)',
                    minWidth: '95px',
                    backgroundColor: dateInfo.isSunday || dateInfo.isSaturday ? '#f8faff' : '#f8fafc',
                  }}
                >
                  <div style={{ color: headerColor, fontWeight: 700 }}>
                    {dateInfo.dateFormatted}
                  </div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                    {shifts.map((s) => {
                      const shortageInfo = shortageMap.get(`${d}_${s.id}`);
                      return shortageInfo ? (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => handleCellClick(d, s.id)}
                          title={`${s.name}: 不足${shortageInfo.shortage}名 (必要${shortageInfo.required}名 / 割当${shortageInfo.assigned}名)\n${shortageInfo.reason}`}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '1px',
                            color: 'var(--danger)',
                            fontWeight: 'bold',
                            backgroundColor: 'var(--danger-bg)',
                            border: '1px solid var(--danger-border)',
                            borderRadius: '3px',
                            padding: '1px 3px',
                            fontSize: '0.65rem',
                            margin: '1px',
                          }}
                        >
                          ⚠ {s.name.slice(0, 2)} -{shortageInfo.shortage}
                        </button>
                      ) : null;
                    })}
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {staffList.map((staff) => (
            <tr
              key={staff.id}
              style={{ borderBottom: '1px solid var(--border)' }}
              data-testid={`staff-row-${staff.id}`}
            >
              <td
                style={{
                  padding: '0.625rem 0.75rem',
                  position: 'sticky',
                  left: 0,
                  backgroundColor: '#ffffff',
                  zIndex: 1,
                  fontWeight: 600,
                  borderRight: '1px solid var(--border)',
                }}
              >
                <div>{staff.name}</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 'normal' }}>
                  {staff.roles.slice(0, 2).join(', ')} | ¥{staff.hourly_wage.toLocaleString()}
                  {staff.is_minor && (
                    <span style={{ color: 'var(--danger)', marginLeft: '4px', fontWeight: 'bold' }}>
                      (18歳未満)
                    </span>
                  )}
                </div>
              </td>

              {Array.from({ length: days }, (_, d) => {
                const assigned = assignmentMap.get(`${staff.id}_${d}`);
                const dateInfo = getDateInfo(request.period.start_date, d);

                return (
                  <td
                    key={d}
                    onClick={() => assigned && handleCellClick(d, assigned.shiftId)}
                    style={{
                      padding: '0.35rem',
                      textAlign: 'center',
                      borderLeft: '1px solid var(--border)',
                      backgroundColor: assigned
                        ? '#f8fafc'
                        : dateInfo.isSunday || dateInfo.isSaturday
                        ? '#fbfcfe'
                        : '#ffffff',
                      cursor: assigned ? 'pointer' : 'default',
                    }}
                    data-testid={`shift-cell-${staff.id}-day_${d}`}
                  >
                    {assigned ? (
                      <div
                        style={{
                          padding: '0.25rem 0.375rem',
                          borderRadius: '4px',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          backgroundColor:
                            assigned.shiftId === 'late_night' || assigned.shiftId === 'late'
                              ? '#ede9fe'
                              : assigned.shiftId === 'morning'
                              ? '#dbeafe'
                              : '#dcfce7',
                          color:
                            assigned.shiftId === 'late_night' || assigned.shiftId === 'late'
                              ? '#5b21b6'
                              : assigned.shiftId === 'morning'
                              ? '#1e40af'
                              : '#15803d',
                          transition: 'transform 0.1s ease',
                        }}
                        title={`${staff.name} - ${assigned.shiftName} (クリックして調整)`}
                      >
                        <div>{assigned.shiftName}</div>
                        {assigned.isWant && (
                          <div style={{ fontSize: '0.65rem', color: 'var(--success)' }}>
                            ◎ 希望一致
                          </div>
                        )}
                      </div>
                    ) : (
                      <span style={{ color: '#cbd5e1' }}>-</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {/* 手動アサイン微調整モーダル */}
      {activeCell && (
        <div className="modal-overlay" onClick={() => setActiveCell(null)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h2 style={{ fontSize: '1.125rem', fontWeight: 700 }}>
                🔧 シフト枠アサイン調整 ({activeCell.slotDate})
              </h2>
              <button
                type="button"
                onClick={() => setActiveCell(null)}
                style={{ background: 'none', fontSize: '1.25rem', color: 'var(--text-muted)' }}
              >
                ✕
              </button>
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <div style={{ fontSize: '0.875rem', fontWeight: 600 }}>
                対象シフト:{' '}
                <span className="badge badge-primary">
                  {shifts.find((s) => s.id === activeCell.shiftId)?.name || activeCell.shiftId}
                </span>
              </div>
            </div>

            {manualWarning && (
              <div
                style={{
                  backgroundColor: 'var(--danger-bg)',
                  color: 'var(--danger)',
                  border: '1px solid var(--danger-border)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '0.625rem 0.75rem',
                  fontSize: '0.8125rem',
                  marginBottom: '1rem',
                  lineHeight: 1.4,
                }}
              >
                {manualWarning}
              </div>
            )}

            {/* 現在アサインされているスタッフ */}
            <div style={{ marginBottom: '1.25rem' }}>
              <div style={{ fontSize: '0.8125rem', fontWeight: 600, marginBottom: '0.5rem' }}>
                現在アサイン中のスタッフ:
              </div>
              {getSlotAssignedStaff(activeCell.dayOffset, activeCell.shiftId).length === 0 ? (
                <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', padding: '0.5rem', backgroundColor: '#f8fafc', borderRadius: '4px' }}>
                  現在アサインされているスタッフはいません（人員不足状態）
                </div>
              ) : (
                <ul style={{ listStyle: 'none', padding: 0 }}>
                  {getSlotAssignedStaff(activeCell.dayOffset, activeCell.shiftId).map((ast) => (
                    <li
                      key={ast.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '0.4rem 0.6rem',
                        borderBottom: '1px solid var(--border)',
                        fontSize: '0.875rem',
                      }}
                    >
                      <span>
                        👤 <strong>{ast.name}</strong> ({ast.assigned_role})
                      </span>
                      <button
                        onClick={() => handleRemoveStaffFromSlot(ast.id)}
                        className="btn btn-danger btn-sm"
                        style={{ minHeight: '28px', padding: '0.2rem 0.5rem' }}
                      >
                        解除
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* スタッフを追加 */}
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
              <div style={{ fontSize: '0.8125rem', fontWeight: 600, marginBottom: '0.5rem' }}>
                スタッフを追加アサイン:
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <select
                  className="form-select"
                  value={selectedStaffToAdd}
                  onChange={(e) => setSelectedStaffToAdd(e.target.value)}
                  style={{ flex: 1 }}
                >
                  <option value="">スタッフを選択...</option>
                  {staffList
                    .filter(
                      (s) =>
                        !getSlotAssignedStaff(activeCell.dayOffset, activeCell.shiftId).some(
                          (ast) => ast.id === s.id
                        )
                    )
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} {s.is_minor ? '(18歳未満)' : ''}
                      </option>
                    ))}
                </select>
                <button
                  type="button"
                  onClick={handleAddStaffToSlot}
                  disabled={!selectedStaffToAdd}
                  className="btn btn-primary"
                >
                  追加
                </button>
              </div>
            </div>

            {/* 人手不足枠の場合の「お願いLINE文面作成」導線 */}
            {shortageMap.has(`${activeCell.dayOffset}_${activeCell.shiftId}`) && (
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1rem', marginTop: '1rem' }}>
                <button
                  type="button"
                  data-testid="btn-open-negotiation-from-modal"
                  onClick={() => {
                    setNegotiationCell(activeCell);
                    setActiveCell(null);
                  }}
                  className="btn btn-primary btn-sm"
                  style={{
                    width: '100%',
                    backgroundColor: '#be123c',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.4rem',
                  }}
                >
                  <span>🚨 代打スタッフを探す＆お願いLINE文面を作成</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 人手不足交渉支援モーダル */}
      {negotiationCell && (
        <NegotiationModal
          isOpen={true}
          onClose={() => setNegotiationCell(null)}
          day_offset={negotiationCell.dayOffset}
          shift={shifts.find((s) => s.id === negotiationCell.shiftId) || shifts[0]}
          shifts={shifts}
          dateFormatted={negotiationCell.slotDate}
          staff_members={staffList}
          availabilities={request.availabilities}
          currentSchedule={response?.schedule || []}
          required_roles={
            request.requirements.find(
              (r) => r.day_offset === negotiationCell.dayOffset && r.shift_id === negotiationCell.shiftId
            )?.required_roles
          }
          showToast={(msg) => (showToast ? showToast(msg) : alert(msg))}
        />
      )}
    </div>
  );
};
