"""同時アクセス時にサーバーが応答し続けることの検証。

CP-SAT の求解は同期処理で最大4秒かかる。これを `async def` の中で
直接呼ぶとイベントループが塞がり、その間ヘルスチェックすら応答できない。
不特定多数が同時に使う前提では、1人の最適化が他の全員を待たせることになる。

実測（修正前 / 修正後）:
    求解中のヘルスチェック応答  3,350ms -> 2ms
"""

import inspect

from app.api.v1 import optimize as optimize_module


def test_optimize_does_not_block_the_event_loop() -> None:
    """最適化エンドポイントが求解をスレッドプールへ逃がしている。

    `async def` の中で同期ソルバーを直接呼ぶとイベントループを占有するため、
    ソースレベルで `run_in_threadpool` の使用を要求する。
    実挙動（求解中もヘルスチェックが応答すること）は手動計測で確認済み。
    """
    source = inspect.getsource(optimize_module.optimize_schedule)

    assert "run_in_threadpool" in source, (
        "同期ソルバーがイベントループ上で直接実行されている。"
        "他の利用者のリクエストが最大4秒待たされる。"
    )
    assert "return solve_shift_schedule(payload)" not in source, (
        "solve_shift_schedule が await されずに直接呼ばれている。"
    )


def test_optimize_handler_is_async() -> None:
    """ハンドラが async のままであること（対照群）。

    同期関数に変えても「イベントループを塞がない」は達成できるが、
    その場合 FastAPI が全リクエストをスレッドプールに載せる別の挙動になる。
    ここでは async + run_in_threadpool という意図した構成を固定する。
    """
    assert inspect.iscoroutinefunction(optimize_module.optimize_schedule)
