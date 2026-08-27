import React from 'react';
import Link from 'next/link';

export const metadata = {
  title: '個人情報の取り扱い | FoodShift',
  description: 'FoodShift が扱うデータと、その保存場所についての説明',
};

/**
 * 個人情報の取り扱い。
 *
 * 実装がステートレスであるという事実をそのまま記載している。
 * 書いてある内容と実装が食い違わないよう、変更時は必ず両方を確認すること。
 */
export default function PrivacyPage() {
  return (
    <main className="container" style={{ paddingBottom: '3rem', maxWidth: 720 }}>
      <header style={{ margin: '1.5rem 0' }}>
        <h1 style={{ fontSize: '1.375rem', fontWeight: 700 }}>個人情報の取り扱い</h1>
        <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>最終更新: 2026-08-26</p>
      </header>

      <section className="card" style={{ padding: '1.25rem', marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.5rem' }}>
          データはお使いの端末の中だけに保存されます
        </h2>
        <p style={{ fontSize: '0.875rem', lineHeight: 1.8 }}>
          スタッフの氏名・時給・生年月日・シフト希望などの入力内容は、
          すべてお使いのブラウザ内（LocalStorage および IndexedDB）に保存されます。
          当サービスのサーバーには保存されません。データベースを持たない設計です。
        </p>
      </section>

      <section className="card" style={{ padding: '1.25rem', marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.5rem' }}>
          サーバーに送られるもの
        </h2>
        <p style={{ fontSize: '0.875rem', lineHeight: 1.8 }}>
          「シフトを最適化する」を実行したときだけ、計算に必要な情報
          （氏名・時給・勤務条件・必要人数）がサーバーへ送られます。
          サーバーは計算結果を返したあと、受け取った内容を保存せずに破棄します。
          計算のためだけに一時的に扱うもので、蓄積・分析・第三者提供は行いません。
        </p>
      </section>

      <section className="card" style={{ padding: '1.25rem', marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.5rem' }}>
          スタッフへ配る「提出リンク」について
        </h2>
        <p style={{ fontSize: '0.875rem', lineHeight: 1.8 }}>
          提出リンクにはスタッフの氏名・対象期間・シフト枠が含まれます。
          時給や生年月日は含みません。
          この情報はURLの <code>#</code> 以降に置かれるため、
          <strong>サーバーへは送信されず、アクセス記録にも残りません</strong>。
          ただしリンクを受け取った人は名簿を見られるため、
          関係者以外へ転送されないようご注意ください。
        </p>
      </section>

      <section className="card" style={{ padding: '1.25rem', marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.5rem' }}>
          データの削除とバックアップ
        </h2>
        <p style={{ fontSize: '0.875rem', lineHeight: 1.8 }}>
          ブラウザの閲覧データを消去すると、保存された内容もすべて消えます。
          サーバーには控えがないため復元できません。
          大切なデータは管理画面の「データバックアップ ＆ 復元」から
          JSONファイルとして保存しておいてください。
        </p>
      </section>

      <section className="card" style={{ padding: '1.25rem', marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.5rem' }}>
          ログインについて
        </h2>
        <p style={{ fontSize: '0.875rem', lineHeight: 1.8 }}>
          会員登録・ログインの仕組みはありません。データが端末ごとに分かれているため、
          他の利用者のデータが混ざることはありません。
          一方で、<strong>同じ端末・同じブラウザを使う人は同じデータを見られます</strong>。
          共用端末でお使いの場合はご注意ください。
        </p>
      </section>

      <Link href="/" className="btn btn-secondary" data-testid="privacy-back-home">
        トップへ戻る
      </Link>
    </main>
  );
}
