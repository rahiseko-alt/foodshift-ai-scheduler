from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.api.v1.optimize import limiter
from app.api.v1.router import api_v1_router
from app.config import settings
from app.middleware.payload_limit import LimitPayloadSizeMiddleware
from app.middleware.security_headers import SecurityHeadersMiddleware

app = FastAPI(
    title="FoodShift Scheduler API",
    version="1.0.0",
    docs_url="/docs" if settings.environment == "development" else None,
    redoc_url=None,
)

# レート制限初期化
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# ミドルウェア登録 (順序重要: SecurityHeaders -> PayloadLimit -> CORS)
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(LimitPayloadSizeMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

# ルーター登録
app.include_router(api_v1_router)
