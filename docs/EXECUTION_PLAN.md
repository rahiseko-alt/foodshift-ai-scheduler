# FoodShift MVP 完全武装実装計画書 (Master Execution Plan)

* **プロジェクト名**: FoodShift — 飲食店向けAIシフト作成アプリ（試作品/MVP）
* **作成日**: 2026-08-14
* **Source of Truth**: 本ファイル (`docs/EXECUTION_PLAN.md`) はプロジェクトの実装・実行工程の唯一の正です。
* **設計原則**: 完全0円運用 / 非生成AI (OR-Tools CP-SAT) / 完全ステートレスAPI / Flash-Proof設計 / 現場即戦力UX

---

# 1. User Goal

* **Actor**:
  * **主アクター（店長 / 店舗オーナー）**: 飲食店の運営責任者。ITリテラシーは一般的で、普段は紙・Excel・LINEでシフト作成に月10〜20時間を費やしている。
  * **副アクター（アルバイトスタッフ）**: 高校生・大学生・フリーター。スマホから手軽にシフト希望を提出し、確定シフトを確認したい。
* **Trigger**:
  * 店長: 来週・来月（7日〜14日分）のシフト表を作成・確定・配布するタイミング。
  * スタッフ: 店長からシフト提出依頼を受け、空き時間を提出するタイミング。
* **User Goal**:
  * **店長**: スタッフの希望と各時間帯の必要人数を入力（またはプリセット読込）し、**ワンクリックで「労基法違反ゼロ」「希望充足率70%以上」「人件費最適」なシフト表を数秒で生成**し、手動修正の必要なくLINEやCSVで即座にスタッフへ共有・店舗運営に利用できる。
  * **スタッフ**: アプリのインストールや会員登録なしで、**スマホから名前を選んでタップするだけ（30秒以内）で出勤希望・NGを提出**でき、確定シフトもスマホで一目で確認できる。
* **Expected Outcome**:
  * 毎回のシフトパズル作成時間が **20時間 ➔ 5分** に短縮される。
  * 満18歳未満の深夜業（22:00〜05:00）違反や36協定超過などの**法的リスクがアルゴリズム的に100%根絶**される。
  * 異なるWi-Fiや外出先のスマホから、完全0円のインフラでいつでも誰でも利用・検証できる。
* **Success Evidence**:
  1. スマホ(375px)でスタッフ希望提出 ➔ 店長PCで最適化実行 ➔ Hard制約違反0件・希望充足率70%以上のシフト表描画 ➔ LINEテキスト出力 ➔ ブラウザリロード後も確定シフトが維持されていることが **実ブラウザE2E（Playwright）および実行ログで観測できる** こと。

---

# 2. Goals

1. **数理最適化シフト生成（OR-Tools CP-SAT）**:
   * 15人×14日×3シフト規模のシフト問題を **5秒以内** に求解。
   * 満18歳未満深夜業禁止、連続勤務上限、週間労働時間上限、必須ロール常駐（キッチンリーダー等）のHard制約を100%厳守。
2. **完全0円インフラ ＆ ステートレス設計**:
   * フロントエンド（Vercel Free）＋ バックエンド（Render Free 512MB RAM）で永続無料運用。
   * **APIを完全ステートレス化**: サーバーにDBを持たず、全状態をフロントエンド（LocalStorage）で管理。Renderが何度スリープ・再起動してもユーザーデータが1ミリも消失しない。
3. **現場即戦力UX（スマホ・PC両対応）**:
   * スタッフ側: 完全ログインレス（名前選択＋タップ）で30タップ以内に希望提出完了。
   * 管理者側: プリセットデモデータ即座描画、不足箇所（Slack変数）の視覚的ハイライト、人件費・充足率サマリー、LINE共有用テキスト一括コピー、CSVダウンロード。
4. **Flashモデル実装ガードレール（Flash-Proof）**:
   * 型契約（Strict TS + Pydantic v2）、変異テスト（Counterfactual Test）、Linter（Ruff strict）により、小型モデルでも手抜き・すり抜けコードがCIを通過できない構造の確立。

---

# 3. Non-goals

Agentが勝手に機能を拡張して本質から逸脱するのを防ぐため、以下は**今回のスコープ外**と明定する：

* ❌ **複雑なユーザー認証・権限管理・パスワードリセット**: MVP試作品ではログインレス（名前選択＋LocalStorage）で完結させる。
* ❌ **サーバーサイド永続データベース（PostgreSQL/MySQL等）の構築**: インフラ費用0円・メンテフリー・データ消失防止のため、LocalStorage＋JSON/CSVエクスポートで運用する。
* ❌ **売上予測（LightGBM）のシフトエンジンへの強制結合**: 売上予測はPhase 4で完全疎結合モジュールとして追加。MVPでは「必要人数手入力」および「プリセットパターン」で完結させる。
* ❌ **シフト枠のドラッグ＆ドロップ手動移動**: Schedule-X Premium等の有料ライセンスを避け、0円OSSの範囲（CSS Gridマトリクス表＋手動ドロップダウン調整）で実装する。
* ❌ **給与計算・勤怠打刻（タイムカード）機能**: シフトスケジューリングに特化する。

---

# 4. Constraints

* **金銭コスト**: インフラ・ライブラリ費用 **完全0円**（クレジットカード従量課金ゼロ）。
* **ライセンス**: **MIT または Apache License 2.0** のみ使用（GPL等の伝播ライセンス・商用有料ライブラリ禁止）。
* **法令制約**: 労働基準法 第60条（満18歳未満の22:00〜05:00深夜業禁止）の厳格遵守。
* **サーバーリソース制約**: Render無料枠（512MB RAM、15分非活動スリープ、コールドスタート約50秒）。
* **通信制約**: 外出先のスマホ（4G/5G）や異なるWi-FiネットワークからHTTPSで疎通可能であること。
* **コード品質制約**: TypeScript `strict: true`、Python `ruff` 全ルール有効、`@ts-ignore` / `eslint-disable` 禁止。

---

# 5. Critical User Journeys (CUJ)

### CUJ-1: Golden Journey — 店長によるワンクリック最適化＆共有
1. **Initial State**: 店長がPCブラウザで `/admin` を開く（初回アクセス）。
2. **Action 1**: 画面にプリセットされた「居酒屋サンプルデータ（15人×14日）」を確認し、「⚡ シフトを最適化する」ボタンをクリック。
3. **Expected System Result**: バックエンドAPI（Render）へJSON送信 ➔ OR-Tools CP-SATが求解 ➔ 結果JSON返却。
4. **Expected User-visible Result**: ボタンがローディング状態になり、約2〜3秒でシフトマトリクス表に全スタッフの配置が色分け描画される。画面上部に「人件費合計: ¥184,000 / 希望充足率: 92% / 法令違反: 0件」が表示される。
5. **Action 2**: 「LINE共有用テキスト作成」ボタンをクリック。
6. **Expected User-visible Result**: クリップボードに日付別・スタッフ別の整形シフトテキストがコピーされ、「コピーしました」トーストが表示される。
7. **Action 3 (Persistence Boundary)**: ブラウザタブを閉じ、再度 `/admin` を開く（Reload/Re-open）。
8. **Final State**: LocalStorageから直前の最適化シフト表と集計数値が完全に復元・表示される。

---

### CUJ-2: Golden Journey — スタッフによるスマホ希望提出
1. **Initial State**: アルバイトスタッフがスマホ（画面幅375px）で `/submit` を開く。
2. **Action 1**: 「あなたの名前」ドロップダウンから「鈴木 花子（高校生）」を選択。
3. **Action 2**: 対象週のカレンダーグリッド（7日×3シフト）で、出勤したい枠をタップ（◯ ➔ ◎ ➔ ✕ のトグル切り替え）。
4. **Action 3**: 「シフト希望を提出する」ボタンをタップ。
5. **Expected User-visible Result**: 水平スクロール・レイアウト崩れなく、タップ30回以内で全入力完了。「希望を送信しました」の成功メッセージが表示され、自分の確定シフト一覧（未確定時は「集計中」）が表示される。
6. **Final State**: LocalStorageおよび共有Stateに希望データが保存される。

---

### CUJ-3: Failure & Recovery Journey — 人員不足（Infeasible）の検出と緩和
1. **Initial State**: 特定の金曜日ディナー帯に全スタッフが「✕（不可）」を提出し、必要人数（3名）を満たせない状態。
2. **Action**: 店長が「⚡ シフトを最適化する」ボタンをクリック。
3. **Expected System Result**: ソルバーはクラッシュ（Infeasibleエラー）せず、スラック変数（緩和変数）を用いて「不足1名」の状態でベストな部分解を出力。
4. **Expected User-visible Result**: 画面上部に「⚠ 1箇所のシフトで人員不足が発生しています」のアラートバナーが表示される。該当セルの背景が薄赤色（`.unfilled`）になり、「必要3名 / 割当2名（不足1名）」のツールチップが表示される。システムはクラッシュせず操作可能な状態を維持。
5. **Recovery Action**: 店長が該当枠の必要人数設定を一時的に「2名」に変更するか、スタッフに連絡して出勤可能に変更し、再度最適化を実行 ➔ 正常（OPTIMAL）に復帰。

---

### CUJ-4: Failure & Recovery Journey — Renderコールドスタート待機
1. **Initial State**: 15分以上アクセスがなく、Renderバックエンドがスリープ状態。
2. **Action**: 店長が最適化ボタンをクリック。
3. **Expected User-visible Result (0〜5秒)**: 通常のスピナーが表示。
4. **Expected User-visible Result (5秒経過〜)**: UIが自動的に「⚡ AI最適化サーバーをスリープから復帰中です... (初回のみ約30〜50秒かかります)」のプログレス表示に切り替わる。ユーザーがフリーズと誤認しない。
5. **Expected User-visible Result (40秒後)**: APIから応答を受領し、シフト表が正常描画される。
6. **Failure Path (60秒タイムアウト時)**: 「サーバー応答がタイムアウトしました。再試行してください」と表示され、入力データは1文字も消えずに再試行ボタンが即座に押せる状態を保つ。

---

# 6. Relevant State / Invariants

### 6.1. UI State Transition Model (最適化実行フロー)

```
[ IDLE ] ──(最適化クリック)──> [ OPTIMIZING ]
                                    │
                    ┌───────────────┴───────────────┐
             (5秒以内に応答)                 (5秒以上経過)
                    │                               │
                    ▼                               ▼
        [ SOLVE_SUCCESS ]                [ COLD_START_WAITING ]
        ├─ 不足なし ➔ (OPTIMAL_VIEW)               │
        └─ 不足あり ➔ (SHORTAGE_VIEW)      ┌────────┴────────┐
                                    (応答受領)         (タイムアウト/500)
                                        │                     │
                                        ▼                     ▼
                               [ SOLVE_SUCCESS ]      [ ERROR_RETRYABLE ]
                                                              │
                                                        (再試行クリック)
                                                              │
                                                              ▼
                                                        [ OPTIMIZING ]
```

### 6.2. System Invariants (絶対に破ってはならない不変条件)

* **Invariant 1 (年少者保護)**: `is_minor == true` のスタッフは、22:00以降にかかるシフト枠の割当変数が**例外なく 0** である（Soft制約や手動操作でも上書き不可）。
* **Invariant 2 (同日重複禁止)**: 1人のスタッフに対し、同日に割り当てられるシフト枠数は**最大1枠**である。
* **Invariant 3 (データ完全永続性)**: 画面に表示されているシフト表・スタッフ設定と、`LocalStorage` に保存されたJSONデータは常に100%一致する（画面リロード・ブラウザ再起動を跨いでも完全一致）。
* **Invariant 4 (ステートレスAPI性)**: バックエンド（Render）は一切の永続ストレージを持たず、リクエスト内のデータのみで決定論的に求解を行う（サーバーが何度破棄・再起動されてもクライアント側のデータ破壊・不整合が起きない）。

---

# 7. Acceptance Criteria (分類別)

### 7.1. UAC (User Acceptance Criteria: ユーザー視点)
* **UAC-1**: スマホ画面（幅375px）において、名前選択から7日×3シフトの希望入力完了までが **30タップ以内** かつ **横スクロールなし（`scrollWidth <= 375`）** で完了すること。
* **UAC-2**: 15人×14日×3シフトのプリセットデータに対し最適化を実行した際、**Hard制約違反 0件** かつ **希望（want）充足率 ≥ 70%** のシフト表が画面に描画されること。
* **UAC-3**: 人員不足が発生した場合、システムがエラー落ちせず、**不足枠の件数サマリーと該当セルの視覚的警告（`.unfilled`）** が表示されること。
* **UAC-4**: 最適化完了後、「LINE共有」ボタンをクリックした際、クリップボードに **日付・時間・スタッフ名が整形された日本語テキスト** が格納されること。
* **UAC-5**: シフト表が表示された状態でブラウザをリロード（F5）した際、**直前と全く同じシフト表および集計数値が即座に再表示** されること。

### 7.2. TAC (Technical Acceptance Criteria: 技術的品質)
* **TAC-1**: 15人×14日×3シフトの最適化計算が、ウォーム状態で **5秒以内（中央値）**、ピークメモリ **80MB以下** で完了すること。
* **TAC-2**: バックエンド（Python）のテストにおいて、`pytest-cov` の **ブランチカバレッジが 80% 以上** であり、Hard制約6種・異常系4種・変異テスト2種のテストが全てパスすること。
* **TAC-3**: フロントエンドの TypeScript コンパイル（`tsc --noEmit`）が `strict: true` でエラー 0、ESLint エラー 0 であること。

### 7.3. RAC (Reliability Acceptance Criteria: 信頼性・復元力)
* **RAC-1**: API呼び出しが5秒を超えた際、自動的にコールドスタート案内メッセージが表示され、30秒タイムアウト時も入力フォームの内容が保持されたまま再試行できること。
* **RAC-2**: 不正なJSONや型違いデータを送信した際、サーバーが500（Internal Error）を出さず、**422（Unprocessable Entity）** で安全に応答すること。

### 7.4. SAC (Security Acceptance Criteria: セキュリティ)
* **SAC-1**: `1MB + 1Byte` のリクエストペイロードに対して **HTTP 413 (Payload Too Large)** を返却し、DoSを遮断すること。
* **SAC-2**: 全APIレスポンスに `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Strict-Transport-Security` が付与されていること。
* **SAC-3**: フロントエンドソースコード内に `dangerouslySetInnerHTML` が **0件** であること。

---

# 8. Acceptance Criteria Adversarial Review (8観点検証)

| 観点 | 問い | 今回のACでの検証と対策 | 判定 |
| :--- | :--- | :--- | :--- |
| **8.1 Value Failure** | 条件達成してもユーザー価値が上がらない実装は可能か？ | 単に「OPTIMAL」を返すだけでなく、**希望充足率≥70%・出勤日数差≤3日・LINE出力・リロード復元** をACに組み込んでいるため、価値のない解は弾かれる。 | ✅ PASS |
| **8.2 Bypass Failure** | 本来のユーザーフローを通らずに条件だけPASSできるか？ | Playwright E2Eで「スマホ入力 ➔ 送信 ➔ 管理者最適化 ➔ 画面描画」の一気通貫ジャーニーを強制検証。 | ✅ PASS |
| **8.3 Metric Gaming** | 指標達成のみを目的にした不自然な最短実装が可能か？ | テスト件数ではなく「ブランチカバレッジ80%」＋「変異テスト（満たせない条件で正しく不足が出るか）」を義務化しゲーミングを遮断。 | ✅ PASS |
| **8.4 Oracle Failure** | AC自体がUser Goalを誤解していないか？ | 「Excelでいいじゃん」を覆すため、労基法完全遵守・人件費サマリー・LINEテキスト出力を直接ACに設定。 | ✅ PASS |
| **8.5 State Failure** | Pre/Action/Post条件が定義されているか？ | 第6章で状態遷移モデル（IDLE ➔ OPTIMIZING ➔ SUCCESS/ERROR）と不変条件を厳格定義。 | ✅ PASS |
| **8.6 Composition Failure** | 前後の機能と連続利用して破綻しないか？ | 「最適化 ➔ LINEコピー ➔ 人数設定変更 ➔ 再最適化 ➔ リロード」の連続操作をE2Eシナリオ化。 | ✅ PASS |
| **8.7 Recovery Failure** | 途中失敗時に正常復帰できるか？ | Infeasible時の緩和解表示、コールドスタート遅延時のメッセージ、500/タイムアウト時の再試行保持をAC化。 | ✅ PASS |
| **8.8 Observable Outcome** | 内部実装でなく外部から観測できるか？ | 全てDOM要素（`[data-testid]`）、HTTPステータスコード、クリップボード内容、LocalStorage実データで検証。 | ✅ PASS |

---

# 9. Bad-Implementation Attack (インチキ実装攻撃と防御)

現在のAcceptance Criteriaを「文字通り満たすが実質役に立たない5つのインチキ実装」を考案し、ACがそれを排除できるか検証：

### インチキ実装①: 「固定のハードコードスケジュールJSONを常に返す」
* **手口**: ソルバーを動かさず、事前に用意した正常なスケジュールJSONをそのまま返す。
* **排除ロジック**: **変異テスト（Counterfactual Test）** で排除。スタッフのNG日や必要人数を変更したリクエストを送信し、出力結果が入力変更に連動して変化していることをアサートするため即座に不合格となる。

### インチキ実装②: 「未成年チェックをフロントのUIだけで無効化し、API側で制約を入れない」
* **手口**: フロントエンドで未成年に遅番を選ばせないようにするが、Pythonバックエンドには労基法制約を書かない。
* **排除ロジック**: **バックエンド単体テスト（`test_constraints.py`）** で排除。APIに対して直接未成年＋遅番希望のJSONをPOSTし、ソルバーレベルで割当が0件になることを検証するため突破不可能。

### インチキ実装③: 「LocalStorageに保存せず、ReactのメモリStateだけで保持する」
* **手口**: リロード前は完璧に動くが、ブラウザをリロードすると全データが吹き飛ぶ。
* **排除ロジック**: **UAC-5（Playwrightでの `page.reload()` 後検証）** で排除。リロード後にDOM要素が存在することをアサートするため即座に検出。

### インチキ実装④: 「LINE共有ボタンを押すと、空文字または固定文字列がクリップボードに入る」
* **手口**: `navigator.clipboard.writeText("シフトです")` だけ実行してトーストを出す。
* **排除ロジック**: **UAC-4（Playwrightでのクリップボード読込検証）** で排除。クリップボードの内容に「最適化されたスタッフ名」「日付」「時間帯」が正規表現で含まれているかをアサート。

### インチキ実装⑤: 「人員不足時にクラッシュはしないが、画面に何も警告を出さず何食わぬ顔で無視する」
* **手口**: スラック変数は入れたが、UIで不足を赤くせず、3人必要な枠に2人しかいなくても「最適化完了」とだけ出す。
* **排除ロジック**: **UAC-3（`[data-testid="shortage-alert"]` および `.unfilled` クラスのDOM検証）** で排除。不足要素が存在しない場合はテストがFAILする。

---

# 10. Verification Strategy (検証戦略)

### 10.1. Visible Test (公開・自動検証テスト)
* **Backend Unit / Integration (pytest)**:
  * `test_solver.py`: 15人×14日基本求解、Hard制約6種（年少者・ロール・連続勤務等）、変異テスト2種。
  * `test_schemas.py`: Pydantic境界値（1MB制限、文字種、配列長）。
  * `test_security.py`: CORS、セキュリティヘッダー値完全一致、Rate Limit 429。
  * **カバレッジゲート**: `pytest --cov=app --cov-branch --cov-fail-under=80`
* **Frontend Static & Unit (tsc / eslint)**:
  * `tsc --noEmit` (strict: true), `eslint` (disableコメント0件検査).
* **End-to-End Test (Playwright)**:
  * `schedule-flow.spec.ts`: CUJ-1 一気通貫フロー、LINEコピー、リロード永続化。
  * `mobile-submit.spec.ts`: CUJ-2 スマホ375px幅、タップ30回以内、横スクロールなし。
  * `error-recovery.spec.ts`: CUJ-3 人員不足警告、CUJ-4 コールドスタート遅延UI。

### 10.2. Unseen Scenario (実環境・非機能シナリオ)
* **Scenario A (大規模ピーク負荷)**: スタッフ20名×31日×5シフトの最大規模データ送信時のメモリ（<100MB）およびタイムアウト（<15秒）検証。
* **Scenario B (深夜24時跨ぎシフト)**: `22:00〜25:00 (翌01:00)` のシフト枠で、翌日の早番（`09:00〜`）とのインターバルおよび年少者判定の正当性検証。
* **Scenario C (ネットワーク断線)**: 最適化リクエスト中に通信切断 ➔ エラーメッセージ表示 ➔ 再接続後に再試行ボタンで即座に復帰。

### 10.3. Runtime Evidence (提出する証拠)
* `pytest` 実行結果ログ（カバレッジ80%以上のパーセンテージ出力）。
* `Playwright` 実行レポート（全E2EテストPASS、スマホ画面スクリーンショット）。
* 本番 Render API の `/api/v1/health` 応答ヘッダーダンプ（セキュリティヘッダー確認）。
* Vercel 本番URLからの実アクセス検証結果ログ。

---

# 11. Risk Level

* **総合判定**: **Level 3 — Critical UX / Persistent State**
* **必須ゲート**:
  * Build / Static Lint (Error 0)
  * Backend Branch Coverage ≥ 80%
  * Playwright E2E (All Pass including 375px mobile)
  * LocalStorage Persistence Verification
  * Security Headers & Payload Limit Check
  * Failure & Recovery Flow Verification

---

# 12. Implementation Plan (実行工程)

### Milestone 0: スキャフォールディング ＆ 契約・セキュリティ基盤
* **Objective**: ディレクトリ構成、型定義、セキュリティミドルウェア、テスト基盤の確立。
* **Changes**:
  * `backend/`: FastAPI初期化、Pydanticスキーマ（`schemas/scheduler.py`）、セキュリティヘッダー＆1MB制限ミドルウェア、`test_health.py`、`test_security.py`。
  * `frontend/`: Next.js初期化、`lib/types.ts`（バックエンドスキーマと完全同期）、`lib/mock-data.ts`（15人×14日居酒屋データ）、CSPヘッダー設定。
  * `docs/`: `API_CONTRACT.md`（JSON入出力仕様）。
* **Supported AC**: TAC-3, SAC-1, SAC-2, SAC-3
* **Validation**: `pytest backend/tests/test_security.py` PASS, `tsc --noEmit` PASS.

---

### Milestone 1: OR-Tools 最適化エンジン ＆ バックエンドAPI
* **Objective**: 日本の労基法・飲食ルールを完全遵守する数理モデルとFastAPIエンドポイントの実装。
* **Changes**:
  * `backend/app/engine/solver.py`: CP-SATモデル構築、変数定義、スラック変数導入。
  * `backend/app/engine/constraints.py`: 年少者22時禁止、連続勤務上限、必須ロール常駐、希望シフトペナルティ。
  * `backend/app/engine/time_utils.py`: 深夜24時跨ぎの分換算正規化。
  * `backend/app/api/v1/optimize.py`: 最適化エンドポイント、SlowAPIレート制限。
  * `backend/tests/`: `test_solver.py`, `test_constraints.py` (変異テスト含む計18件以上)。
* **Supported AC**: UAC-2, UAC-3, TAC-1, TAC-2, SAC-1
* **Validation**: `pytest --cov=app --cov-branch --cov-fail-under=80` PASS.

---

### Milestone 2: フロントエンドUI ＆ スマホ/PC現場UX
* **Objective**: スマホ希望入力、PCシフトマトリクス、不足警告、LINE出力、LocalStorage永続化の実装。
* **Changes**:
  * `frontend/src/app/admin/page.tsx`: 管理者画面、人件費・充足率サマリーカード。
  * `frontend/src/components/schedule/ShiftMatrix.tsx`: 自作CSS Gridマトリクス表、`.unfilled` 警告ツールチップ。
  * `frontend/src/components/schedule/ExportModal.tsx`: LINEテキスト一括コピー、CSVダウンロード。
  * `frontend/src/app/submit/page.tsx`: スマホ最適化（375px幅、44px+タップ領域、トグル入力、30タップ以内完結）。
  * `frontend/src/lib/storage.ts`: LocalStorage自動永続化＆復元ロジック。
  * `frontend/src/lib/api.ts`: 5秒超コールドスタート案内、タイムアウトハンドリング。
  * `frontend/e2e/`: Playwright E2Eテスト一式。
* **Supported AC**: UAC-1, UAC-2, UAC-3, UAC-4, UAC-5, RAC-1
* **Validation**: `npx playwright test` 全PASS.

---

### Milestone 3: 統合・0円デプロイ ＆ 実環境疎通検証
* **Objective**: Vercel + Render へのデプロイと、別ネットワークからの実稼働検証。
* **Changes**:
  * `backend/render.yaml`: Render Web Service設定（Uvicorn起動、環境変数）。
  * `frontend/next.config.js`: Vercel本番ビルド設定、Render API CORS許可。
  * `scripts/warmup.sh`: デモ前APIウォームアップ用curlスクリプト。
* **Supported AC**: 全AC統合検証、RAC-1
* **Validation**: 本番URLへのPlaywright E2E実行、外部スマホからのアクセス確認。

---

# 13. Plan Coverage Review

| 上流要件 | 対応するマイルストーン | 検証手段 (Test / Check) |
| :--- | :--- | :--- |
| **CUJ-1: 店長最適化＆LINE共有** | Milestone 1 (API), Milestone 2 (UI) | `schedule-flow.spec.ts` (Playwright) |
| **CUJ-2: スマホ希望提出** | Milestone 2 (UI) | `mobile-submit.spec.ts` (Playwright 375px) |
| **CUJ-3: 人員不足＆緩和** | Milestone 1 (Slack変数), Milestone 2 (UI警告) | `error-recovery.spec.ts`, `test_solver.py` |
| **CUJ-4: コールドスタート待機** | Milestone 0 (Middleware), Milestone 2 (UIタイマー) | `error-recovery.spec.ts` (遅延モック) |
| **Invariant 1: 年少者保護** | Milestone 1 (Hard制約) | `test_constraints.py` (変異テスト) |
| **Invariant 3: データ永続性** | Milestone 2 (LocalStorage) | `schedule-flow.spec.ts` (Reload検証) |
| **Invariant 4: ステートレスAPI** | Milestone 0, Milestone 1 | アーキテクチャ設計 (DBレス) |

---

# 14. Plan Adversarial Review (計画自体の敵対検証)

1. **User Goalを達成しない計画になっていないか？**
   * ➔ シフト作成の自動化だけでなく、LINEテキスト出力、CSV出力、LocalStorage永続化まで含んでいるため、現場でそのまま運用可能。
2. **ファイル変更一覧が目的化していないか？**
   * ➔ 全てのファイル変更がCUJ-1〜4およびInvariantの成立に直接紐付いている。
3. **Critical Journeyに未実装区間がないか？**
   * ➔ スタッフ希望入力 ➔ 最適化 ➔ 警告表示 ➔ 共有 ➔ リロード復元の全ステップが網羅されている。
4. **既存機能を壊す可能性を無視していないか？**
   * ➔ 新規構築のため既存破壊リスクは軽微だが、Phase 4売上予測の追加時にもコアエンジンを変更しない疎結合設計を徹底。

---

# 15. Release Gate (完了判定基準)

以下のチェックが **全て自動実行でPASS** し、証拠（ログ・スクリーンショット）が確認された時点で完了とする：

```bash
# 1. バックエンド静的解析 & 型チェック
cd backend && ruff check . && ruff format --check .

# 2. バックエンド単体・変異テスト & カバレッジ
cd backend && pytest --cov=app --cov-branch --cov-fail-under=80

# 3. フロントエンド静的解析 & 型チェック
cd frontend && npm run lint && npx tsc --noEmit

# 4. フロントエンド・統合 Playwright E2E テスト (375pxスマホ + PC + 異常系)
cd frontend && npx playwright test

# 5. セキュリティ検査
grep -r "dangerouslySetInnerHTML" frontend/src/ | wc -l  # => 0 であること
```

---

# 16. Remaining Risks (残余リスクと運用緩和策)

| リスク事象 | 発生確率 | 影響度 | 対策・運用回避手順 |
| :--- | :--- | :--- | :--- |
| **Render初回起動遅延（50秒）** | 高 (15分無アクセス時) | 中 | デモ直前に `scripts/warmup.sh` を実行して事前起動。UI側で「サーバー復帰中」案内を表示。 |
| **スタッフの希望重複・極端な人員過少** | 中 | 中 | スラック変数による緩和解提示 ＆ 薄赤色ハイライトで手動連絡・調整を促す。 |
| **ブラウザのLocalStorage消去** | 低 | 小 | シフト確定時に「CSVダウンロード」を促し、手元にバックアップを保存可能にする。 |
