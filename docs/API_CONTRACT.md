# API インターフェース契約書 (API_CONTRACT.md)

本ドキュメントは、FoodShift バックエンド (FastAPI) とフロントエンド (Next.js) の間で通信する REST API の仕様を定義します。

---

## 1. エンドポイント一覧

| メソッド | パス | 概要 | 認証 | レート制限 |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/health` | サーバーヘルスチェック | 不要 | 60/分 |
| `POST` | `/api/v1/optimize` | シフト最適化計算の実行 | 不要 | 5/分 |

---

## 2. `GET /api/v1/health`

### レスポンス (200 OK)
```json
{
  "status": "ok",
  "version": "1.0.0",
  "ortools_available": true
}
```

---

## 3. `POST /api/v1/optimize`

### リクエストボディ (JSON, Content-Type: application/json)
* **最大ペイロードサイズ**: 1MB (超過時は `413 Payload Too Large`)

```json
{
  "period": {
    "start_date": "2026-09-01",
    "days": 14
  },
  "shifts": [
    {
      "id": "morning",
      "name": "早番",
      "start": "09:00",
      "end": "15:00",
      "hours": 6.0,
      "is_late_night": false
    },
    {
      "id": "afternoon",
      "name": "中番",
      "start": "12:00",
      "end": "18:00",
      "hours": 6.0,
      "is_late_night": false
    },
    {
      "id": "night",
      "name": "遅番",
      "start": "17:00",
      "end": "23:30",
      "hours": 6.5,
      "is_late_night": true
    }
  ],
  "staff_members": [
    {
      "id": "emp_001",
      "name": "山田 太郎 (店長/キッチン)",
      "is_minor": false,
      "roles": ["kitchen_leader", "hall"],
      "hourly_wage": 1300,
      "max_weekly_hours": 40.0,
      "target_weekly_hours": 35.0,
      "max_consecutive_days": 5
    },
    {
      "id": "emp_002",
      "name": "鈴木 花子 (高校生/17歳)",
      "is_minor": true,
      "roles": ["hall"],
      "hourly_wage": 1100,
      "max_weekly_hours": 20.0,
      "target_weekly_hours": 15.0,
      "max_consecutive_days": 3
    }
  ],
  "requirements": [
    {
      "day_offset": 0,
      "shift_id": "morning",
      "min_staff": 2,
      "required_roles": {}
    },
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
      "shift_id": "morning",
      "status": "want"
    },
    {
      "staff_id": "emp_002",
      "day_offset": 0,
      "shift_id": "night",
      "status": "unavailable"
    }
  ]
}
```

### レスポンス (200 OK - 成功時)

```json
{
  "status": "OPTIMAL",
  "solve_time_ms": 128,
  "summary": {
    "total_labor_cost": 184500,
    "total_work_hours": 152.0,
    "wants_fulfillment_rate": 0.88,
    "max_staff_day_difference": 2,
    "unfilled_requirements": []
  },
  "schedule": [
    {
      "date": "2026-09-01",
      "day_offset": 0,
      "shift_id": "morning",
      "assigned_staff": [
        {
          "id": "emp_002",
          "name": "鈴木 花子 (高校生/17歳)",
          "assigned_role": "hall",
          "hourly_wage": 1100,
          "is_want_fulfilled": true
        }
      ]
    },
    {
      "date": "2026-09-01",
      "day_offset": 0,
      "shift_id": "night",
      "assigned_staff": [
        {
          "id": "emp_001",
          "name": "山田 太郎 (店長/キッチン)",
          "assigned_role": "kitchen_leader",
          "hourly_wage": 1300,
          "is_want_fulfilled": false
        }
      ]
    }
  ]
}
```

### レスポンス (200 OK - 人員不足・緩和解時)
```json
{
  "status": "FEASIBLE_WITH_SHORTAGE",
  "solve_time_ms": 142,
  "summary": {
    "total_labor_cost": 172000,
    "total_work_hours": 140.0,
    "wants_fulfillment_rate": 0.75,
    "max_staff_day_difference": 2,
    "unfilled_requirements": [
      {
        "date": "2026-09-05",
        "day_offset": 4,
        "shift_id": "night",
        "required_count": 3,
        "assigned_count": 2,
        "shortage": 1,
        "reason": "全員NGまたは出勤可能スタッフの上限到達"
      }
    ]
  },
  "schedule": [...]
}
```

### エラーレスポンス (413 / 422 / 429)

* **413 Payload Too Large**
```json
{
  "detail": "Payload too large. Maximum allowed size is 1MB."
}
```

* **422 Unprocessable Entity (バリデーションエラー)**
```json
{
  "detail": [
    {
      "loc": ["body", "staff_members", 0, "hourly_wage"],
      "msg": "Input should be greater than or equal to 800",
      "type": "greater_than_equal"
    }
  ]
}
```

* **429 Too Many Requests (レート制限超過)**
```json
{
  "error": "Rate limit exceeded: 5 per 1 minute"
}
```
