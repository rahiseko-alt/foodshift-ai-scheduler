# SPEC-002: インフラ・デプロイ構成仕様書

* **ステータス**: 正式仕様 (Approved)
* **関連ADR**: [ADR-002](../adr/002-infrastructure-selection.md)
* **作成日**: 2026-08-14

---

## 1. システム構成図

```
[クライアントのスマホ / PCブラウザ]
             │
             │ HTTPS (外出先・別Wi-Fi・どこからでもアクセス可)
             ▼
┌──────────────────────────────────────────────┐
│  フロントエンド (Vercel Free Tier)           │
│  - ドメイン: https://<project>.vercel.app    │
│  - 技術: Next.js (TypeScript) + Vanilla CSS  │
│  - 役割: シフト希望入力UI、ガントチャートUI  │
└──────────────────────┬───────────────────────┘
                       │
                       │ REST API (JSON / CORS対応)
                       ▼
┌──────────────────────────────────────────────┐
│  バックエンド API (Render Free Web Service)  │
│  - ドメイン: https://<api-service>.onrender.com
│  - 技術: Python 3.10+ / FastAPI / Uvicorn     │
│  - エンジン: OR-Tools CP-SAT (最適化)        │
│  - メモリ上限: 512MB RAM (最適化実行時 <100MB)│
└──────────────────────────────────────────────┘
```

---

## 2. デプロイ要件と設定

### 2.1. バックエンド (Render)
* **Build Command**: `pip install -r requirements.txt`
* **Start Command**: `uvicorn main:app --host 0.0.0.0 --port $PORT`
* **ヘルスチェックエンドポイント**: `GET /api/health`
* **CORS設定**: VercelのフロントエンドURLからのリクエストを明示的に許可。

### 2.2. フロントエンド (Vercel)
* **Framework Preset**: Next.js
* **環境変数**:
  * `NEXT_PUBLIC_API_URL`: Render側のAPIベースURL (例: `https://xxxx.onrender.com`)

---

## 3. コールドスタート対策 (UX仕様)

* APIへのリクエスト時、応答が5秒を超えた場合は「⚡ AI最適化サーバーをスリープから復帰中です... (初回のみ約30〜50秒かかります)」というアニメーションステータスを表示する。
