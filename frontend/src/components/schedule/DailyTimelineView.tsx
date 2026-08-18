'use client';

import React, { useState } from 'react';
import {
  AssignedShiftTime,
  HourlyRequirement,
  HourlyScheduleSlot,
  StaffMember,
} from '../../lib/types';
import { formatDisplayDate } from '../../lib/date-utils';

interface DailyTimelineViewProps {
  currentDayOffset: number;
  startDate: string;
  totalDays: number;
  onDayChange: (offset: number) => void;
  staffMembers: StaffMember[];
  assignedShifts: AssignedShiftTime[];
  hourlyRequirements: HourlyRequirement[];
  hourlySchedule: HourlyScheduleSlot[];
  onUpdateShiftTime?: (staffId: string, dayOffset: number, startTime: string, endTime: string) => void;
}

// 営業時間スロット (09:00 〜 24:00 = 15スロット)
const TIMELINE_HOURS = Array.from({ length: 16 }, (_, i) => i + 9); // 9..24

export default function DailyTimelineView({
  currentDayOffset,
  startDate,
  totalDays,
  onDayChange,
  staffMembers,
  assignedShifts,
  hourlyRequirements,
  hourlySchedule,
  onUpdateShiftTime,
}: DailyTimelineViewProps) {
  const [selectedStaffForEdit, setSelectedStaffForEdit] = useState<{
    staffId: string;
    staffName: string;
    start: string;
    end: string;
  } | null>(null);

  const currentDateFormatted = formatDisplayDate(startDate, currentDayOffset);

  // 当日のアサイン
  const dayShifts = assignedShifts.filter((s) => s.day_offset === currentDayOffset);
  const shiftMap = new Map(dayShifts.map((s) => [s.staff_id, s]));

  // 当日の時間別必要人数 & 実配置人数
  const reqMap = new Map(
    hourlyRequirements
      .filter((r) => r.day_offset === currentDayOffset)
      .map((r) => [r.hour, r.min_staff])
  );

  const actualMap = new Map<number, number>();
  TIMELINE_HOURS.forEach((h) => {
    // h時に勤務している人数
    const count = dayShifts.filter((s) => {
      const startH = parseInt(s.start_time.split(':')[0], 10);
      const endH = parseInt(s.end_time.split(':')[0], 10);
      return h >= startH && h < endH;
    }).length;
    actualMap.set(h, count);
  });

  return (
    <div className="card" data-testid="daily-timeline-view" style={{ overflowX: 'auto' }}>
      {/* 1. 日付ナビゲーションバー */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '1.25rem',
          paddingBottom: '0.75rem',
          borderBottom: '1px solid var(--border)',
          flexWrap: 'wrap',
          gap: '0.5rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            data-testid="btn-prev-day"
            disabled={currentDayOffset <= 0}
            onClick={() => onDayChange(currentDayOffset - 1)}
          >
            ◀ 前日
          </button>
          <span
            data-testid="current-day-label"
            style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-main)' }}
          >
            {currentDateFormatted} (Day {currentDayOffset + 1} / {totalDays})
          </span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            data-testid="btn-next-day"
            disabled={currentDayOffset >= totalDays - 1}
            onClick={() => onDayChange(currentDayOffset + 1)}
          >
            翌日 ▶
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', fontSize: '0.85rem' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            <span
              style={{
                width: '12px',
                height: '12px',
                backgroundColor: 'var(--primary)',
                borderRadius: '3px',
              }}
            />
            出勤中
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            <span
              style={{
                width: '12px',
                height: '12px',
                backgroundColor: 'var(--danger)',
                borderRadius: '3px',
              }}
            />
            人員不足
          </span>
        </div>
      </div>

      {/* 2. 時間別 人員充足度（山谷グラフ） */}
      <div
        style={{
          backgroundColor: 'var(--surface-hover)',
          padding: '0.75rem 1rem',
          borderRadius: 'var(--radius)',
          marginBottom: '1rem',
          border: '1px solid var(--border)',
        }}
      >
        <div
          style={{
            fontSize: '0.8rem',
            fontWeight: 700,
            color: 'var(--text-muted)',
            marginBottom: '0.5rem',
          }}
        >
          📈 1時間ごとの人員充足状況（配置人数 / 必要人数）
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `180px repeat(${TIMELINE_HOURS.length}, minmax(42px, 1fr))`,
            gap: '2px',
            alignItems: 'end',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              fontSize: '0.75rem',
              fontWeight: 600,
              textAlign: 'left',
              color: 'var(--text-muted)',
            }}
          >
            必要 vs 配置
          </div>
          {TIMELINE_HOURS.map((h) => {
            const req = reqMap.get(h) || 0;
            const actual = actualMap.get(h) || 0;
            const isShortage = actual < req;
            const isSurplus = actual > req;

            return (
              <div
                key={h}
                data-testid={`hourly-stat-${h}`}
                style={{
                  padding: '0.25rem 0',
                  borderRadius: '4px',
                  backgroundColor: isShortage
                    ? 'rgba(239, 68, 68, 0.15)'
                    : isSurplus
                    ? 'rgba(16, 185, 129, 0.12)'
                    : 'transparent',
                  border: isShortage ? '1px solid var(--danger)' : '1px solid transparent',
                }}
              >
                <div
                  style={{
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    color: isShortage
                      ? 'var(--danger)'
                      : isSurplus
                      ? 'var(--success)'
                      : 'var(--text-main)',
                  }}
                >
                  {actual}/{req}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 3. ガントチャート・タイムライン本体 */}
      <div style={{ minWidth: '850px' }}>
        {/* ヘッダー時刻目盛り */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `180px repeat(${TIMELINE_HOURS.length}, minmax(42px, 1fr))`,
            gap: '2px',
            borderBottom: '2px solid var(--border)',
            paddingBottom: '0.5rem',
            marginBottom: '0.5rem',
            textAlign: 'center',
            fontSize: '0.75rem',
            fontWeight: 700,
            color: 'var(--text-muted)',
          }}
        >
          <div style={{ textAlign: 'left', paddingLeft: '0.5rem' }}>スタッフ</div>
          {TIMELINE_HOURS.map((h) => (
            <div key={h}>{h}:00</div>
          ))}
        </div>

        {/* スタッフ行一覧 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          {staffMembers.map((staff) => {
            const shift = shiftMap.get(staff.id);
            const startH = shift ? parseInt(shift.start_time.split(':')[0], 10) : null;
            const endH = shift ? parseInt(shift.end_time.split(':')[0], 10) : null;

            return (
              <div
                key={staff.id}
                data-testid={`timeline-row-${staff.id}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: `180px repeat(${TIMELINE_HOURS.length}, minmax(42px, 1fr))`,
                  gap: '2px',
                  alignItems: 'center',
                  padding: '0.35rem 0',
                  borderRadius: '6px',
                  backgroundColor: shift ? 'transparent' : 'rgba(241, 245, 249, 0.4)',
                }}
              >
                {/* スタッフ情報セル */}
                <div style={{ paddingLeft: '0.5rem', minWidth: 0 }}>
                  <div
                    style={{
                      fontWeight: 600,
                      fontSize: '0.85rem',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      color: 'var(--text-main)',
                    }}
                  >
                    {staff.name}
                  </div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                    ¥{staff.hourly_wage.toLocaleString()} / {shift ? `${shift.hours}h` : '休'}
                  </div>
                </div>

                {/* タイムライン時間スロットセル群 */}
                {TIMELINE_HOURS.map((h) => {
                  const isWorking = shift && startH !== null && endH !== null && h >= startH && h < endH;
                  const isStart = isWorking && h === startH;
                  const isEnd = isWorking && h === endH - 1;

                  return (
                    <div
                      key={h}
                      onClick={() => {
                        setSelectedStaffForEdit({
                          staffId: staff.id,
                          staffName: staff.name,
                          start: shift ? shift.start_time : '11:00',
                          end: shift ? shift.end_time : '15:00',
                        });
                      }}
                      style={{
                        height: '32px',
                        backgroundColor: isWorking ? 'var(--primary)' : 'rgba(226, 232, 240, 0.4)',
                        borderTopLeftRadius: isStart ? '6px' : '0',
                        borderBottomLeftRadius: isStart ? '6px' : '0',
                        borderTopRightRadius: isEnd ? '6px' : '0',
                        borderBottomRightRadius: isEnd ? '6px' : '0',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#ffffff',
                        fontSize: '0.7rem',
                        fontWeight: 700,
                        transition: 'opacity 0.2s',
                      }}
                      title={
                        shift
                          ? `${staff.name}: ${shift.start_time}〜${shift.end_time} (${shift.hours}h)`
                          : `${staff.name}: 休み（クリックでアサイン設定）`
                      }
                    >
                      {isStart && (
                        <span style={{ paddingLeft: '4px', whiteSpace: 'nowrap' }}>
                          {shift.start_time}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* 4. 手動微調整モーダル */}
      {selectedStaffForEdit && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000,
          }}
        >
          <div
            className="card"
            style={{ width: '90%', maxWidth: '400px', backgroundColor: '#ffffff' }}
          >
            <h3 style={{ margin: '0 0 1rem', fontSize: '1.1rem' }}>
              ⚙️ {selectedStaffForEdit.staffName} の勤務時間調整
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div>
                <label className="label">出勤時刻</label>
                <input
                  type="time"
                  step="3600"
                  className="input"
                  value={selectedStaffForEdit.start}
                  onChange={(e) =>
                    setSelectedStaffForEdit({
                      ...selectedStaffForEdit,
                      start: e.target.value,
                    })
                  }
                />
              </div>
              <div>
                <label className="label">退勤時刻</label>
                <input
                  type="time"
                  step="3600"
                  className="input"
                  value={selectedStaffForEdit.end}
                  onChange={(e) =>
                    setSelectedStaffForEdit({
                      ...selectedStaffForEdit,
                      end: e.target.value,
                    })
                  }
                />
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '0.5rem',
                marginTop: '1.25rem',
              }}
            >
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setSelectedStaffForEdit(null)}
              >
                キャンセル
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => {
                  if (onUpdateShiftTime) {
                    onUpdateShiftTime(
                      selectedStaffForEdit.staffId,
                      currentDayOffset,
                      selectedStaffForEdit.start,
                      selectedStaffForEdit.end
                    );
                  }
                  setSelectedStaffForEdit(null);
                }}
              >
                保存する
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
