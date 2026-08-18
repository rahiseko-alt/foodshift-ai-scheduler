'use client';

import React, { useState } from 'react';
import { ShiftOptimizeRequest, StaffMember } from '@/lib/types';
import { decodeSubmissionCode, extractSubmissionCodesFromText, DecodedSubmission } from '@/lib/line-codec';
import { saveRequest } from '@/lib/storage';

interface LineImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  requestData: ShiftOptimizeRequest;
  onUpdate: (updatedReq: ShiftOptimizeRequest) => void;
  showToast: (msg: string) => void;
}

interface ParsedResult {
  code: string;
  decoded: DecodedSubmission;
  staff?: StaffMember;
  isPeriodMatch: boolean;
  status: 'valid' | 'invalid' | 'unknown_staff' | 'period_mismatch';
}

export const LineImportModal: React.FC<LineImportModalProps> = ({
  isOpen,
  onClose,
  requestData,
  onUpdate,
  showToast,
}) => {
  const [inputText, setInputText] = useState('');
  const [parsedResults, setParsedResults] = useState<ParsedResult[]>([]);
  const [isAnalyzed, setIsAnalyzed] = useState(false);

  if (!isOpen) return null;

  const days = requestData.period.days || 7;
  const shiftIds = requestData.shifts.map((s) => s.id);
  const currentPeriodStart = requestData.period.start_date;

  const handleAnalyze = () => {
    const rawCodes = extractSubmissionCodesFromText(inputText);

    if (rawCodes.length === 0) {
      setParsedResults([]);
      setIsAnalyzed(true);
      return;
    }

    const results: ParsedResult[] = rawCodes.map((code) => {
      const decoded = decodeSubmissionCode(code, days, shiftIds);
      if (!decoded.isValid) {
        return {
          code,
          decoded,
          isPeriodMatch: false,
          status: 'invalid',
        };
      }

      const staff = requestData.staff_members.find((s) => s.id === decoded.staff_id);
      if (!staff) {
        return {
          code,
          decoded,
          isPeriodMatch: decoded.period_start === currentPeriodStart,
          status: 'unknown_staff',
        };
      }

      const isPeriodMatch = decoded.period_start === currentPeriodStart;
      if (!isPeriodMatch) {
        return {
          code,
          decoded,
          staff,
          isPeriodMatch: false,
          status: 'period_mismatch',
        };
      }

      return {
        code,
        decoded,
        staff,
        isPeriodMatch: true,
        status: 'valid',
      };
    });

    setParsedResults(results);
    setIsAnalyzed(true);
  };

  const handleApply = () => {
    const validResults = parsedResults.filter((r) => r.status === 'valid');
    if (validResults.length === 0) return;

    // 更新対象の staff_id 一覧
    const updatedStaffIds = new Set(validResults.map((r) => r.decoded.staff_id));

    // 他スタッフの希望は維持
    const remainingAvail = requestData.availabilities.filter(
      (a) => !updatedStaffIds.has(a.staff_id)
    );

    // 新しい希望を追加（最新の提出を採用）
    const newAvails = validResults.flatMap((r) => r.decoded.availabilities);
    const combinedAvail = [...remainingAvail, ...newAvails];

    const updatedReq: ShiftOptimizeRequest = {
      ...requestData,
      availabilities: combinedAvail,
    };

    onUpdate(updatedReq);
    saveRequest(updatedReq);
    showToast(`LINEから ${validResults.length} 名分のシフト希望を取り込みました！`);
    onClose();
  };

  const validCount = parsedResults.filter((r) => r.status === 'valid').length;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: '1rem',
      }}
    >
      <div
        className="card"
        style={{
          width: '100%',
          maxWidth: '640px',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)',
          padding: 0,
          overflow: 'hidden',
        }}
      >
        {/* モーダルヘッダー */}
        <div
          style={{
            padding: '1.25rem 1.5rem',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            backgroundColor: 'var(--surface)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '1.25rem' }}></span>
            <div>
              <h2 style={{ fontSize: '1.125rem', fontWeight: 800, margin: 0 }}>
                LINE提出データ一括取込
              </h2>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                LINEグループのトーク履歴をそのまま貼り付けるだけで、全員の希望を一括反映します
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '1.25rem',
              cursor: 'pointer',
              color: 'var(--text-muted)',
            }}
          >
            不可
          </button>
        </div>

        {/* モーダルボディ */}
        <div style={{ padding: '1.5rem', overflowY: 'auto', flex: 1 }}>
          <div className="form-group" style={{ marginBottom: '1rem' }}>
            <label className="form-label">
              LINEのメッセージを貼り付け (雑談混ざりでもOK)
            </label>
            <textarea
              className="form-input"
              rows={4}
              value={inputText}
              onChange={(e) => {
                setInputText(e.target.value);
                setIsAnalyzed(false);
              }}
              placeholder={`例:\n田中: 提出します！ FS1|emp_001|${currentPeriodStart}|aABbCx0q2R|7f3a よろしくお願いします！\n佐藤: FS1|emp_002|${currentPeriodStart}|xY12Cz8q1B|9a2c 提出完了しました`}
              style={{ fontFamily: 'monospace', fontSize: '0.8125rem' }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
            <button
              type="button"
              onClick={handleAnalyze}
              disabled={!inputText.trim()}
              className="btn btn-secondary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
            >
              <span>提出コードを解析する</span>
            </button>
          </div>

          {/* 解析結果プレビュー */}
          {isAnalyzed && (
            <div>
              <h3 style={{ fontSize: '0.875rem', fontWeight: 700, margin: '0 0 0.5rem 0' }}>
                解析結果 ({parsedResults.length}件 検出)
              </h3>

              {parsedResults.length === 0 ? (
                <div
                  style={{
                    padding: '1.5rem',
                    textAlign: 'center',
                    backgroundColor: 'var(--surface-muted)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-muted)',
                    fontSize: '0.875rem',
                  }}
                >
                  有効な提出コード（`FS1|...`）が見つかりませんでした。
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {parsedResults.map((res, idx) => {
                    const wantCount = res.decoded.availabilities.filter((a) => a.status === 'want').length;
                    const availCount = res.decoded.availabilities.filter((a) => a.status === 'available').length;
                    const unavailCount = res.decoded.availabilities.filter((a) => a.status === 'unavailable').length;

                    return (
                      <div
                        key={idx}
                        style={{
                          padding: '0.75rem 1rem',
                          borderRadius: 'var(--radius-sm)',
                          border:
                            res.status === 'valid'
                              ? '1px solid #86efac'
                              : '1px solid var(--danger-border)',
                          backgroundColor:
                            res.status === 'valid' ? '#f0fdf4' : 'var(--danger-bg)',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>
                              {res.staff ? res.staff.name : `未登録ID: ${res.decoded.staff_id}`}
                            </span>
                            {res.status === 'valid' && (
                              <span className="badge badge-success" style={{ fontSize: '0.7rem' }}>
                                取込可能
                              </span>
                            )}
                            {res.status === 'unknown_staff' && (
                              <span className="badge badge-danger" style={{ fontSize: '0.7rem' }}>
                                未登録スタッフ
                              </span>
                            )}
                            {res.status === 'period_mismatch' && (
                              <span className="badge badge-danger" style={{ fontSize: '0.7rem' }}>
                                期間不一致 ({res.decoded.period_start})
                              </span>
                            )}
                            {res.status === 'invalid' && (
                              <span className="badge badge-danger" style={{ fontSize: '0.7rem' }}>
                                コード破損
                              </span>
                            )}
                          </div>
                          {res.status === 'valid' && (
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                              希望: 希望 {wantCount}枠 / 可 {availCount}枠 / 不可 {unavailCount}枠
                            </div>
                          )}
                          {res.decoded.error && (
                            <div style={{ fontSize: '0.75rem', color: 'var(--danger)', marginTop: '0.25rem' }}>
                              {res.decoded.error}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* モーダルフッター */}
        <div
          style={{
            padding: '1rem 1.5rem',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            backgroundColor: 'var(--surface)',
          }}
        >
          <button type="button" onClick={onClose} className="btn btn-secondary">
            キャンセル
          </button>

          <button
            type="button"
            onClick={handleApply}
            disabled={validCount === 0}
            className="btn btn-primary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}
          >
            <span>有効な {validCount} 件を一括反映する</span>
          </button>
        </div>
      </div>
    </div>
  );
};
