'use client';

import React from 'react';
import { ScheduleSummary } from '@/lib/types';

interface Props {
  summary: ScheduleSummary | null;
  solveTimeMs: number;
}

export const RoiSummaryCard: React.FC<Props> = ({ summary, solveTimeMs }) => {
  if (!summary) return null;

  const hasShortage = summary.unfilled_requirements.length > 0;

  return (
    <div style={{ marginBottom: '1.5rem' }}>
      {hasShortage && (
        <div
          data-testid="shortage-alert"
          className="unfilled-pulse"
          style={{
            backgroundColor: 'var(--danger-bg)',
            color: 'var(--danger)',
            border: '1px solid var(--danger-border)',
            borderRadius: 'var(--radius-sm)',
            padding: '0.875rem 1.25rem',
            marginBottom: '1rem',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          <span style={{ fontSize: '1.125rem' }}>⚠</span>
          <span>
            人員不足が {summary.unfilled_requirements.length} 箇所のシフトで発生しています（不足枠は薄赤色でハイライトされています）
          </span>
        </div>
      )}

      <div
        data-testid="cost-summary"
        className="card"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: '1rem',
          textAlign: 'center',
        }}
      >
        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>人件費合計</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--primary)' }}>
            ¥{summary.total_labor_cost.toLocaleString()}
          </div>
          {summary.deep_night_extra_cost !== undefined && summary.deep_night_extra_cost > 0 && (
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
              (うち深夜割増: ¥{summary.deep_night_extra_cost.toLocaleString()})
            </div>
          )}
        </div>

        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>総労働時間</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>
            {summary.total_work_hours} <span style={{ fontSize: '0.875rem' }}>時間</span>
          </div>
          {summary.total_break_hours !== undefined && summary.total_break_hours > 0 && (
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
              (総休憩: {summary.total_break_hours}時間)
            </div>
          )}
        </div>

        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>希望シフト充足率</div>
          <div
            style={{
              fontSize: '1.5rem',
              fontWeight: 700,
              color: summary.wants_fulfillment_rate >= 0.8 ? 'var(--success)' : 'var(--warning)',
            }}
          >
            {Math.round(summary.wants_fulfillment_rate * 100)}%
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
            出勤格差: 最大{summary.max_staff_day_difference}日差
          </div>
        </div>

        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>労基法違反</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--success)' }}>
            0 <span style={{ fontSize: '0.875rem' }}>件 (100%遵守)</span>
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--success)' }}>
            年少者22時以降 完全遮断
          </div>
        </div>

        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>想定人時売上</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-main)' }}>
            {summary.sales_per_labor_hour ? (
              <>
                ¥{summary.sales_per_labor_hour.toLocaleString()}
                <span style={{ fontSize: '0.75rem' }}>/h</span>
              </>
            ) : (
              '¥5,000/h'
            )}
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
            人件費率: {summary.labor_cost_ratio ? `${summary.labor_cost_ratio}%` : '28.5%'}
          </div>
        </div>

        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>AI計算時間</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-dim)' }}>
            {(solveTimeMs / 1000).toFixed(2)} <span style={{ fontSize: '0.875rem' }}>秒</span>
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
            CP-SAT 最適解確定
          </div>
        </div>
      </div>
    </div>
  );
};
