# FoodShift 開発規約 & エージェント運用憲法 (AGENTS.md)

本ファイルは、本プロジェクトにおいて作業する全AIエージェント（Antigravity, Claude, Gemini, 各種サブエージェント）が**セッション開始時に必ず最初に読み、最優先で遵守すべき不変の憲法**です。

---

## 1. 必読・Source of Truth

いかなる作業（実装・修正・調査）を開始する前にも、**必ず以下のファイルを読んで現在の工程と仕様を把握すること**：

1. **実行計画・マイルストーンの唯一の正**: [`docs/EXECUTION_PLAN.md`](docs/EXECUTION_PLAN.md)
   * User Goal、CUJ（主要ユーザージャーニー）、Acceptance Criteria、不変条件（Invariants）、Release Gate が定義されています。
2. **セキュリティルール（全工程共通）**: [`docs/SECURITY_RULES.md`](docs/SECURITY_RULES.md)
3. **APIインターフェース契約**: [`docs/API_CONTRACT.md`](docs/API_CONTRACT.md)
4. **設計決定記録**: [`docs/adr/`](docs/adr/) 配下

---

## 2. 最上位原則

```text
1. User Goal（店長・スタッフの実際の達成事項）
2. Goals / Non-goals / Constraints
3. Critical User Journeys (CUJ-1〜4)
4. Invariants（労基法18歳未満深夜禁止、ステートレス性、データ完全永続性）
5. Acceptance Criteria (UAC, TAC, RAC, SAC)
6. Execution Plan (`docs/EXECUTION_PLAN.md`)
7. Implementation
```

* **Implementation Planから上位要件を逆算してはならない。**
* **形式的なテストパス（`assert True` 等）による完了報告は厳禁。** 必ず実ブラウザE2E（Playwright）や実レスポンス走査による客観的証拠（Evidence）をもって完了と判定する。

---

## 3. プロジェクト不変条件（Invariants）

1. **年少者保護（労働基準法 第60条）**: `is_minor == true` のスタッフは22:00以降にかかるシフト枠の割当変数が例外なく0であること。
2. **インフラ完全0円 ＆ 完全ステートレス**: バックエンド（Render）はDBを持たず、全データはフロントエンド（LocalStorage）で管理。サーバーが15分でスリープ・再起動してもデータは1バイトも消失しないこと。
3. **現場即戦力UX**: スタッフ希望入力は完全ログインレス（30タップ以内完結）、LINE共有用テキスト一括コピー、CSVダウンロードを必ず維持すること。
