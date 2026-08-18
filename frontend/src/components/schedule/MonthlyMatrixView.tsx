'use client';

import React from 'react';
import { AssignedShiftTime, StaffMember } from '../../lib/types';
import { formatDisplayDate } from '../../lib/date-utils';

interface MonthlyMatrixViewProps {
  startDate: string;
  totalDays: number;
  staffMembers: StaffMember[];
  assignedShifts: AssignedShiftTime[];
}

export default function MonthlyMatrixView({
  startDate,
  totalDays,
  staffMembers,
  assignedShifts,
}: MonthlyMatrixViewProps) {
  const daysArray = Array.from({ length: totalDays }, (_, i) => i);

  // (staffId, dayOffset) -> AssignedShiftTime
  const shiftLookup = new Map<string, AssignedShiftTime>();
  assignedShifts.forEach((s) => {
    shiftLookup.set(`${s.staff_id}_${s.day_offset}`, s);
  });

  return (
    <div className="card" data-testid="monthly-matrix-view" style={{ overflowX: 'auto' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '1rem',
          paddingBottom: '0.5rem',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-main)' }}>
          月間スタッフ別シフト一覧マトリクス（{totalDays}日間）
        </div>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          ※ 各セルの表記: 開始-終了 (実働h)
        </div>
      </div>

      <div style={{ minWidth: `${220 + totalDays * 70 + 160}px` }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
          <thead>
            <tr style={{ backgroundColor: 'var(--surface-hover)', borderBottom: '2px solid var(--border)' }}>
              <th
                style={{
                  padding: '0.6rem 0.75rem',
                  textAlign: 'left',
                  position: 'sticky',
                  left: 0,
                  backgroundColor: '#ffffff',
                  zIndex: 2,
                  width: '180px',
                  borderRight: '1px solid var(--border)',
                }}
              >
                スタッフ氏名
              </th>
              {daysArray.map((d) => {
                const dateStr = formatDisplayDate(startDate, d);
                const isSun = dateStr.includes('日');
                const isSat = dateStr.includes('土');

                return (
                  <th
                    key={d}
                    style={{
                      padding: '0.5rem 0.25rem',
                      textAlign: 'center',
                      minWidth: '68px',
                      color: isSun ? 'var(--danger)' : isSat ? 'var(--primary)' : 'var(--text-main)',
                      borderRight: '1px solid var(--border)',
                    }}
                  >
                    <div>{d + 1}日</div>
                    <div style={{ fontSize: '0.7rem', opacity: 0.8 }}>
                      {dateStr.split('(')[1]?.replace(')', '') || ''}
                    </div>
                  </th>
                );
              })}
              <th
                style={{
                  padding: '0.6rem 0.75rem',
                  textAlign: 'right',
                  width: '80px',
                  borderRight: '1px solid var(--border)',
                }}
              >
                合計時間
              </th>
              <th
                style={{
                  padding: '0.6rem 0.75rem',
                  textAlign: 'right',
                  width: '90px',
                }}
              >
                概算給与
              </th>
            </tr>
          </thead>
          <tbody>
            {staffMembers.map((staff) => {
              // 個人の月間集計
              const staffShifts = assignedShifts.filter((s) => s.staff_id === staff.id);
              const totalHours = staffShifts.reduce((acc, cur) => acc + cur.hours, 0);
              const totalCost = staffShifts.reduce((acc, cur) => acc + cur.labor_cost, 0);
              const workedDays = staffShifts.length;

              return (
                <tr
                  key={staff.id}
                  data-testid={`monthly-row-${staff.id}`}
                  style={{
                    borderBottom: '1px solid var(--border)',
                    transition: 'background-color 0.15s',
                  }}
                >
                  {/* スタッフ氏名（固定列） */}
                  <td
                    style={{
                      padding: '0.5rem 0.75rem',
                      position: 'sticky',
                      left: 0,
                      backgroundColor: '#ffffff',
                      zIndex: 1,
                      borderRight: '1px solid var(--border)',
                    }}
                  >
                    <div style={{ fontWeight: 600, color: 'var(--text-main)' }}>{staff.name}</div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                      時給 ¥{staff.hourly_wage.toLocaleString()} ({workedDays}日出勤)
                    </div>
                  </td>

                  {/* 1日〜N日の各日セル */}
                  {daysArray.map((d) => {
                    const shift = shiftLookup.get(`${staff.id}_${d}`);
                    const dateStr = formatDisplayDate(startDate, d);
                    const isSun = dateStr.includes('日');
                    const isSat = dateStr.includes('土');

                    if (!shift) {
                      return (
                        <td
                          key={d}
                          style={{
                            padding: '0.4rem 0.2rem',
                            textAlign: 'center',
                            color: 'var(--text-muted)',
                            backgroundColor: isSun
                              ? 'rgba(239, 68, 68, 0.03)'
                              : isSat
                              ? 'rgba(59, 130, 246, 0.03)'
                              : 'transparent',
                            borderRight: '1px solid var(--border)',
                          }}
                        >
                          -
                        </td>
                      );
                    }

                    // 開始・終了の簡易表記 (例: 11-15)
                    const sH = shift.start_time.split(':')[0];
                    const eH = shift.end_time.split(':')[0];

                    return (
                      <td
                        key={d}
                        data-testid={`cell-${staff.id}-${d}`}
                        style={{
                          padding: '0.35rem 0.2rem',
                          textAlign: 'center',
                          backgroundColor: shift.is_late_night
                            ? 'rgba(139, 92, 246, 0.1)'
                            : 'rgba(37, 99, 235, 0.08)',
                          borderRight: '1px solid var(--border)',
                        }}
                      >
                        <div
                          style={{
                            fontWeight: 700,
                            fontSize: '0.75rem',
                            color: shift.is_late_night ? '#6d28d9' : 'var(--primary)',
                          }}
                        >
                          {sH}-{eH}
                        </div>
                        <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                          {shift.hours}h
                        </div>
                      </td>
                    );
                  })}

                  {/* 合計時間 */}
                  <td
                    style={{
                      padding: '0.5rem 0.75rem',
                      textAlign: 'right',
                      fontWeight: 700,
                      color: 'var(--text-main)',
                      borderRight: '1px solid var(--border)',
                    }}
                  >
                    {totalHours.toFixed(1)}h
                  </td>

                  {/* 概算給与 */}
                  <td
                    style={{
                      padding: '0.5rem 0.75rem',
                      textAlign: 'right',
                      fontWeight: 700,
                      color: 'var(--primary)',
                    }}
                  >
                    ¥{totalCost.toLocaleString()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
