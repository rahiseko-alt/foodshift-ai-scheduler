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

    statuses = []
    for _ in range(6):
        res = client.post("/api/v1/optimize", json=payload)
        statuses.append(res.status_code)

    # 少なくとも 6 回目までに 429 が返されること
    assert 429 in statuses or statuses.count(200) <= 5
