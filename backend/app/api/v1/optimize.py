from fastapi import APIRouter, Request
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.engine.solver import solve_shift_schedule
from app.schemas.scheduler import (
    ShiftOptimizeRequest,
    ShiftOptimizeResponse,
)

limiter = Limiter(key_func=get_remote_address)
router = APIRouter(tags=["Optimization"])


@router.post("/optimize", response_model=ShiftOptimizeResponse)
@limiter.limit("5/minute")
async def optimize_schedule(
    request: Request,
    payload: ShiftOptimizeRequest,
) -> ShiftOptimizeResponse:
    return solve_shift_schedule(payload)
