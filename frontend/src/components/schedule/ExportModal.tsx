'use client';

import React, { useState } from 'react';
import { ShiftOptimizeRequest, ShiftOptimizeResponse } from '@/lib/types';

interface Props {
  request: ShiftOptimizeRequest;
  response: ShiftOptimizeResponse | null;
}

export const ExportModal: React.FC<Props> = ({ request, response }) => {
  const [copied, setCopied] = useState(false);

  if (!response) return null;

  // LINE用テキストの生成
  const generateLineText = (): string => {
    const lines: string[] = [];
    lines.push(`【FoodShift 確定シフト】`);
    lines.push(`期間: ${request.period.start_date} から ${request.period.days}日間\n`);

    for (let d = 0; d < request.period.days; d++) {
      const daySlots = response.schedule.filter((s) => s.day_offset === d);
      const dateStr = daySlots[0]?.date || `Day ${d + 1}`;
      lines.push(`📅 ${dateStr}`);

      for (const slot of daySlots) {
        const shiftObj = request.shifts.find((s) => s.id === slot.shift_id);
        const shiftName = shiftObj ? shiftObj.name : slot.shift_id;
        const timeRange = shiftObj ? `${shiftObj.start}-${shiftObj.end}` : '';
        const names = slot.assigned_staff.map((s) => s.name).join(', ');
        lines.push(`  ・${shiftName} (${timeRange}): ${names || '割当なし'}`);
      }
      lines.push('');
    }

    lines.push(`--\n人件費合計: ¥${response.summary.total_labor_cost.toLocaleString()}`);
    lines.push(`希望充足率: ${Math.round(response.summary.wants_fulfillment_rate * 100)}%`);
    return lines.join('\n');
  };

  const handleCopyLine = async () => {
    const text = generateLineText();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch (e) {
      console.error('Clipboard copy failed', e);
    }
  };

  // CSVダウンロード
  const handleDownloadCsv = () => {
    const rows: string[][] = [];
    // ヘッダー行
    const header = ['スタッフ名', '役職', '時給'];
    for (let d = 0; d < request.period.days; d++) {
      header.push(`Day ${d + 1}`);
    }
    rows.push(header);

    // スタッフ別データ行
    for (const staff of request.staff_members) {
      const row = [staff.name, staff.roles.join('/'), staff.hourly_wage.toString()];
      for (let d = 0; d < request.period.days; d++) {
        const slot = response.schedule.find(
          (s) =>
            s.day_offset === d && s.assigned_staff.some((ast) => ast.id === staff.id)
        );
        if (slot) {
          const shiftObj = request.shifts.find((s) => s.id === slot.shift_id);
          row.push(shiftObj ? shiftObj.name : slot.shift_id);
        } else {
          row.push('休');
        }
      }
      rows.push(row);
    }

    const csvContent =
      'data:text/csv;charset=utf-8,\uFEFF' +
      rows.map((e) => e.map((val) => `"${val}"`).join(',')).join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `shift_${request.period.start_date}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', margin: '1rem 0' }}>
      <button
        onClick={handleCopyLine}
        className="btn btn-secondary"
        data-testid="btn-copy-line"
        style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}
      >
        <span>💬 LINE共有用テキスト作成</span>
        {copied && <span style={{ color: 'var(--success)', fontWeight: 'bold' }}>✓ コピー完了</span>}
      </button>

      <button
        onClick={handleDownloadCsv}
        className="btn btn-secondary"
        data-testid="btn-download-csv"
        style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}
      >
        <span>📥 CSVダウンロード (Excel用)</span>
      </button>
    </div>
  );
};
