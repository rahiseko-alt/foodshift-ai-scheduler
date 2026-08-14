'use client';

import React from 'react';
import { AdminNavbar } from '@/components/navigation/AdminNavbar';

export default function GuidePage() {
  return (
    <main className="container" style={{ paddingBottom: '4rem' }}>
      <AdminNavbar />

      <div style={{ maxWidth: '900px', margin: '0 auto' }}>
        {/* ヘッダー */}
        <div style={{ marginBottom: '2rem' }}>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 800, letterSpacing: '-0.02em', marginBottom: '0.5rem' }}>
            📖 FoodShift 機能解説 ＆ 数理モデル仕様リファレンス
          </h1>
          <p style={{ fontSize: '0.925rem', color: 'var(--text-muted)' }}>
            Google OR-Tools CP-SAT（数理最適化ソルバー）を用いたシフト自動生成ロジック、法令遵守ルール、現場運用の手順を詳細に解説します。
          </p>
        </div>

        {/* 目次クイックジャンプ */}
        <div className="card" style={{ marginBottom: '2rem', backgroundColor: 'var(--bg-card)' }}>
          <div style={{ fontSize: '0.875rem', fontWeight: 700, marginBottom: '0.75rem', color: 'var(--text-main)' }}>
            📌 目次
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.5rem', fontSize: '0.875rem' }}>
            <a href="#architecture" style={{ color: 'var(--primary)', textDecoration: 'none' }}>
              1. 0円・完全ステートレス設計
            </a>
            <a href="#hard-constraints" style={{ color: 'var(--primary)', textDecoration: 'none' }}>
              2. 厳格遵守ルール（Hard制約）
            </a>
            <a href="#soft-constraints" style={{ color: 'var(--primary)', textDecoration: 'none' }}>
              3. AI最適化バランス（目的関数）
            </a>
            <a href="#advanced-features" style={{ color: 'var(--primary)', textDecoration: 'none' }}>
              4. 現場特化機能（NGペア・インターバル）
            </a>
            <a href="#how-to-use" style={{ color: 'var(--primary)', textDecoration: 'none' }}>
              5. 現場運用・画面の使い方
            </a>
          </div>
        </div>

        {/* セクション 1: アーキテクチャ */}
        <section id="architecture" className="card" style={{ marginBottom: '2rem' }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span>⚡</span> 1. 完全0円インフラ ＆ 完全ステートレス設計
          </h2>
          <p style={{ fontSize: '0.875rem', lineHeight: '1.7', color: 'var(--text-main)', marginBottom: '1rem' }}>
            FoodShift はサーバー（Render）にデータベースを持たず、すべてのデータ（スタッフ情報・シフト枠・提出希望・確定シフト）をお使いのブラウザ（LocalStorage）で安全に保持・管理します。
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1rem' }}>
            <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '1rem', backgroundColor: 'var(--bg-subtle)' }}>
              <div style={{ fontWeight: 700, fontSize: '0.875rem', marginBottom: '0.25rem' }}>🛡 データ消失ゼロ保証</div>
              <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', lineHeight: '1.5' }}>
                無料サーバーが15分でスリープ・再起動しても、入力データや作成したシフト表は1バイトも消失しません。
              </div>
            </div>
            <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '1rem', backgroundColor: 'var(--bg-subtle)' }}>
              <div style={{ fontWeight: 700, fontSize: '0.875rem', marginBottom: '0.25rem' }}>🔒 プライバシー保護</div>
              <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', lineHeight: '1.5' }}>
                時給やスタッフの個人情報はクラウドDBに永続保存されず、最適化計算時のみ一時的に送信されます。
              </div>
            </div>
          </div>
        </section>

        {/* セクション 2: Hard制約 */}
        <section id="hard-constraints" className="card" style={{ marginBottom: '2rem' }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span>⚖️</span> 2. 100%厳守ルール（Hard制約）
          </h2>
          <p style={{ fontSize: '0.875rem', lineHeight: '1.7', color: 'var(--text-main)', marginBottom: '1rem' }}>
            生成AI（LLM）のような「確率的な出力」ではなく、数理最適化ソルバー（OR-Tools CP-SAT）が<strong>数理モデルとして例外なく100%厳守</strong>するルールです。
          </p>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div style={{ borderLeft: '4px solid var(--danger)', padding: '0.75rem 1rem', backgroundColor: 'var(--bg-subtle)' }}>
              <div style={{ fontWeight: 700, fontSize: '0.875rem', color: 'var(--danger)' }}>
                ① 労働基準法 第60条（満18歳未満の深夜業禁止）
              </div>
              <div style={{ fontSize: '0.8125rem', color: 'var(--text-main)', marginTop: '0.25rem' }}>
                <code>is_minor == true</code> の高校生・年少者スタッフは、22:00〜05:00 にかかるシフト枠の決定変数が強制的に <code>0</code> に固定され、AIが誤って配置することは絶対にありません。
              </div>
            </div>

            <div style={{ borderLeft: '4px solid var(--primary)', padding: '0.75rem 1rem', backgroundColor: 'var(--bg-subtle)' }}>
              <div style={{ fontWeight: 700, fontSize: '0.875rem', color: 'var(--primary)' }}>
                ② 不可シフト（Unavailable）の完全遵守
              </div>
              <div style={{ fontSize: '0.8125rem', color: 'var(--text-main)', marginTop: '0.25rem' }}>
                スタッフが「✕（不可）」と提出した日・時間帯には、人手不足時であっても絶対にシフトを割り当てません。
              </div>
            </div>

            <div style={{ borderLeft: '4px solid var(--primary)', padding: '0.75rem 1rem', backgroundColor: 'var(--bg-subtle)' }}>
              <div style={{ fontWeight: 700, fontSize: '0.875rem', color: 'var(--primary)' }}>
                ③ スタッフ相性制約（NGペアの同時勤務遮断）
              </div>
              <div style={{ fontSize: '0.8125rem', color: 'var(--text-main)', marginTop: '0.25rem' }}>
                人間関係や相性の都合で「同時勤務NG」に指定された2名のスタッフは、同一シフト枠・同一日に同時に配置されることが数理的に禁止されます。
              </div>
            </div>

            <div style={{ borderLeft: '4px solid var(--primary)', padding: '0.75rem 1rem', backgroundColor: 'var(--bg-subtle)' }}>
              <div style={{ fontWeight: 700, fontSize: '0.875rem', color: 'var(--primary)' }}>
                ④ 勤務間インターバル制約（11時間）
              </div>
              <div style={{ fontSize: '0.8125rem', color: 'var(--text-main)', marginTop: '0.25rem' }}>
                遅番（例: 23:30終了）から翌日の早番（例: 09:00開始）のように、勤務間の休息時間が11時間未満になる連続シフトの割当を自動遮断します。
              </div>
            </div>

            <div style={{ borderLeft: '4px solid var(--primary)', padding: '0.75rem 1rem', backgroundColor: 'var(--bg-subtle)' }}>
              <div style={{ fontWeight: 700, fontSize: '0.875rem', color: 'var(--primary)' }}>
                ⑤ 1日1シフト・連続勤務日数上限 ＆ 出勤日数上下限
              </div>
              <div style={{ fontSize: '0.8125rem', color: 'var(--text-main)', marginTop: '0.25rem' }}>
                1人1日最大1勤務、スタッフ別に設定された連続勤務日数（例: 最大5連勤）および期間内の最小・最大出勤日数を遵守します。
              </div>
            </div>
          </div>
        </section>

        {/* セクション 3: Soft制約・目的関数 */}
        <section id="soft-constraints" className="card" style={{ marginBottom: '2rem' }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span>🎯</span> 3. AI最適化バランス（目的関数）
          </h2>
          <p style={{ fontSize: '0.875rem', lineHeight: '1.7', color: 'var(--text-main)', marginBottom: '1rem' }}>
            数式によって定義された重み付けに基づき、全条件を満たす中で最も理想的な解を数秒で算出します。
          </p>

          <div style={{ overflowX: 'auto' }}>
            <table className="matrix-table" style={{ width: '100%', fontSize: '0.8125rem' }}>
              <thead>
                <tr>
                  <th style={{ width: '35%' }}>最適化項目</th>
                  <th style={{ width: '20%' }}>優先度 (重み)</th>
                  <th>目的・挙動の解説</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ fontWeight: 700, color: 'var(--danger)' }}>人手不足の最小化 (スラック変数)</td>
                  <td style={{ fontWeight: 700 }}>最高 (10,000)</td>
                  <td>店舗運営に不可欠な必要人数を満たすことを最優先します。不足が発生した場合は薄赤色でハイライトされます。</td>
                </tr>
                <tr>
                  <td style={{ fontWeight: 700, color: 'var(--primary)' }}>必須ロール不足ペナルティ</td>
                  <td style={{ fontWeight: 700 }}>高 (8,000)</td>
                  <td>キッチンリーダー等の資格・責任者枠を確実に配置します。</td>
                </tr>
                <tr>
                  <td style={{ fontWeight: 700, color: 'var(--success)' }}>希望シフト (want) 充足ボーナス</td>
                  <td style={{ fontWeight: 700 }}>中 (300)</td>
                  <td>スタッフが「◎（強く希望）」を出した枠を優先的に割り当て、スタッフ満足度を高めます。</td>
                </tr>
                <tr>
                  <td style={{ fontWeight: 700, color: 'var(--info)' }}>優先ペア (GOOD) 同時出勤ボーナス</td>
                  <td style={{ fontWeight: 700 }}>低 (30)</td>
                  <td>相性の良いペアスタッフが同じシフトに入れるよう誘導します。</td>
                </tr>
                <tr>
                  <td style={{ fontWeight: 700 }}>総人件費の最小化</td>
                  <td style={{ fontWeight: 700 }}>微小 (時給比率)</td>
                  <td>希望充足を阻害しない範囲で、無駄な過剰配置を抑え人件費を最適化します。</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* セクション 4: 現場特化機能 */}
        <section id="advanced-features" className="card" style={{ marginBottom: '2rem' }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span>🛠</span> 4. 現場特化機能 ＆ エッジケース対応
          </h2>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem' }}>
            <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '1rem' }}>
              <div style={{ fontWeight: 700, fontSize: '0.875rem', marginBottom: '0.5rem' }}>
                🌙 法定休憩 ＆ 深夜割増 (25%) 精密計算
              </div>
              <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', lineHeight: '1.6' }}>
                シフトごとの休憩時間を自動控除した「実働時間」で集計。22:00〜05:00 にかかる労働時間は自動で25%割増人件費として分離計算されます。
              </div>
            </div>

            <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '1rem' }}>
              <div style={{ fontWeight: 700, fontSize: '0.875rem', marginBottom: '0.5rem' }}>
                🔄 突発欠勤の再最適化 (Warm Start)
              </div>
              <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', lineHeight: '1.6' }}>
                当日の急な欠勤時、既に確定した他スタッフのシフトを固定したまま、穴埋めスロットのみを最小限の変更コストで再計算します。
              </div>
            </div>

            <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '1rem' }}>
              <div style={{ fontWeight: 700, fontSize: '0.875rem', marginBottom: '0.5rem' }}>
                💰 年収の壁 (103万/130万) 残枠ゲージ
              </div>
              <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', lineHeight: '1.6' }}>
                学生や主婦スタッフの扶養内年収残枠を可視化。今月確定シフトの想定給与を加算し、扶養超過ペースを未然に警告します。
              </div>
            </div>

            <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '1rem' }}>
              <div style={{ fontWeight: 700, fontSize: '0.875rem', marginBottom: '0.5rem' }}>
                🔍 ボトルネック要因分析
              </div>
              <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', lineHeight: '1.6' }}>
                人員不足が発生した際、「金曜遅番: 不可希望4名 / 年少者除外2名」など、なぜ人が足りないのかをAIがテキストで明示します。
              </div>
            </div>
          </div>
        </section>

        {/* セクション 5: 画面の使い方 */}
        <section id="how-to-use" className="card">
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span>📱</span> 5. 画面の使い方 ＆ 現場オペレーション
          </h2>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', fontSize: '0.875rem', lineHeight: '1.6' }}>
            <div>
              <strong>Step 1: スタッフマスタ・シフト枠の登録</strong>
              <p style={{ margin: '0.25rem 0 0', color: 'var(--text-muted)' }}>
                「👥 スタッフマスタ管理」で時給・ロール・NGペア・年収の壁を設定し、「⏰ シフト枠・必要人数設定」で時間帯と日別の必要人数を調整します。
              </p>
            </div>

            <div>
              <strong>Step 2: スタッフがスマホから希望を提出</strong>
              <p style={{ margin: '0.25rem 0 0', color: 'var(--text-muted)' }}>
                スタッフは <code>/submit</code> をスマホで開き、名前を選んでタップするだけ（30タップ以内完結）。未成年は深夜枠が自動でグレーアウトされます。
              </p>
            </div>

            <div>
              <strong>Step 3: 店長がワンクリックで最適化 ＆ 微調整</strong>
              <p style={{ margin: '0.25rem 0 0', color: 'var(--text-muted)' }}>
                管理者画面で「⚡ シフトを最適化する」を押すと、約2〜3秒で確定シフトが描画されます。セルをクリックして手動でスタッフの追加・削除も可能です。
              </p>
            </div>

            <div>
              <strong>Step 4: LINE一括共有 ＆ CSVダウンロード</strong>
              <p style={{ margin: '0.25rem 0 0', color: 'var(--text-muted)' }}>
                「LINE共有用テキスト作成」を押すと、日付別・スタッフ別の整形テキストがクリップボードにコピーされ、店舗グループLINEへ即座に貼り付けできます。
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
