from collections.abc import Sequence

from ortools.sat.python import cp_model


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
