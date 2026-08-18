'use client';

import React, { useEffect, useState } from 'react';
import { ShiftOptimizeRequest, ShiftOptimizeResponse } from '@/lib/types';
import { DEMO_IZAKAYA_DATA } from '@/lib/mock-data';
import { loadSavedRequest, loadSavedResponse, saveRequest, saveResponse, saveConfirmedSnapshot } from '@/lib/storage';
import { requestShiftOptimization } from '@/lib/api';
import { AdminNavbar } from '@/components/navigation/AdminNavbar';
import { RoiSummaryCard } from '@/components/summary/RoiSummaryCard';
import { ShiftMatrix } from '@/components/schedule/ShiftMatrix';
import DailyTimelineView from '@/components/schedule/DailyTimelineView';
import MonthlyMatrixView from '@/components/schedule/MonthlyMatrixView';
import { ExportModal } from '@/components/schedule/ExportModal';
import { LineImportModal } from '@/components/schedule/LineImportModal';
import { checkTotalRequiredStaff, checkMissingRequiredRoles } from '@/lib/validation';
import { generateHourlyRequirements, generateHourlyAvailabilities } from '@/lib/mock-data';

export default function AdminPage() {
  const [requestData, setRequestData] = useState<ShiftOptimizeRequest>(DEMO_IZAKAYA_DATA);
  const [response, setResponse] = useState<ShiftOptimizeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [coldStartWarning, setColdStartWarning] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [isLineImportOpen, setIsLineImportOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'timeline' | 'monthly' | 'slots'>('timeline');
  const [currentDayOffset, setCurrentDayOffset] = useState(0);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 4000);
  };

  // マウント時に LocalStorage から復元
  useEffect(() => {
    const savedReq = loadSavedRequest();
    // 1時間単位のデータが存在しない場合はモックデータで補完
    if (!savedReq.hourly_requirements || savedReq.hourly_requirements.length === 0) {
      savedReq.hourly_requirements = generateHourlyRequirements(savedReq.period.days);
    }
    if (!savedReq.hourly_availabilities || savedReq.hourly_availabilities.length === 0) {
      savedReq.hourly_availabilities = generateHourlyAvailabilities(savedReq.period.days);
    }
    setRequestData(savedReq);
    const savedRes = loadSavedResponse();
    if (savedRes) {
      setResponse(savedRes);
    }
  }, []);

  // フロントエンド防壁・バリデーションチェック (No. 201, 208)
  const reqTotalCheck = checkTotalRequiredStaff(requestData.requirements || []);
  const roleCheck = checkMissingRequiredRoles(requestData.requirements || [], requestData.staff_members);
  const activeStaff = requestData.staff_members.filter((s) => s.is_active !== false);

  const handleOptimize = async () => {
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
    const cleanAvailabilities = (requestData.availabilities || []).filter((a) =>
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
      hourly_requirements: requestData.hourly_requirements?.length
        ? requestData.hourly_requirements
        : generateHourlyRequirements(requestData.period.days),
      hourly_availabilities: requestData.hourly_availabilities?.length
        ? requestData.hourly_availabilities
        : generateHourlyAvailabilities(requestData.period.days),
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

  const handleUpdateShiftTime = (staffId: string, dayOffset: number, startTime: string, endTime: string) => {
    if (!response || !response.assigned_shifts) return;

    const [sH, sM] = startTime.split(':').map(Number);
    const [eH, eM] = endTime.split(':').map(Number);
    const startMin = (sH || 0) * 60 + (sM || 0);
    const endMin = (eH || 0) * 60 + (eM || 0);
    const grossMinutes = Math.max(0, endMin - startMin);
    const grossHours = grossMinutes / 60.0;

    // 労基法第34条に基づく休憩時間
    let breakMin = 0;
    if (grossHours > 8.0) {
      breakMin = 60;
    } else if (grossHours > 6.0) {
      breakMin = 45;
    }

    const netHours = Math.max(0, (grossMinutes - breakMin) / 60.0);

    const existingIdx = response.assigned_shifts.findIndex(
      (s) => s.staff_id === staffId && s.day_offset === dayOffset
    );

    const updatedAssigned = [...response.assigned_shifts];
    const staff = requestData.staff_members.find((st) => st.id === staffId);
    const wage = staff ? staff.hourly_wage : 1000;
    const isLateNight = endMin > 22 * 60;
    const laborCost = Math.floor(netHours * wage + 0.5);

    if (existingIdx >= 0) {
      updatedAssigned[existingIdx] = {
        ...updatedAssigned[existingIdx],
        start_time: startTime,
        end_time: endTime,
        hours: netHours,
        break_minutes: breakMin,
        labor_cost: laborCost,
        is_late_night: isLateNight,
      };
    } else if (staff) {
      updatedAssigned.push({
        staff_id: staffId,
        name: staff.name,
        day_offset: dayOffset,
        date: '',
        start_time: startTime,
        end_time: endTime,
        hours: netHours,
        break_minutes: breakMin,
        hourly_wage: wage,
        labor_cost: laborCost,
        is_late_night: isLateNight,
      });
    }

    const updatedRes: ShiftOptimizeResponse = {
      ...response,
      assigned_shifts: updatedAssigned,
    };
    handleResponseChange(updatedRes);
    showToast(`${staff?.name || ''} の勤務時間を更新しました (${startTime}〜${endTime} / ${netHours}h)`);
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
            AIシフト自動作成・最適化
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
            <span>LINE希望取込</span>
          </button>

          <button
            onClick={handleOptimize}
            disabled={loading || reqTotalCheck.isZero || activeStaff.length === 0}
            className="btn btn-primary"
            data-testid="btn-optimize"
            style={{ minWidth: '190px' }}
          >
            {loading ? (
              <span data-testid="loading-spinner">AI計算中...</span>
            ) : reqTotalCheck.isZero ? (
              '必要人数0名 (実行不可)'
            ) : (
              'シフトを最適化する'
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
          [注意] {reqTotalCheck.warning}
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
          <div style={{ fontWeight: 700, marginBottom: '0.25rem' }}>[注意] 必須資格ロールの不足警告:</div>
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
          AI最適化サーバーをスリープから復帰中です... (無料枠の仕様上、初回のみ約30〜50秒かかります。そのままお待ちください)
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
          {toastMsg}
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

      {/* 表示モード切り替えタブ */}
      <div
        style={{
          display: 'flex',
          gap: '0.5rem',
          marginBottom: '1rem',
          borderBottom: '1px solid var(--border)',
          paddingBottom: '0.5rem',
        }}
      >
        <button
          type="button"
          data-testid="tab-view-timeline"
          onClick={() => setViewMode('timeline')}
          className={`btn btn-sm ${viewMode === 'timeline' ? 'btn-primary' : 'btn-secondary'}`}
          style={{ fontWeight: 700 }}
        >
          日別タイムライン (ガントチャート)
        </button>
        <button
          type="button"
          data-testid="tab-view-monthly"
          onClick={() => setViewMode('monthly')}
          className={`btn btn-sm ${viewMode === 'monthly' ? 'btn-primary' : 'btn-secondary'}`}
          style={{ fontWeight: 700 }}
        >
          月間スタッフ一覧マトリクス ({requestData.period.days}日間)
        </button>
        <button
          type="button"
          data-testid="tab-view-slots"
          onClick={() => setViewMode('slots')}
          className={`btn btn-sm ${viewMode === 'slots' ? 'btn-primary' : 'btn-secondary'}`}
          style={{ fontWeight: 700 }}
        >
          枠別マトリクス (従来ビュー)
        </button>
      </div>

      {/* 選択されたビューの描画 */}
      {viewMode === 'timeline' && (
        <DailyTimelineView
          currentDayOffset={currentDayOffset}
          startDate={requestData.period.start_date}
          totalDays={requestData.period.days}
          onDayChange={(offset) => setCurrentDayOffset(offset)}
          staffMembers={activeStaff}
          assignedShifts={response?.assigned_shifts || []}
          hourlyRequirements={requestData.hourly_requirements || []}
          hourlySchedule={response?.hourly_schedule || []}
          onUpdateShiftTime={handleUpdateShiftTime}
        />
      )}

      {viewMode === 'monthly' && (
        <MonthlyMatrixView
          startDate={requestData.period.start_date}
          totalDays={requestData.period.days}
          staffMembers={activeStaff}
          assignedShifts={response?.assigned_shifts || []}
        />
      )}

      {viewMode === 'slots' && (
        <ShiftMatrix
          request={requestData}
          response={response}
          onResponseChange={(updatedRes) => setResponse(updatedRes)}
          showToast={showToast}
        />
      )}
    </main>
  );
}
