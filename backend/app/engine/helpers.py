from collections.abc import Sequence
from typing import Any

from ortools.sat.python import cp_model

WEEK_WINDOW_DAYS = 7


def add_consecutive_days_constraint(
    model: cp_model.CpModel,
    works_per_day: Sequence[cp_model.IntVar],
    max_consecutive: int,
) -> None:
    """スタッフの連続勤務日数を max_consecutive 日以内に制限する Hard 制約を追加する。

    works_per_day: 各日の出勤フラグ (0 or 1) のリスト (長さ num_days)
    """
    num_days = len(works_per_day)
    window_size = max_consecutive + 1

    for start_day in range(num_days - window_size + 1):
        # window_size 日間の合計出勤数は max_consecutive 以下でなければならない
        # （＝window_size 日間連続して 1 になることは禁止）
        window = [works_per_day[start_day + d] for d in range(window_size)]
        model.Add(sum(window) <= max_consecutive)


def add_rolling_window_limit(
    model: cp_model.CpModel,
    per_day_exprs: Sequence[Any],
    limit: int,
    window_size: int = WEEK_WINDOW_DAYS,
) -> None:
    """任意の連続 window_size 日について、日次量の合計を limit 以下に制限する。

    週労働時間の上限に用いる。非重複ブロック（0-6日, 7-13日...）では
    ブロック境界を跨ぐ連続7日間が無制限になってしまうため、
    **すべての開始日**について窓を張る（ローリング窓）。

    留学生の資格外活動28時間規制は「起算日を問わずどの連続7日でも」が
    要件であるため、非ローリング実装は法令上そもそも不適格。

    per_day_exprs: 各日の量（分・時間など）を表す線形式のリスト。
                   単位は呼び出し側の責任で limit と揃えること。
    """
    num_days = len(per_day_exprs)
    # 期間が窓より短い場合も制約が消えないよう、最低1本は張る
    # （range(負数) は空になり、上限が丸ごと失われる）
    for start_day in range(max(1, num_days - window_size + 1)):
        window = per_day_exprs[start_day : start_day + window_size]
        model.Add(sum(window) <= limit)
