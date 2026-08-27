# FoodShift

飲食店向けのシフト自動作成ツール。スタッフの希望と時間帯ごとの必要人数から、
労働基準法を守ったシフトを数秒で作ります。

**サーバーにお店のデータを保存しません。** データはブラウザの中だけに保存され、
サーバーは計算のために受け取るだけで、保存も記録もしません。

---

## できること

| 使う人 | できること |
| :--- | :--- |
| 店長 | スタッフ登録 → 必要人数の設定 → ワンクリックで最適化 → LINE用テキスト/CSVで配布 |
| スタッフ | 店長から届いたリンクを開き、名前を選んで希望を提出（ログイン不要） |

守っているルール（数理最適化の制約として組み込み、例外なく適用されます）:

- 満18歳未満の深夜業禁止（労基法 第60条）
- 妊娠中・産後スタッフの深夜業制限（同 第64条の3）
- 週間労働時間の上限（任意の連続7日間で判定）
- 留学生の資格外活動 週28時間（起算日を問わず）
- 連続勤務日数の上限、勤務間インターバル、同時勤務NGの組み合わせ

---

## 使い方（店長）

1. `/admin` を開く。最初はサンプルデータが表示されます
2. 「自分のお店で始める」→ 店舗名を入れてサンプルを消去
3. 「店舗・期間の設定」で対象期間（開始日・日数）を設定
4. 「スタッフ管理」で自店のスタッフを登録（氏名・時給・18歳未満かの3項目で登録可）
5. 「シフト枠設定」で時間帯と必要人数を設定
6. `/admin` に戻り「提出リンクを作る」→ LINEでスタッフへ送信
7. 集まった提出コードを「LINE希望取込」に貼り付け
8. 「シフトを最適化する」→ LINE用テキスト / CSV で配布

## 使い方（スタッフ）

店長から届いたリンクを開き、自分の名前を選んで枠をタップして送信するだけです。
表示されたコードを店長へ返信します。アプリのインストールも会員登録も不要です。

---

## 開発環境のセットアップ

必要なもの: Python 3.11 以上 / Node.js 20 以上

```bash
# バックエンド
cd backend
pip install -r requirements.txt -r requirements-dev.txt
uvicorn app.main:app --reload --port 8000

# フロントエンド（別ターミナル）
cd frontend
npm ci
npm run dev            # http://localhost:3000
```

Windows は `start-local.bat` で両方をまとめて起動できます（依存関係は事前に導入してください）。

### 環境変数

| 場所 | 変数 | 説明 |
| :--- | :--- | :--- |
| backend | `ENVIRONMENT` | `production` にすると `/docs`（API仕様）を非公開にします |
| backend | `ALLOWED_ORIGINS` | CORS許可オリジン。カンマ区切り |
| frontend | `NEXT_PUBLIC_API_URL` | バックエンドのURL。未設定時は `https://foodshift-api.onrender.com` |

`backend/.env.example` と `frontend/.env.example` を参照してください。

---

## 品質チェック

変更を加えたら以下がすべて通ることを確認してください（`docs/EXECUTION_PLAN.md` §15 の Release Gate）。

```bash
cd backend  && ruff check . && ruff format --check .
cd backend  && python3 -m pytest --cov=app --cov-branch --cov-fail-under=80
cd frontend && npx tsc --noEmit && npm run lint
cd frontend && npx playwright test
```

**テストは「実物を見ている」ことを条件とします。** 画面に何も無くても通るテスト、
モックの固定値を照合するだけのテストは認めません。詳細は `AGENTS.md` を参照。

---

## デプロイ

- **バックエンド**: Render（`render.yaml` の Blueprint）。
  `ALLOWED_ORIGINS` はデプロイ先ごとに異なるため**ダッシュボードで設定**します
- **フロントエンド**: Vercel。`NEXT_PUBLIC_API_URL` にバックエンドのURLを設定します

無料枠は15分アクセスが無いとスリープするため、初回は復帰に30〜50秒かかります。
`scripts/warmup.sh` で事前に起こせます。

---

## 現在の状態

公開に向けた進捗は [`docs/PROGRESS.md`](docs/PROGRESS.md) を参照してください。
既知の制限もそこに記載しています。

## ライセンス

MIT License（[LICENSE](LICENSE)）
