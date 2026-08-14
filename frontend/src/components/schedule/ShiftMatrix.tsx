'use client';

import React from 'react';
import { ShiftOptimizeRequest, ShiftOptimizeResponse } from '@/lib/types';

interface Props {
  request: ShiftOptimizeRequest;
  response: ShiftOptimizeResponse | null;
}

export const ShiftMatrix: React.FC<Props> = ({ request, response }) => {
  const days = request.period.days;
  const staffList = request.staff_members;
  const shifts = request.shifts;

  // マップ作成: (staff_id, day_offset) -> 割当シフト情報
  const assignmentMap = new Map<string, { shiftName: string; isWant: boolean; shiftId: string }>();
  // 不足マップ: (day_offset, shift_id) -> shortage
  const shortageMap = new Map<string, { shortage: number; reason: string }>();

  if (response) {
    for (const slot of response.schedule) {
      const shiftObj = shifts.find((s) => s.id === slot.shift_id);
      const shiftName = shiftObj ? shiftObj.name : slot.shift_id;
      for (const st of slot.assigned_staff) {
        assignmentMap.set(`${st.id}_${slot.day_offset}`, {
          shiftName,
          isWant: st.is_want_fulfilled,
          shiftId: slot.shift_id,
        });
      }
    }

    for (const u of response.summary.unfilled_requirements) {
      shortageMap.set(`${u.day_offset}_${u.shift_id}`, {
        shortage: u.shortage,
        reason: u.reason,
      });
    }
  }

  return (
    <div className="card" style={{ padding: '1rem', overflowX: 'auto' }} data-testid="shift-matrix">
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: '0.8125rem',
          minWidth: `${days * 100 + 180}px`,
        }}
      >
        <thead>
          <tr style={{ backgroundColor: '#f1f5f9', borderBottom: '2px solid var(--border)' }}>
            <th
              style={{
                padding: '0.75rem',
                textAlign: 'left',
                position: 'sticky',
                left: 0,
                backgroundColor: '#f1f5f9',
                zIndex: 2,
                minWidth: '160px',
              }}
            >
              スタッフ ({staffList.length}名)
            </th>
            {Array.from({ length: days }, (_, d) => (
              <th
                key={d}
                style={{
                  padding: '0.5rem',
                  textAlign: 'center',
                  borderLeft: '1px solid var(--border)',
                  minWidth: '90px',
                }}
              >
                <div>Day {d + 1}</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                  {shifts.map((s) => {
                    const shortageInfo = shortageMap.get(`${d}_${s.id}`);
                    return shortageInfo ? (
                      <span
                        key={s.id}
                        title={`不足: ${shortageInfo.shortage}名 (${shortageInfo.reason})`}
                        style={{
                          display: 'inline-block',
                          color: 'var(--danger)',
                          fontWeight: 'bold',
                          marginLeft: '2px',
                        }}
                      >
                        ⚠
                      </span>
                    ) : null;
                  })}
                </div>
              </th>
            ))}
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
                  {staff.roles.join(', ')} | ¥{staff.hourly_wage}
                  {staff.is_minor && (
                    <span style={{ color: 'var(--danger)', marginLeft: '4px', fontWeight: 'bold' }}>
                      (18歳未満)
                    </span>
                  )}
                </div>
              </td>

              {Array.from({ length: days }, (_, d) => {
                const assigned = assignmentMap.get(`${staff.id}_${d}`);
                return (
                  <td
                    key={d}
                    style={{
                      padding: '0.375rem',
                      textAlign: 'center',
                      borderLeft: '1px solid var(--border)',
                      backgroundColor: assigned ? '#f8fafc' : '#ffffff',
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
                        }}
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
    </div>
  );
};
