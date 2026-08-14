from fastapi import APIRouter

router = APIRouter(tags=["Health"])


@router.get("/health")
async def health_check() -> dict:
    try:
        from ortools.sat.python import cp_model  # noqa: F401

        ortools_ok = True
    except ImportError:
        ortools_ok = False

    return {
        "status": "ok",
        "version": "1.0.0",
        "ortools_available": ortools_ok,
    }
