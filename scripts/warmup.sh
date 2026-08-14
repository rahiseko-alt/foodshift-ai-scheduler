#!/usr/bin/env bash
# FoodShift Render API デモ前ウォームアップスクリプト
# 15分スリープしている無料枠サーバーを事前に起動します。

API_URL="${1:-http://localhost:8000}"

echo "[INFO] Warming up FoodShift API at: ${API_URL}..."
START_TIME=$(date +%s)

RESPONSE=$(curl -s -w "\n%{http_code}" "${API_URL}/api/v1/health")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

END_TIME=$(date +%s)
ELAPSED=$((END_TIME - START_TIME))

if [ "$HTTP_CODE" -eq 200 ]; then
  echo "[OK] API is healthy and ready! (Response time: ${ELAPSED}s)"
  echo "Response: ${BODY}"
else
  echo "[ERROR] API health check failed with HTTP ${HTTP_CODE}"
  echo "Response: ${BODY}"
  exit 1
fi
