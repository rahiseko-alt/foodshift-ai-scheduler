from fastapi import APIRouter

from app.api.v1.health import router as health_router
from app.api.v1.optimize import router as optimize_router

api_v1_router = APIRouter(prefix="/api/v1")
api_v1_router.include_router(health_router)
api_v1_router.include_router(optimize_router)
