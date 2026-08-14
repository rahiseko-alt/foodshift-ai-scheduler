# SPEC-001: シフト最適化エンジン 基本仕様書

* **ステータス**: 正式仕様 (Draft -> Approved)
* **関連ADR**: [ADR-001](../adr/001-shift-optimization-engine-selection.md)
* **作成日**: 2026-08-14

---

## 1. 概要と責務

本仕様は、飲食店向けシフト作成AIアプリの中核である「数理最適化（OR-Tools CP-SAT）を用いたシフト自動生成エンジン」の仕様を定義する。

### 責務の明確化（疎結合の原則）
* **責務**: 与えられた「従業員データ」「必要人数要件」「制約条件」に基づき、数理的に最適なシフト配置を算出して返却する。
* **非責務**: 売上予測の計算（別モジュールで算出し、本エンジンには単なる入力パラメータとして渡す）。

---

## 2. コア技術

* **言語**: Python 3.10+
* **ソルバー**: `ortools.sat.python.cp_model.CpModel` (Google OR-Tools CP-SAT Solver)
* **実行環境**: ローカル / 無料クラウド環境 (Render / Hugging Face Spaces 等, 512MB RAM制約下で動作)

---

## 3. 入力データ仕様（Input Schema）

```json
{
  "period": {
    "start_date": "2026-09-01",
    "days": 7
  },
  "shifts": [
    { "id": "morning", "name": "早番", "start": "09:00", "end": "15:00", "hours": 6.0 },
    { "id": "afternoon", "name": "中番", "start": "12:00", "end": "18:00", "hours": 6.0 },
    { "id": "night", "name": "遅番", "start": "17:00", "end": "23:30", "hours": 6.5, "is_late_night": true }
  ],
  "staff_members": [
    {
      "id": "emp_001",
      "name": "山田 太郎",
      "is_minor": false,
      "roles": ["hall", "kitchen_leader"],
      "hourly_wage": 1200,
      "max_weekly_hours": 40,
      "target_weekly_hours": 30,
      "max_consecutive_days": 5
    },
    {
      "id": "emp_002",
      "name": "鈴木 花子（高校生・17歳）",
      "is_minor": true,
      "roles": ["hall"],
      "hourly_wage": 1100,
      "max_weekly_hours": 20,
      "target_weekly_hours": 15,
      "max_consecutive_days": 3
    }
  ],
  "requirements": [
    {
      "day_offset": 0,
      "shift_id": "night",
      "min_staff": 3,
      "required_roles": { "kitchen_leader": 1 }
    }
  ],
  "availabilities": [
    {
      "staff_id": "emp_002",
      "day_offset": 0,
      "shift_id": "night",
      "status": "unavailable"
    }
  ]
}
```

---

## 4. 制約モデル仕様（Constraints Specification）

### 4.1. Hard制約（100% 厳守・違反時は解なし）

1. **満18歳未満の深夜業禁止（労働基準法 第60条）**:
   * `is_minor == true` のスタッフに対し、22:00以降にかかるシフト（`is_late_night == true` 等）の割当変数を 0 に固定する。
2. **スタッフ本人の不可時間（Unavailable）の遵守**:
   * 本人が提出した「出勤不可（NG）」のシフト枠には絶対に配置しない。
3. **同日内での重複勤務禁止（基本原則）**:
   * 1人のスタッフに対し、同日に割り当てられるシフト枠は最大1つ（※通し勤務設定がない限り）。
4. **連続勤務日数上限の厳守**:
   * スタッフごとに設定された `max_consecutive_days`（例: 最大5日連続）を超えて連続勤務させない。
5. **最大労働時間の上限遵守**:
   * 週間最大労働時間（`max_weekly_hours`）を超過させない（36協定・扶養内控除の保護）。
6. **必要人数・必須スキルの充足**:
   * 各時間帯・シフト枠で要求される `min_staff` および `required_roles`（例: キッチンリーダー1名以上）を満たす。

### 4.2. Soft制約（目的関数で最適化・ペナルティ付き最大化/最小化）

1. **希望シフト（Want）の優先割り当て**:
   * 本人が希望（Want）を出した枠に配置された場合、スコアを加算。
2. **目標労働時間の達成（不足・超過へのペナルティ）**:
   * 各スタッフの `target_weekly_hours` にできる限り近づける。
3. **人件費（コスト）最適化**:
   * 時給 × 勤務時間の総和を抑制（必要人数を満たす範囲で効率的に配置）。
4. **スタッフ間の公平性**:
   * 同条件のアルバイト間で出勤日数や労働時間の偏りを最小化。

---

## 5. 出力データ仕様（Output Schema）

```json
{
  "status": "OPTIMAL",
  "solve_time_ms": 42,
  "summary": {
    "total_labor_cost": 154000,
    "total_work_hours": 128.5,
    "unfilled_requirements": []
  },
  "schedule": [
    {
      "date": "2026-09-01",
      "day_offset": 0,
      "shift_id": "night",
      "assigned_staff": [
        { "id": "emp_001", "name": "山田 太郎", "assigned_role": "kitchen_leader" }
      ]
    }
  ]
}
```

---

## 6. 例外処理・緩和機能（Infeasible Recovery）

* 物理的に人員が不足しているなど「Hard制約を満たす解が存在しない（Infeasible）」場合：
  1. ソルバーは即座にエラーで落ちるのではなく、**「必要人数不足の緩和変数（Slack Variable）」** を用いて計算を実行する。
  2. 出力結果に `"unfilled_requirements": [{"date": "2026-09-01", "shift_id": "night", "shortage": 1}]` のように不足箇所を明示し、**「ここまで埋められたベストな暫定シフト」** を返却する。
