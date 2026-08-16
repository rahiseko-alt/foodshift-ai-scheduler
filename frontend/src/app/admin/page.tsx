'use client';

import React, { useEffect, useState } from 'react';
import { ShiftOptimizeRequest, ShiftOptimizeResponse } from '@/lib/types';
import { DEMO_IZAKAYA_DATA } from '@/lib/mock-data';
import { loadSavedRequest, loadSavedResponse, saveRequest, saveResponse, saveConfirmedSnapshot } from '@/lib/storage';
import { requestShiftOptimization } from '@/lib/api';
import { AdminNavbar } from '@/components/navigation/AdminNavbar';
import { RoiSummaryCard } from '@/components/summary/RoiSummaryCard';
import { ShiftMatrix } from '@/components/schedule/ShiftMatrix';
import { ExportModal } from '@/components/schedule/ExportModal';
import { LineImportModal } from '@/components/schedule/LineImportModal';
import { checkTotalRequiredStaff, checkMissingRequiredRoles } from '@/lib/validation';

export default function AdminPage() {
  const [requestData, setRequestData] = useState<ShiftOptimizeRequest>(DEMO_IZAKAYA_DATA);
  const [response, setResponse] = useState<ShiftOptimizeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [coldStartWarning, setColdStartWarning] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [isLineImportOpen, setIsLineImportOpen] = useState(false);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 4000);
  };

  // マウント時に LocalStorage から復元
  useEffect(() => {
    const savedReq = loadSavedRequest();
    setRequestData(savedReq);
    const savedRes = loadSavedResponse();
    if (savedRes) {
      setResponse(savedRes);
    }
  }, []);

  // フロントエンド防壁・バリデーションチェック (No. 201, 208)
  const reqTotalCheck = checkTotalRequiredStaff(requestData.requirements);
  const roleCheck = checkMissingRequiredRoles(requestData.requirements, requestData.staff_members);
  const activeStaff = requestData.staff_members.filter((s) => s.is_active !== false);

  const handleOptimize = async () => {
    // 防壁1: 必要人数合計0名ガード (No. 201)
    if (reqTotalCheck.isZero) {
      setErrorMsg('必要人数の合計が0名のため、最適化を実行できません。「シフト枠・必要人数設定」画面で必要人数を設定してください。');
      return;
    }

    // 防壁2: 在籍スタッフ0名ガード (No. 215)
    if (activeStaff.length === 0) {
      setErrorMsg('在籍（有効）スタッフが0名です。スタッフマスタで在籍スタッフを登録してください。');
      return;
    }

    setLoading(true);
    setColdStartWarning(false);
    setErrorMsg(null);

    // 非アクティブスタッフを除外して最適化ソルバーに送信 (No. 215)
    const activeStaffIds = new Set(activeStaff.map((s) => s.id));
    const cleanAvailabilities = requestData.availabilities.filter((a) =>
      activeStaffIds.has(a.staff_id)
    );
    const cleanFixedAssignments = requestData.fixed_assignments?.filter((f) =>
      activeStaffIds.has(f.staff_id)
    );

    const payloadRequest: ShiftOptimizeRequest = {
      ...requestData,
      staff_members: activeStaff,
      availabilities: cleanAvailabilities,
      fixed_assignments: cleanFixedAssignments,
    };

    try {
      const res = await requestShiftOptimization(payloadRequest, () => {
        setColdStartWarning(true);
      });
      setResponse(res);
      saveRequest(requestData);
      saveResponse(res);
      saveConfirmedSnapshot(`AI最適化完了 (${new Date().toLocaleTimeString('ja-JP')})`, requestData, res);
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
            期間: {requestData.period.start_date} から {requestData.period.days}日間 ({activeStaff.length}名在籍中 | {requestData.shifts.length}シフト枠)
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            data-testid="btn-open-line-import"
            onClick={() => setIsLineImportOpen(true)}
            className="btn btn-secondary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
          >
            <span>📥 LINE希望取込</span>
          </button>

          <button
            onClick={handleOptimize}
            disabled={loading || reqTotalCheck.isZero || activeStaff.length === 0}
            className="btn btn-primary"
            data-testid="btn-optimize"
            style={{ minWidth: '190px' }}
          >
            {loading ? (
              <span data-testid="loading-spinner">⚙ AI計算中...</span>
            ) : reqTotalCheck.isZero ? (
              '⚠ 必要人数0名 (実行不可)'
            ) : (
              '⚡ シフトを最適化する'
            )}
          </button>
        </div>
      </header>

      {/* LINE提出データ一括取込モーダル */}
      <LineImportModal
        isOpen={isLineImportOpen}
        onClose={() => setIsLineImportOpen(false)}
        requestData={requestData}
        onUpdate={(updatedReq) => setRequestData(updatedReq)}
        showToast={(msg) => showToast(msg)}
      />

      {/* No. 201: 合計必要人数0名警告 */}
      {reqTotalCheck.isZero && (
        <div
          data-testid="zero-requirement-alert"
          style={{
            backgroundColor: 'var(--danger-bg)',
            color: 'var(--danger)',
            border: '1px solid var(--danger-border)',
            borderRadius: 'var(--radius-sm)',
            padding: '0.75rem 1rem',
            marginBottom: '1rem',
            fontWeight: 700,
            fontSize: '0.875rem',
          }}
        >
          ⚠ {reqTotalCheck.warning}
        </div>
      )}

      {/* No. 208: 必須ロール不足警告 */}
      {roleCheck.warnings.length > 0 && (
        <div
          data-testid="role-shortage-alert"
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
          <div style={{ fontWeight: 700, marginBottom: '0.25rem' }}>⚠ 必須資格ロールの不足警告:</div>
          <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
            {roleCheck.warnings.map((warn, i) => (
              <li key={i}>{warn}</li>
            ))}
          </ul>
        </div>
      )}

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

      {/* トースト通知 */}
      {toastMsg && (
        <div
          data-testid="admin-toast-banner"
          style={{
            position: 'fixed',
            top: '1rem',
            right: '1rem',
            zIndex: 9999,
            backgroundColor: '#10b981',
            color: '#ffffff',
            padding: '0.75rem 1.25rem',
            borderRadius: 'var(--radius-sm)',
            boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
            fontWeight: 700,
            fontSize: '0.875rem',
          }}
        >
          ✓ {toastMsg}
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

      {/* エクスポートボタン (LINE / CSV / JSONバックアップ) */}
      <ExportModal
        request={requestData}
        response={response}
        onRestore={(req, res) => {
          setRequestData(req);
          setResponse(res);
        }}
      />

      {/* シフトマトリクス表 */}
      <ShiftMatrix
        request={requestData}
        response={response}
        onResponseChange={(updatedRes) => setResponse(updatedRes)}
        showToast={showToast}
      />
    </main>
  );
}
