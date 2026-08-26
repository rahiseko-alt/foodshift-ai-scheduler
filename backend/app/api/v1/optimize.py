from fastapi import APIRouter, Request
from fastapi.concurrency import run_in_threadpool
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.engine.solver import solve_shift_schedule
from app.schemas.scheduler import (
    ShiftOptimizeRequest,
    ShiftOptimizeResponse,
)

# Render のプロキシ配下では X-Forwarded-For を信頼する必要がある。
# uvicorn 側の --proxy-headers / --forwarded-allow-ips が無いと
# 全利用者が同一IPとみなされ、この制限が実質グローバルになる
# （1人が5回操作すると全員が1分間ブロックされる）。設定は render.yaml 側。
limiter = Limiter(key_func=get_remote_address)
router = APIRouter(tags=["Optimization"])


@router.post("/optimize", response_model=ShiftOptimizeResponse)
@limiter.limit("5/minute")
async def optimize_schedule(
    request: Request,
    payload: ShiftOptimizeRequest,
) -> ShiftOptimizeResponse:
    """シフト最適化を実行する。

    CP-SAT の求解は同期処理で最大4秒かかる。`async def` の中で直接呼ぶと
    その間イベントループが塞がり、他の利用者のリクエストが待たされる
    （ヘルスチェックすら応答できなくなる）。不特定多数が同時に使う前提では
    許容できないため、スレッドプールへ逃がして並行処理できるようにする。
    """
    return await run_in_threadpool(solve_shift_schedule, payload)
