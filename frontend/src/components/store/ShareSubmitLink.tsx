'use client';

import React, { useState } from 'react';
import { ShiftOptimizeRequest } from '@/lib/types';
import { encodeRoster, buildSubmitUrl } from '@/lib/roster-share';

interface Props {
  request: ShiftOptimizeRequest;
  onNotify: (msg: string) => void;
}

/**
 * スタッフに配る「希望提出リンク」の生成。
 *
 * バックエンドは店舗データを保存しないため、スタッフの端末には
 * 店舗の名簿が存在せず、/submit を開いてもサンプルの15人しか出なかった。
 * 名簿をURLに載せて渡すことで、サーバー保存を導入せずにこれを解決する。
 */
export const ShareSubmitLink: React.FC<Props> = ({ request, onNotify }) => {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);

  const staffCount = request.staff_members.length;
  const shiftCount = request.shifts.length;

  const handleGenerate = async () => {
    if (staffCount === 0) {
      onNotify('先にスタッフを登録してください');
      return;
    }
    if (shiftCount === 0) {
      onNotify('先にシフト枠を登録してください');
      return;
    }
    setBusy(true);
    try {
      const fragment = await encodeRoster(request);
      const link = buildSubmitUrl(window.location.origin, fragment);
      setUrl(link);
    } catch (e) {
      onNotify(`リンクの生成に失敗しました: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const message = url
    ? `【${request.store_name || 'シフト希望提出'}】\n` +
      `${request.period.start_date} から ${request.period.days}日間のシフト希望をお願いします。\n` +
      `下のリンクを開いて、自分の名前を選んで送信してください。\n${url}`
    : '';

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      onNotify('コピーしました。LINEに貼り付けて送ってください');
    } catch {
      onNotify('コピーに失敗しました。テキストを手動で選択してください');
    }
  };

  return (
    <div className="card" data-testid="share-submit-link" style={{ padding: '1rem' }}>
      <div style={{ fontWeight: 700, marginBottom: '0.25rem' }}>スタッフに希望提出をお願いする</div>
      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
        リンクを作ってLINEで送ると、スタッフのスマホに{staffCount}名の名前が表示され、
        自分の名前を選んで希望を出せます。
      </div>

      <button
        type="button"
        data-testid="btn-generate-submit-link"
        className="btn"
        onClick={handleGenerate}
        disabled={busy}
      >
        {busy ? '作成中…' : '提出リンクを作る'}
      </button>

      {url && (
        <div style={{ marginTop: '1rem', display: 'grid', gap: '0.5rem' }}>
          <textarea
            data-testid="submit-link-text"
            readOnly
            value={message}
            rows={5}
            style={{ width: '100%', fontSize: '0.8rem', fontFamily: 'monospace' }}
          />
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              data-testid="btn-copy-submit-link"
              className="btn btn-secondary"
              onClick={handleCopy}
            >
              LINE用にコピー
            </button>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', alignSelf: 'center' }}>
              {staffCount}名 / {shiftCount}枠 / {url.length}文字
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
