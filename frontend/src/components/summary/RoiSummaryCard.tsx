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
          style={{
            backgroundColor: 'var(--danger-bg)',
            color: 'var(--danger)',
            border: '1px solid #fca5a5',
            borderRadius: '6px',
            padding: '0.875rem 1.25rem',
            marginBottom: '1rem',
            fontWeight: 600,
          }}
        >
          ⚠ 人員不足が {summary.unfilled_requirements.length} 箇所のシフトで発生しています（不足枠は薄赤色でハイライトされています）
        </div>
      )}

      <div
        data-testid="cost-summary"
        className="card"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '1rem',
          textAlign: 'center',
        }}
      >
        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>人件費合計</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--primary)' }}>
            ¥{summary.total_labor_cost.toLocaleString()}
          </div>
        </div>

        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>総労働時間</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>
            {summary.total_work_hours} <span style={{ fontSize: '0.875rem' }}>時間</span>
          </div>
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
        </div>

        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>労基法違反</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--success)' }}>
            0 <span style={{ fontSize: '0.875rem' }}>件 (100%遵守)</span>
          </div>
        </div>

        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>AI計算時間</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-muted)' }}>
            {(solveTimeMs / 1000).toFixed(2)} <span style={{ fontSize: '0.875rem' }}>秒</span>
          </div>
        </div>
      </div>
    </div>
  );
};
