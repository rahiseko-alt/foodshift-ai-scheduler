def test_security_headers_present_with_exact_values(client):
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    headers = response.headers

    # セキュリティヘッダー値の厳格検証 (SECURITY_RULES.md P0-4)
    assert headers.get("x-content-type-options") == "nosniff"
    assert headers.get("x-frame-options") == "DENY"
    assert headers.get("x-xss-protection") == "1; mode=block"
    assert "max-age=31536000" in headers.get("strict-transport-security", "")
    assert headers.get("referrer-policy") == "strict-origin-when-cross-origin"


def test_cors_preflight_allows_configured_origin(client):
    response = client.options(
        "/api/v1/optimize",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "Content-Type",
        },
    )
    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == "http://localhost:3000"
    assert response.headers.get("access-control-allow-credentials") == "true"


def test_payload_size_limit_blocks_large_requests(client):
    # 1MB を超えるヘッダー長を指定
    large_size = 2 * 1024 * 1024  # 2MB
    response = client.post(
        "/api/v1/optimize",
        headers={"content-length": str(large_size), "content-type": "application/json"},
        content=b"{}",
    )
    assert response.status_code == 413
    assert "Payload too large" in response.json()["detail"]


def test_rate_limit_blocks_excessive_requests(client):
    # 5回/分のリクエスト制限をテスト (6回目で 429)
    # 最適化エンドポイントに 6 回リクエストを送信
    payload = {
        "period": {"start_date": "2026-09-01", "days": 1},
        "shifts": [
            {
                "id": "s1",
                "name": "シフト",
                "start": "09:00",
                "end": "15:00",
                "hours": 6.0,
                "is_late_night": False,
            }
        ],
        "staff_members": [
            {
                "id": "e1",
                "name": "スタッフ",
                "is_minor": False,
                "roles": ["hall"],
                "hourly_wage": 1000,
            }
        ],
        "requirements": [],
        "availabilities": [],
    }

    # 12回送る。5/minute の固定窓がテスト実行中に切り替わっても、
    # どちらかの窓で必ず6件目に到達するため 429 が確実に発生する。
    statuses = []
    for _ in range(12):
        res = client.post("/api/v1/optimize", json=payload)
        statuses.append(res.status_code)

    # 従来は `429 in statuses or statuses.count(200) <= 5` という選言だった。
    # 後半の条件は「全部 500 で落ちている」場合にも成立してしまうため、
    # レート制限が完全に壊れていても緑になりうる（実装を何も見ていない）。
    # 制限前は通り、制限後は 429 になることを両方主張する。
    assert statuses[:5] == [200] * 5, f"制限内(5回/分)のリクエストが通っていない: {statuses}"
    assert 429 in statuses, f"6回目以降も制限されていない: {statuses}"
    assert statuses.count(200) <= 10, f"許可された回数が多すぎる: {statuses}"


def test_cors_rejects_unlisted_origin(client):
    """許可リストに無いオリジンには CORS 許可を返さない。

    従来は許可オリジンが通ることしか確認しておらず、
    `allow_origins=["*"]` に変えても全テストが緑のままだった
    （＝オリジン制限そのものを誰も見張っていなかった）。
    許可・不許可の両方を主張する対照群を置く。
    """
    evil = "https://evil.example.com"

    preflight = client.options(
        "/api/v1/optimize",
        headers={
            "Origin": evil,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "Content-Type",
        },
    )
    assert preflight.status_code == 400, (
        f"未許可オリジンのプリフライトが拒否されていない: {preflight.status_code}"
    )
    assert preflight.headers.get("access-control-allow-origin") is None

    # 実リクエストでも許可ヘッダーを返さない（ブラウザ側で遮断される）
    actual = client.get("/api/v1/health", headers={"Origin": evil})
    assert actual.headers.get("access-control-allow-origin") is None, (
        "未許可オリジンに access-control-allow-origin を返している"
    )
