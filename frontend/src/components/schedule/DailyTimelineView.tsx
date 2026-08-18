'use client';

import React, { useState, useRef, useEffect, useMemo } from 'react';
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

// 営業時間 (09:00 〜 24:00 = 15時間 = 900分)
const TIMELINE_START_HOUR = 9;
const TIMELINE_END_HOUR = 24;
const TIMELINE_HOURS = Array.from(
  { length: TIMELINE_END_HOUR - TIMELINE_START_HOUR + 1 },
  (_, i) => i + TIMELINE_START_HOUR
); // [9, 10, ..., 24]
const TOTAL_MINUTES = (TIMELINE_END_HOUR - TIMELINE_START_HOUR) * 60; // 900分

// 分数ヘルパー関数
function timeToMinutes(t: string): number {
  if (!t) return 9 * 60;
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function minutesToTimeString(min: number): string {
  const clamped = Math.max(TIMELINE_START_HOUR * 60, Math.min(TIMELINE_END_HOUR * 60, min));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

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

  // マウスドラッグ伸縮の状態管理 (15分単位)
  const [resizing, setResizing] = useState<{
    staffId: string;
    edge: 'start' | 'end';
    initialStartMin: number;
    initialEndMin: number;
  } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const currentDateFormatted = formatDisplayDate(startDate, currentDayOffset);

  // 当日のアサイン
  const dayShifts = useMemo(
    () => assignedShifts.filter((s) => s.day_offset === currentDayOffset),
    [assignedShifts, currentDayOffset]
  );
  const shiftMap = useMemo(
    () => new Map(dayShifts.map((s) => [s.staff_id, s])),
    [dayShifts]
  );

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
      const sMin = timeToMinutes(s.start_time);
      const eMin = timeToMinutes(s.end_time);
      const slotStart = h * 60;
      const slotEnd = (h + 1) * 60;
      return sMin < slotEnd && eMin > slotStart;
    }).length;
    actualMap.set(h, count);
  });

  // 15分刻みスナップによるドラッグ伸縮
  useEffect(() => {
    if (!resizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const rowElem = document.querySelector(`[data-testid="timeline-slots-${resizing.staffId}"]`);
      if (!rowElem) return;

      const rect = rowElem.getBoundingClientRect();
      const relativeX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
      const ratio = relativeX / rect.width;

      // 15分（0.25h）単位でスナップ
      const rawMinutes = TIMELINE_START_HOUR * 60 + ratio * TOTAL_MINUTES;
      const snappedMinutes = Math.round(rawMinutes / 15) * 15;
      const clampedMinutes = Math.max(
        TIMELINE_START_HOUR * 60,
        Math.min(TIMELINE_END_HOUR * 60, snappedMinutes)
      );

      const currentShift = shiftMap.get(resizing.staffId);
      if (!currentShift) return;

      let newStartMin = timeToMinutes(currentShift.start_time);
      let newEndMin = timeToMinutes(currentShift.end_time);

      if (resizing.edge === 'start') {
        if (clampedMinutes < newEndMin) {
          newStartMin = clampedMinutes;
        }
      } else if (resizing.edge === 'end') {
        if (clampedMinutes > newStartMin) {
          newEndMin = clampedMinutes;
        }
      }

      if (onUpdateShiftTime) {
        onUpdateShiftTime(
          resizing.staffId,
          currentDayOffset,
          minutesToTimeString(newStartMin),
          minutesToTimeString(newEndMin)
        );
      }
    };

    const handleMouseUp = () => {
      setResizing(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizing, currentDayOffset, shiftMap, onUpdateShiftTime]);

  return (
    <div
      className="card"
      data-testid="daily-timeline-view"
      ref={containerRef}
      style={{ overflowX: 'auto', padding: '0', position: 'relative' }}
    >
      {/* ④ 必要/配置以上の部分を固定表示 (Sticky Header) */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 20,
          backgroundColor: '#ffffff',
          padding: '1rem 1rem 0.5rem',
          borderBottom: '2px solid var(--border)',
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.04)',
        }}
      >
        {/* 1. 日付ナビゲーションバー */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '0.875rem',
            paddingBottom: '0.5rem',
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
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              ※点線・伸縮は15分単位
            </span>
          </div>
        </div>

        {/* ③ 必要 vs 配置（上が必要 / 下が配置）の山谷表示 ＆ ① 15分刻み点線グリッド */}
        <div
          style={{
            minWidth: '940px',
            backgroundColor: 'var(--surface-hover)',
            padding: '0.5rem 0.75rem',
            borderRadius: 'var(--radius)',
            border: '1px solid var(--border)',
            marginBottom: '0.5rem',
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `180px repeat(${TIMELINE_HOURS.length - 1}, minmax(48px, 1fr))`,
              gap: '0',
              alignItems: 'center',
              textAlign: 'center',
            }}
          >
            <div
              style={{
                fontSize: '0.75rem',
                fontWeight: 700,
                textAlign: 'left',
                color: 'var(--text-muted)',
                paddingLeft: '0.5rem',
              }}
            >
              <div>📈 上: 必要人数</div>
              <div>&nbsp;&nbsp;&nbsp;&nbsp;下: 配置人数</div>
            </div>

            {TIMELINE_HOURS.slice(0, -1).map((h) => {
              const req = reqMap.get(h) || 0;
              const actual = actualMap.get(h) || 0;
              const isShortage = actual < req;
              const isSurplus = actual > req;

              return (
                <div
                  key={h}
                  data-testid={`hourly-stat-${h}`}
                  style={{
                    padding: '0.2rem 0',
                    borderRight: '1px dashed rgba(148, 163, 184, 0.8)', // ① 1時間点線境界
                    backgroundColor: isShortage
                      ? 'rgba(239, 68, 68, 0.15)'
                      : isSurplus
                      ? 'rgba(16, 185, 129, 0.12)'
                      : 'transparent',
                    position: 'relative',
                  }}
                >
                  {/* 上: 必要 */}
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                    要 {req}
                  </div>
                  {/* 下: 配置 */}
                  <div
                    style={{
                      fontSize: '0.85rem',
                      fontWeight: 800,
                      color: isShortage
                        ? 'var(--danger)'
                        : isSurplus
                        ? 'var(--success)'
                        : 'var(--text-main)',
                    }}
                  >
                    配 {actual}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ヘッダー時刻目盛り ＆ 15分サブ点線 */}
        <div
          style={{
            minWidth: '940px',
            display: 'grid',
            gridTemplateColumns: `180px repeat(${TIMELINE_HOURS.length - 1}, minmax(48px, 1fr))`,
            gap: '0',
            textAlign: 'center',
            fontSize: '0.75rem',
            fontWeight: 700,
            color: 'var(--text-muted)',
            paddingTop: '0.25rem',
          }}
        >
          <div style={{ textAlign: 'left', paddingLeft: '0.5rem' }}>スタッフ氏名</div>
          {TIMELINE_HOURS.slice(0, -1).map((h) => (
            <div
              key={h}
              style={{
                borderRight: '1px dashed rgba(148, 163, 184, 0.8)',
                position: 'relative',
              }}
            >
              {h}:00
            </div>
          ))}
        </div>
      </div>

      {/* 3. ガントチャート・タイムライン本体（スタッフ行一覧 ＆ 15分グリッド線） */}
      <div style={{ minWidth: '940px', padding: '0.75rem 1rem 1.5rem' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
          {staffMembers.map((staff) => {
            const shift = shiftMap.get(staff.id);
            const startMin = shift ? timeToMinutes(shift.start_time) : null;
            const endMin = shift ? timeToMinutes(shift.end_time) : null;

            return (
              <div
                key={staff.id}
                data-testid={`timeline-row-${staff.id}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: `180px repeat(${TIMELINE_HOURS.length - 1}, minmax(48px, 1fr))`,
                  gap: '0',
                  alignItems: 'center',
                  padding: '0.35rem 0',
                  borderRadius: '6px',
                  backgroundColor: shift ? 'transparent' : 'rgba(241, 245, 249, 0.35)',
                  position: 'relative',
                }}
              >
                {/* スタッフ情報セル */}
                <div style={{ paddingLeft: '0.5rem', minWidth: 0, paddingRight: '0.5rem' }}>
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

                {/* ① 15分刻み縦点線グリッド ＆ ② 15分ドラッグ伸縮バー */}
                <div
                  data-testid={`timeline-slots-${staff.id}`}
                  style={{
                    gridColumn: `2 / span ${TIMELINE_HOURS.length - 1}`,
                    display: 'grid',
                    gridTemplateColumns: `repeat(${TIMELINE_HOURS.length - 1}, minmax(48px, 1fr))`,
                    gap: '0',
                    height: '36px',
                    position: 'relative',
                  }}
                >
                  {/* 各時間の 4分割 15分グリッド線 */}
                  {TIMELINE_HOURS.slice(0, -1).map((h) => (
                    <div
                      key={h}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(4, 1fr)',
                        height: '100%',
                        borderRight: '1px dashed rgba(148, 163, 184, 0.7)', // 1時間境界線
                      }}
                    >
                      {[0, 15, 30, 45].map((m) => (
                        <div
                          key={m}
                          data-testid={`subslot-${h}-${m}`}
                          onClick={() => {
                            if (!shift) {
                              const sTime = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
                              const eTime = `${String(Math.min(24, h + 4)).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
                              setSelectedStaffForEdit({
                                staffId: staff.id,
                                staffName: staff.name,
                                start: sTime,
                                end: eTime,
                              });
                            }
                          }}
                          style={{
                            borderRight:
                              m === 30
                                ? '1px dashed rgba(203, 213, 225, 0.6)' // 30分点線
                                : m < 45
                                ? '1px dotted rgba(226, 232, 240, 0.5)' // 15分/45分点線
                                : 'none',
                            backgroundColor: 'rgba(248, 250, 252, 0.4)',
                            height: '100%',
                            cursor: shift ? 'default' : 'pointer',
                          }}
                          title={!shift ? `${staff.name} を ${h}:${String(m).padStart(2, '0')} からアサイン` : undefined}
                        />
                      ))}
                    </div>
                  ))}

                  {/* ② 出勤横バー ＆ 15分リサイズハンドル */}
                  {shift && startMin !== null && endMin !== null && startMin < endMin && (
                    <div
                      data-testid={`shift-bar-${staff.id}`}
                      style={{
                        position: 'absolute',
                        top: '2px',
                        bottom: '2px',
                        left: `${((Math.max(TIMELINE_START_HOUR * 60, startMin) - TIMELINE_START_HOUR * 60) / TOTAL_MINUTES) * 100}%`,
                        width: `${((Math.min(TIMELINE_END_HOUR * 60, endMin) - Math.max(TIMELINE_START_HOUR * 60, startMin)) / TOTAL_MINUTES) * 100}%`,
                        backgroundColor: shift.is_late_night ? '#7c3aed' : 'var(--primary)',
                        borderRadius: '6px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        color: '#ffffff',
                        boxShadow: '0 2px 4px rgba(0, 0, 0, 0.12)',
                        userSelect: 'none',
                        zIndex: 5,
                      }}
                    >
                      {/* ② 左端リサイズハンドル (15分単位) */}
                      <div
                        data-testid={`resize-start-${staff.id}`}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          setResizing({
                            staffId: staff.id,
                            edge: 'start',
                            initialStartMin: startMin,
                            initialEndMin: endMin,
                          });
                        }}
                        style={{
                          width: '12px',
                          height: '100%',
                          cursor: 'ew-resize',
                          backgroundColor: 'rgba(255, 255, 255, 0.35)',
                          borderTopLeftRadius: '6px',
                          borderBottomLeftRadius: '6px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                        title="左端をドラッグして開始時間を15分刻みで変更"
                      >
                        <span style={{ fontSize: '0.6rem', opacity: 0.85 }}>◀</span>
                      </div>

                      {/* 中央テキスト & クリックで直接編集 */}
                      <div
                        onClick={() => {
                          setSelectedStaffForEdit({
                            staffId: staff.id,
                            staffName: staff.name,
                            start: shift.start_time,
                            end: shift.end_time,
                          });
                        }}
                        style={{
                          flex: 1,
                          textAlign: 'center',
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          cursor: 'pointer',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          padding: '0 4px',
                        }}
                        title="クリックして時刻を直接編集"
                      >
                        {shift.start_time}-{shift.end_time} ({shift.hours}h)
                      </div>

                      {/* ② 右端リサイズハンドル (15分単位) */}
                      <div
                        data-testid={`resize-end-${staff.id}`}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          setResizing({
                            staffId: staff.id,
                            edge: 'end',
                            initialStartMin: startMin,
                            initialEndMin: endMin,
                          });
                        }}
                        style={{
                          width: '12px',
                          height: '100%',
                          cursor: 'ew-resize',
                          backgroundColor: 'rgba(255, 255, 255, 0.35)',
                          borderTopRightRadius: '6px',
                          borderBottomRightRadius: '6px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                        title="右端をドラッグして終了時間を15分刻みで変更"
                      >
                        <span style={{ fontSize: '0.6rem', opacity: 0.85 }}>▶</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 4. 手動微調整モーダル (15分刻み step=900) */}
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
              ⚙️ {selectedStaffForEdit.staffName} の勤務時間設定 (15分単位)
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div>
                <label className="label">出勤時刻 (15分刻み)</label>
                <input
                  type="time"
                  step="900"
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
                <label className="label">退勤時刻 (15分刻み)</label>
                <input
                  type="time"
                  step="900"
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
