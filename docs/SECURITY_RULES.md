# セキュリティルール（全フェーズ共通・実装前に適用）

* **ステータス**: 正式ルール (Enforced)
* **作成日**: 2026-08-14
* **適用範囲**: 本プロジェクトの全コード（バックエンド・フロントエンド）

---

## P0: 絶対遵守（違反時はマージ不可）

### バックエンド (Python / FastAPI)

1. **CORS: `allow_origins=["*"]` の使用禁止**
   - 環境変数 `ALLOWED_ORIGINS` で許可ドメインを明示的に列挙する。
   - `allow_methods` / `allow_headers` も必要最小限に限定する。

2. **入力バリデーション: 全エンドポイントで Pydantic v2 スキーマ必須**
   - `dict` や `Any` 型でのリクエスト受け取り禁止。
   - 配列の最大長: `staff_members <= 50`, `shifts <= 20`, `days <= 31`
   - 数値の範囲: `hourly_wage: ge=800, le=10000`, `max_weekly_hours: ge=0, le=168`
   - 文字列: `id` は `^[a-zA-Z0-9_\-]+$` パターン制約、`name` は `max_length=50`

3. **ペイロードサイズ制限: 1MB上限ミドルウェア必須**
   - `Content-Length > 1MB` のリクエストは `413 Payload Too Large` で即拒否。

4. **HTTPセキュリティヘッダー: 全レスポンスに付与**
   - `X-Content-Type-Options: nosniff`
   - `X-Frame-Options: DENY`
   - `Strict-Transport-Security: max-age=31536000; includeSubDomains`
   - `Referrer-Policy: strict-origin-when-cross-origin`
   - `Permissions-Policy: geolocation=(), microphone=(), camera=()`

5. **シークレット管理**
   - `.env` ファイルは `.gitignore` に必ず含める。
   - 本番のシークレットは Render / Vercel のダッシュボードで設定。コードにハードコードしない。

### フロントエンド (Next.js / TypeScript)

6. **CSP (Content Security Policy) ヘッダー必須**
   - `connect-src` で Render API ドメインのみ許可。
   - `frame-ancestors 'none'` でiframe埋め込み禁止。

7. **`dangerouslySetInnerHTML` の使用禁止**
   - ユーザー入力のHTML直接描画は一切行わない。

8. **`NEXT_PUBLIC_` プレフィックスの厳格管理**
   - クライアントに露出してよい値（APIのベースURL等）のみ `NEXT_PUBLIC_` を付与。
   - シークレットキー・認証トークンには絶対に付与しない。

---

## P1: 重要（フェーズ完了時までに適用）

9. **レート制限 (slowapi)**
   - `/api/v1/optimize`: `5/minute` per IP
   - `/api/v1/health`: `60/minute` per IP

10. **依存関係の脆弱性スキャン**
    - `pip-audit` をCI（GitHub Actions）に組み込み、既知の脆弱性があるパッケージを検出。
    - `.github/dependabot.yml` で weekly 自動更新PR。

---

## P2: 推奨（本番移行時に適用）

11. **認証・認可の追加**（MVP試作品では省略可）
12. **ログ・監査証跡**（本番運用時に追加）
