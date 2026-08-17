@echo off
chcp 65001 > nul
echo ========================================================
echo   FoodShift - 飲食店向けAIシフト自動作成 ローカル起動
echo ========================================================
echo.
echo [1/2] バックエンド (FastAPI: ポート8000) を起動中...
start "FoodShift Backend (FastAPI)" cmd /k "cd backend && uvicorn app.main:app --reload --port 8000"

echo [2/2] フロントエンド (Next.js: ポート3000) を起動中...
start "FoodShift Frontend (Next.js)" cmd /k "cd frontend && npm run dev"

echo.
echo ========================================================
echo   起動完了！以下のURLをブラウザで開いてください：
echo.
echo   [店長画面]     http://localhost:3000/admin
echo   [スタッフ希望] http://localhost:3000/submit
echo   [API仕様書]   http://localhost:8000/docs
echo ========================================================
echo.
echo ※終了する時は、開いた2つの黒いウィンドウを閉じてください。
pause
