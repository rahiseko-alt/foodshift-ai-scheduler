'use client';

import React, { useEffect, useState } from 'react';
import { ShiftOptimizeRequest, ShiftOptimizeResponse } from '@/lib/types';
import { DEMO_IZAKAYA_DATA } from '@/lib/mock-data';
import { loadSavedRequest, loadSavedResponse, saveRequest, saveResponse } from '@/lib/storage';
import { requestShiftOptimization } from '@/lib/api';
import { AdminNavbar } from '@/components/navigation/AdminNavbar';
import { RoiSummaryCard } from '@/components/summary/RoiSummaryCard';
import { ShiftMatrix } from '@/components/schedule/ShiftMatrix';
import { ExportModal } from '@/components/schedule/ExportModal';

export default function AdminPage() {
  const [requestData, setRequestData] = useState<ShiftOptimizeRequest>(DEMO_IZAKAYA_DATA);
  const [response, setResponse] = useState<ShiftOptimizeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [coldStartWarning, setColdStartWarning] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // マウント時に LocalStorage から復元
  useEffect(() => {
    const savedReq = loadSavedRequest();
    setRequestData(savedReq);
    const savedRes = loadSavedResponse();
    if (savedRes) {
      setResponse(savedRes);
    }
  }, []);

  const handleOptimize = async () => {
    setLoading(true);
    setColdStartWarning(false);
    setErrorMsg(null);

    try {
      const res = await requestShiftOptimization(requestData, () => {
        setColdStartWarning(true);
      });
      setResponse(res);
      saveRequest(requestData);
      saveResponse(res);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setErrorMsg(err.message);
      } else {
        setErrorMsg('シフト最適化中に不明なエラーが発生しました');
      }
    } finally {
      setLoading(false);
      setColdStartWarning(false);
    }
  };

  const handleResponseChange = (updatedResponse: ShiftOptimizeResponse) => {
    setResponse(updatedResponse);
    saveResponse(updatedResponse);
  };

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
            🏢 AIシフト自動作成 ＆ 最適化
          </h1>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
            期間: {requestData.period.start_date} から {requestData.period.days}日間 ({requestData.staff_members.length}名登録中 | {requestData.shifts.length}シフト枠)
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button
            onClick={handleOptimize}
            disabled={loading}
            className="btn btn-primary"
            data-testid="btn-optimize"
            style={{ minWidth: '190px' }}
          >
            {loading ? (
              <span data-testid="loading-spinner">⚙ AI計算中...</span>
            ) : (
              '⚡ シフトを最適化する'
            )}
          </button>
        </div>
      </header>

      {/* コールドスタート復帰中メッセージ */}
      {coldStartWarning && (
        <div
          data-testid="cold-start-banner"
          className="unfilled-pulse"
          style={{
            backgroundColor: 'var(--warning-bg)',
            color: '#854d0e',
            border: '1px solid var(--warning-border)',
            borderRadius: 'var(--radius-sm)',
            padding: '1rem 1.25rem',
            marginBottom: '1.5rem',
            fontWeight: 600,
          }}
        >
          ⚡ AI最適化サーバーをスリープから復帰中です... (無料枠の仕様上、初回のみ約30〜50秒かかります。そのままお待ちください)
        </div>
      )}

      {/* エラーメッセージ */}
      {errorMsg && (
        <div
          data-testid="error-message"
          style={{
            backgroundColor: 'var(--danger-bg)',
            color: 'var(--danger)',
            border: '1px solid var(--danger-border)',
            borderRadius: 'var(--radius-sm)',
            padding: '1rem 1.25rem',
            marginBottom: '1.5rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <strong>エラー:</strong> {errorMsg}
          </div>
          <button
            onClick={handleOptimize}
            className="btn btn-secondary btn-sm"
          >
            再試行
          </button>
        </div>
      )}

      {/* 経営改善サマリーカード */}
      <RoiSummaryCard summary={response?.summary || null} solveTimeMs={response?.solve_time_ms || 0} />

      {/* エクスポートボタン (LINE / CSV) */}
      <ExportModal request={requestData} response={response} />

      {/* シフトマトリクス表 */}
      <ShiftMatrix
        request={requestData}
        response={response}
        onResponseChange={handleResponseChange}
      />
    </main>
  );
}
