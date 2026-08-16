'use client';

import React, { useState, useEffect, useRef } from 'react';
import { ShiftOptimizeRequest, ShiftOptimizeResponse } from '@/lib/types';
import {
  downloadStoreBackup,
  validateImportBundle,
  importStoreBundle,
  listSnapshots,
  restoreSnapshot,
  saveConfirmedSnapshot,
  getCurrentStoreId,
} from '@/lib/storage';
import { StoredSnapshot } from '@/lib/db';

interface Props {
  request: ShiftOptimizeRequest;
  response: ShiftOptimizeResponse | null;
  onRestore?: (request: ShiftOptimizeRequest, response: ShiftOptimizeResponse | null) => void;
}

export const ExportModal: React.FC<Props> = ({ request, response, onRestore }) => {
  const [copied, setCopied] = useState(false);
  const [isBackupModalOpen, setIsBackupModalOpen] = useState(false);
  const [snapshots, setSnapshots] = useState<StoredSnapshot[]>([]);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isSavingSnapshot, setIsSavingSnapshot] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // スナップショット履歴の取得
  const loadSnapshotHistory = async () => {
    try {
      const list = await listSnapshots();
      setSnapshots(list);
    } catch (e) {
      console.error('Failed to load snapshots', e);
    }
  };

  useEffect(() => {
    if (isBackupModalOpen) {
      loadSnapshotHistory();
    }
  }, [isBackupModalOpen]);

  // LINE用テキストの生成
  const generateLineText = (): string => {
    if (!response) return '';
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
    if (!response) return;
    const rows: string[][] = [];
    const header = ['スタッフ名', '役職', '時給'];
    for (let d = 0; d < request.period.days; d++) {
      header.push(`Day ${d + 1}`);
    }
    rows.push(header);

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

  // JSON一括バックアップダウンロード
  const handleExportJson = async () => {
    try {
      await downloadStoreBackup();
      setStatusMessage({ type: 'success', text: '店舗データの一括バックアップJSONをダウンロードしました。' });
    } catch (e) {
      setStatusMessage({ type: 'error', text: `エクスポートに失敗しました: ${e}` });
    }
  };

  // 現在の状態を手動スナップショット保存
  const handleSaveCurrentSnapshot = async () => {
    setIsSavingSnapshot(true);
    try {
      const nowLabel = `手動保存 (${new Date().toLocaleTimeString('ja-JP')})`;
      await saveConfirmedSnapshot(nowLabel, request, response);
      await loadSnapshotHistory();
      setStatusMessage({ type: 'success', text: '現在のシフト状態をスナップショットとして履歴保存しました。' });
    } catch (e) {
      setStatusMessage({ type: 'error', text: `スナップショット保存に失敗しました: ${e}` });
    } finally {
      setIsSavingSnapshot(false);
    }
  };

  // JSONインポート処理
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const rawData = JSON.parse(text);
      const validation = validateImportBundle(rawData);

      if (!validation.valid || !validation.bundle) {
        setStatusMessage({ type: 'error', text: `インポート失敗: ${validation.error}` });
        return;
      }

      const res = await importStoreBundle(validation.bundle);
      if (res.success) {
        setStatusMessage({ type: 'success', text: `バックアップデータを正常に復元しました（店舗ID: ${res.store_id}）` });
        if (onRestore) {
          onRestore(validation.bundle.request, validation.bundle.response);
        } else {
          setTimeout(() => window.location.reload(), 1000);
        }
      } else {
        setStatusMessage({ type: 'error', text: `復元に失敗しました: ${res.error}` });
      }
    } catch (err) {
      setStatusMessage({ type: 'error', text: `ファイル解析エラー: 正しいJSONファイルを選択してください。` });
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // スナップショット復元
  const handleRestoreSnapshot = async (snapshotId: string) => {
    if (!confirm('この履歴バージョンのシフトデータに復元しますか？（現在のデータは自動バックアップされます）')) {
      return;
    }

    try {
      const restored = await restoreSnapshot(snapshotId);
      if (restored) {
        setStatusMessage({ type: 'success', text: '選択したスナップショットから正常に復元しました。' });
        if (onRestore) {
          onRestore(restored.request, restored.response);
        } else {
          setTimeout(() => window.location.reload(), 1000);
        }
      } else {
        setStatusMessage({ type: 'error', text: 'スナップショットの取得に失敗しました。' });
      }
    } catch (e) {
      setStatusMessage({ type: 'error', text: `復元処理中にエラーが発生しました: ${e}` });
    }
  };

  return (
    <>
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', margin: '1rem 0' }}>
        {response && (
          <>
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
          </>
        )}

        <button
          onClick={() => setIsBackupModalOpen(true)}
          className="btn btn-secondary"
          data-testid="btn-open-backup-modal"
          style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}
        >
          <span>📦 データバックアップ ＆ 復元</span>
        </button>
      </div>

      {/* バックアップ ＆ 復元モーダル */}
      {isBackupModalOpen && (
        <div className="modal-overlay" style={{ zIndex: 1000 }}>
          <div
            className="card"
            style={{
              maxWidth: '640px',
              width: '90%',
              maxHeight: '90vh',
              overflowY: 'auto',
              position: 'relative',
              backgroundColor: '#ffffff',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.75rem' }}>
              <h2 style={{ fontSize: '1.125rem', fontWeight: 700 }}>
                📦 店舗データ完全バックアップ ＆ 復元
              </h2>
              <button
                onClick={() => {
                  setIsBackupModalOpen(false);
                  setStatusMessage(null);
                }}
                className="btn btn-secondary btn-sm"
                style={{ padding: '0.25rem 0.5rem' }}
              >
                ✕
              </button>
            </div>

            <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: '1.25rem', lineHeight: 1.6 }}>
              現在店舗ID: <strong>`{getCurrentStoreId()}`</strong><br />
              IndexedDB と LocalStorage の二重永続化により、ブラウザ再起動や端末移行時にも安心。1クリックで全データを安全に持ち出し・復元できます。
            </div>

            {/* ステータスメッセージ */}
            {statusMessage && (
              <div
                style={{
                  padding: '0.75rem 1rem',
                  borderRadius: 'var(--radius-sm)',
                  marginBottom: '1.25rem',
                  fontSize: '0.8125rem',
                  fontWeight: 600,
                  backgroundColor: statusMessage.type === 'success' ? 'var(--success-bg)' : 'var(--danger-bg)',
                  color: statusMessage.type === 'success' ? 'var(--success)' : 'var(--danger)',
                  border: `1px solid ${statusMessage.type === 'success' ? 'var(--success-border)' : 'var(--danger-border)'}`,
                }}
              >
                {statusMessage.text}
              </div>
            )}

            {/* 一括エクスポート & インポート */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
              <div
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '1rem',
                  backgroundColor: 'var(--bg-main)',
                }}
              >
                <h3 style={{ fontSize: '0.9375rem', fontWeight: 600, marginBottom: '0.5rem' }}>
                  📤 端末外へ一括退避 (JSON)
                </h3>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
                  スタッフ定義・希望・シフト確定結果・履歴スナップショットを含む完全JSONを出力します。
                </p>
                <button
                  onClick={handleExportJson}
                  className="btn btn-primary"
                  style={{ width: '100%', fontSize: '0.8125rem' }}
                  data-testid="btn-export-backup-json"
                >
                  一括JSONダウンロード
                </button>
              </div>

              <div
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '1rem',
                  backgroundColor: 'var(--bg-main)',
                }}
              >
                <h3 style={{ fontSize: '0.9375rem', fontWeight: 600, marginBottom: '0.5rem' }}>
                  📥 ファイルから復元
                </h3>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
                  保存済みの FoodShift バックアップJSONを読み込み、即座に復元します。
                </p>
                <input
                  type="file"
                  accept=".json,application/json"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  style={{ display: 'none' }}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="btn btn-secondary"
                  style={{ width: '100%', fontSize: '0.8125rem' }}
                  data-testid="btn-import-backup-json"
                >
                  JSONファイルを選択して復元
                </button>
              </div>
            </div>

            {/* スナップショット履歴ロールバック */}
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1.25rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <h3 style={{ fontSize: '0.9375rem', fontWeight: 600 }}>
                  🕒 履歴スナップショット（IndexedDB）
                </h3>
                <button
                  onClick={handleSaveCurrentSnapshot}
                  disabled={isSavingSnapshot}
                  className="btn btn-secondary btn-sm"
                  data-testid="btn-save-snapshot"
                >
                  {isSavingSnapshot ? '保存中...' : '+ 現在の状態を履歴保存'}
                </button>
              </div>

              {snapshots.length === 0 ? (
                <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', textAlign: 'center', padding: '1rem', background: 'var(--bg-main)', borderRadius: 'var(--radius-sm)' }}>
                  保存された履歴スナップショットはまだありません。
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '180px', overflowY: 'auto' }}>
                  {snapshots.map((snap) => (
                    <div
                      key={snap.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '0.5rem 0.75rem',
                        backgroundColor: 'var(--bg-main)',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--border)',
                        fontSize: '0.8125rem',
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 600 }}>{snap.label}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{snap.created_at}</div>
                      </div>
                      <button
                        onClick={() => handleRestoreSnapshot(snap.id)}
                        className="btn btn-secondary btn-sm"
                        style={{ fontSize: '0.75rem' }}
                      >
                        復元
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={() => {
                  setIsBackupModalOpen(false);
                  setStatusMessage(null);
                }}
                className="btn btn-secondary"
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
