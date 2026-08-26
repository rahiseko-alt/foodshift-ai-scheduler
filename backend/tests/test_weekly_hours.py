"""週間労働時間上限（ローリング7日窓）の検証。

修正前の状態:

* `hourly_solver` は一般スタッフの `max_weekly_hours` を一切参照しておらず、
  管理画面からの最適化は全てこのソルバーに到達するため、
  36協定・契約上の週上限が本番経路で丸ごと無効だった
  （週20時間契約のスタッフに 50.75 時間が割り当てられる状態）。
* `constraints.py` は非重複ブロックで窓を張っていたため、
  num_days=31 では day28-30 が、num_days=10 では day7-9 が
  どの窓にも入らず完全に無制約だった。
* いずれも非ローリングのため、ブロック境界を跨ぐ連続7日は上限を超過できた。

**単位について**: `hourly_solver` は休憩をモデル変数として持たないため、
上限は拘束時間（gross）に対して適用される。テストも `hourly_schedule` から
拘束時間を集計する。`summary.total_work_hours` は休憩控除後（net）かつ
全スタッフ合計であり、上限の検証には使えない。
"""

import pytest

from app.engine.solver import solve_shift_schedule
from app.schemas.scheduler import (
    HourlyRequirementSchema,
    PeriodSchema,
    ShiftOptimizeRequest,
    ShiftRequirementSchema,
    ShiftSchema,
    StaffMemberSchema,
)

WINDOW = 7
DEFAULT_DEMAND_HOURS = tuple(range(10, 18))


def build_hourly_request(staff: list[StaffMemberSchema], days: int, hours=DEFAULT_DEMAND_HOURS):
    return ShiftOptimizeRequest(
        period=PeriodSchema(start_date="2026-09-01", days=days),
        staff_members=staff,
        hourly_requirements=[
            HourlyRequirementSchema(day_offset=d, hour=h, min_staff=1)
            for d in range(days)
            for h in hours
        ],
    )


def gross_hours_in_window(response, staff_id: str, start_day: int) -> int:
    """レスポンスから、指定7日窓における拘束時間（時間数）を集計する。"""
    window = range(start_day, start_day + WINDOW)
    return sum(
        1
        for slot in response.hourly_schedule
        if staff_id in slot.assigned_staff_ids and slot.day_offset in window
    )


def max_gross_hours_over_all_windows(response, staff_id: str, days: int) -> int:
    """任意の連続7日窓における拘束時間の最大値。"""
    return max(
        gross_hours_in_window(response, staff_id, start)
        for start in range(max(1, days - WINDOW + 1))
    )


def assert_solution_is_substantive(response, staff_id: str) -> None:
    """上限テストが「解なし」で空振りしていないことを保証する。

    週上限は上界のみを主張するため、モデルを過剰に制約して INFEASIBLE に
    してしまう実装や、常に空の解を返す実装でも上界は満たせてしまう。
    下界を併せて要求することでそれを排除する。
    """
    assert response.status != "INFEASIBLE", "解が得られていない（上界テストが空振りしている）"
    assigned = {s.staff_id for s in response.assigned_shifts}
    assert staff_id in assigned, "対象スタッフに1件も割当がない（上界テストが空振りしている）"


# --------------------------------------------------------------------------
# 一般スタッフの週上限（hourly ソルバーに存在しなかった制約）
# --------------------------------------------------------------------------


def test_hourly_solver_enforces_general_max_weekly_hours() -> None:
    """週20時間契約のスタッフが7日×8時間の需要でも20時間を超えない。

    修正前はこの条件で 50.75 時間（拘束 56 時間）が割り当てられていた。
    """
    staff = StaffMemberSchema(
        id="p1",
        name="パート",
        roles=["hall"],
        hourly_wage=1000,
        max_weekly_hours=20.0,
        max_consecutive_days=7,
    )
    res = solve_shift_schedule(build_hourly_request([staff], days=7))

    assert_solution_is_substantive(res, "p1")
    assert gross_hours_in_window(res, "p1", 0) <= 20


def test_hourly_solver_weekly_cap_is_rolling() -> None:
    """ブロック境界を跨ぐ任意の連続7日窓でも上限を超えない。

    非重複ブロック実装では day3-day9 のような窓が無制限になっていた。
    """
    staff = StaffMemberSchema(
        id="p1",
        name="パート",
        roles=["hall"],
        hourly_wage=1000,
        max_weekly_hours=20.0,
        max_consecutive_days=7,
    )
    res = solve_shift_schedule(build_hourly_request([staff], days=14))

    assert_solution_is_substantive(res, "p1")
    assert max_gross_hours_over_all_windows(res, "p1", 14) <= 20


def test_foreign_student_capped_by_own_lower_limit() -> None:
    """留学生の上限は 28 固定ではなく本人設定との厳しい方が適用される。"""
    staff = StaffMemberSchema(
        id="fs",
        name="留学生",
        roles=["hall"],
        hourly_wage=1000,
        is_foreign_student=True,
        max_weekly_hours=20.0,
        max_consecutive_days=7,
    )
    res = solve_shift_schedule(build_hourly_request([staff], days=7))

    assert_solution_is_substantive(res, "fs")
    assert gross_hours_in_window(res, "fs", 0) <= 20


def test_foreign_student_28h_cap_rolling_window() -> None:
    """留学生の28時間規制は任意の連続7日窓で成立する（起算日非依存）。"""
    staff = StaffMemberSchema(
        id="fs",
        name="留学生",
        roles=["hall"],
        hourly_wage=1000,
        is_foreign_student=True,
        max_weekly_hours=28.0,
        max_consecutive_days=7,
    )
    res = solve_shift_schedule(build_hourly_request([staff], days=14))

    assert_solution_is_substantive(res, "fs")
    assert max_gross_hours_over_all_windows(res, "fs", 14) <= 28


def test_weekly_cap_covers_tail_days_at_31_days() -> None:
    """num_days=31（スキーマ上限）で末尾の day28-30 も週上限の対象になる。

    旧実装 range(0, max(1, num_days - 6), 7) では day28-30 がどの窓にも
    入らず、月次シフトという最頻ユースケースが無制約だった。
    """
    staff = StaffMemberSchema(
        id="p1",
        name="パート",
        roles=["hall"],
        hourly_wage=1000,
        max_weekly_hours=20.0,
        max_consecutive_days=7,
    )
    res = solve_shift_schedule(build_hourly_request([staff], days=31))

    assert_solution_is_substantive(res, "p1")
    # 末尾3日を含む窓 (day24-30) を明示的に検証する
    assert gross_hours_in_window(res, "p1", 24) <= 20
    assert max_gross_hours_over_all_windows(res, "p1", 31) <= 20


def test_shift_solver_weekly_cap_covers_tail_days() -> None:
    """シフト枠ベースのソルバーでも末尾日が週上限の対象になる。"""
    staff = StaffMemberSchema(
        id="p1",
        name="パート",
        roles=["hall"],
        hourly_wage=1000,
        max_weekly_hours=16.0,
        max_consecutive_days=7,
    )
    days = 10
    shift = ShiftSchema(
        id="day", name="日勤", start="10:00", end="18:00", hours=8.0, break_minutes=45
    )
    res = solve_shift_schedule(
        ShiftOptimizeRequest(
            period=PeriodSchema(start_date="2026-09-01", days=days),
            staff_members=[staff],
            shifts=[shift],
            requirements=[
                ShiftRequirementSchema(day_offset=d, shift_id="day", min_staff=1)
                for d in range(days)
            ],
        )
    )

    assert res.status != "INFEASIBLE"
    worked_days = sorted({s.day_offset for s in res.assigned_shifts if s.staff_id == "p1"})
    assert worked_days, "1件も割当がない（上界テストが空振りしている）"
    # 旧実装では day7-9 が無制約だったため、そこだけ連続勤務できてしまった
    for start in range(days - WINDOW + 1):
        in_window = [d for d in worked_days if start <= d < start + WINDOW]
        # net 7.25h/日 × 2日 = 14.5h <= 16h、3日なら 21.75h > 16h
        assert len(in_window) <= 2, f"day{start}-{start + 6} の窓で週上限を超過"


# --------------------------------------------------------------------------
# 変異テスト: 上限値の変更に出力が連動する（定数返し・過剰制約の排除）
# --------------------------------------------------------------------------


@pytest.mark.parametrize("cap,expected_max", [(8, 8), (20, 20), (40, 40)])
def test_assigned_hours_track_the_configured_cap(cap: int, expected_max: int) -> None:
    """上限を上げると実際に割当時間が増える。

    「常に少なく返す」「常に上限いっぱい返す」といった実装を排除する。
    """
    staff = StaffMemberSchema(
        id="p1",
        name="パート",
        roles=["hall"],
        hourly_wage=1000,
        max_weekly_hours=float(cap),
        max_consecutive_days=7,
    )
    res = solve_shift_schedule(build_hourly_request([staff], days=7))

    assert_solution_is_substantive(res, "p1")
    worked = gross_hours_in_window(res, "p1", 0)
    assert worked <= expected_max
    # 需要は 7日×8時間=56時間あるため、上限まで使い切れるはず
    assert worked > expected_max - 8, f"上限 {cap} に対し {worked} 時間しか割り当てられていない"


# --------------------------------------------------------------------------
# 解が得られない場合の説明責任
# --------------------------------------------------------------------------


def test_weekly_cap_vs_min_days_conflict_names_the_staff() -> None:
    """週上限と最小出勤日数の矛盾は、汎用文言でなく該当設定を名指しで返す。

    min_days_per_period は緩和変数を持たない Hard 制約のため、
    週上限と衝突すると人員不足ではなく INFEASIBLE になる。
    「制約の競合により実行可能解が見つかりませんでした」だけでは
    店長がどの設定を直せばよいか判断できない。
    """
    staff = StaffMemberSchema(
        id="p1",
        name="山田",
        roles=["hall"],
        hourly_wage=1000,
        max_weekly_hours=10.0,
        min_days_per_period=6,
        max_consecutive_days=7,
    )
    days = 7
    shift = ShiftSchema(
        id="day", name="日勤", start="10:00", end="18:00", hours=8.0, break_minutes=45
    )
    res = solve_shift_schedule(
        ShiftOptimizeRequest(
            period=PeriodSchema(start_date="2026-09-01", days=days),
            staff_members=[staff],
            shifts=[shift],
            requirements=[
                ShiftRequirementSchema(day_offset=d, shift_id="day", min_staff=1)
                for d in range(days)
            ],
        )
    )

    assert res.status == "INFEASIBLE"
    message = " ".join(res.summary.bottleneck_constraints)
    assert "山田" in message, "どのスタッフの設定が矛盾しているか名指しすること"
    assert "p1" in message
    assert "最小出勤日数" in message and "週間労働時間上限" in message


def test_hourly_solver_performance_15_staff_14_days() -> None:
    """TAC-1 相当の規模を hourly ソルバーが5秒以内に処理する。

    本番トラフィックは全て hourly ソルバーに到達するにもかかわらず、
    従来この経路には性能テストが1件も存在しなかった。
    """
    import time

    staff = [
        StaffMemberSchema(
            id=f"s{i}",
            name=f"スタッフ{i}",
            roles=["hall"] if i % 2 else ["kitchen"],
            hourly_wage=1000 + i * 10,
            max_weekly_hours=40.0 if i <= 5 else 20.0,
            max_consecutive_days=5,
        )
        for i in range(1, 16)
    ]
    request = ShiftOptimizeRequest(
        period=PeriodSchema(start_date="2026-09-01", days=14),
        staff_members=staff,
        hourly_requirements=[
            HourlyRequirementSchema(day_offset=d, hour=h, min_staff=2)
            for d in range(14)
            for h in range(11, 22)
        ],
    )

    started = time.time()
    res = solve_shift_schedule(request)
    elapsed = time.time() - started

    assert elapsed < 5.0, f"15人×14日の求解に {elapsed:.2f} 秒かかった"
    assert res.status != "INFEASIBLE"
    assert res.assigned_shifts, "解が空（性能テストが空振りしている）"


def test_unknown_status_is_not_reported_as_constraint_conflict() -> None:
    """制限時間切れ(UNKNOWN)を制約矛盾(INFEASIBLE)と同じ文言で返さない。

    CP-SAT の UNKNOWN は「制限時間内に解を発見できなかった」であり、
    制約が矛盾しているとは限らない。同じ文言で返すと、実際には規模の
    問題なのに店長が設定を疑って延々と直すことになる。

    UNKNOWN をタイミング依存で再現するのはフレーキーなため、
    分岐関数を直接検証する。
    """
    from ortools.sat.python import cp_model

    from app.engine.constraints import describe_no_solution

    staff = StaffMemberSchema(id="p1", name="パート", roles=["hall"], hourly_wage=1000)
    shift = ShiftSchema(
        id="day", name="日勤", start="10:00", end="18:00", hours=8.0, break_minutes=45
    )
    request = ShiftOptimizeRequest(
        period=PeriodSchema(start_date="2026-09-01", days=1),
        staff_members=[staff],
        shifts=[shift],
        requirements=[ShiftRequirementSchema(day_offset=0, shift_id="day", min_staff=1)],
    )

    timeout_msg = " ".join(describe_no_solution(request, cp_model.UNKNOWN))
    conflict_msg = " ".join(describe_no_solution(request, cp_model.INFEASIBLE))

    assert timeout_msg != conflict_msg, "UNKNOWN と INFEASIBLE が同じ文言になっている"
    assert "制限時間" in timeout_msg
    assert "矛盾しているとは限りません" in timeout_msg
    assert "制約の競合" in conflict_msg
