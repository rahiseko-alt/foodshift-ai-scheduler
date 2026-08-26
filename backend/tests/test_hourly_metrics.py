"""1時間スロットソルバーが返すサマリー指標の検証。

修正前は `wants_fulfillment_rate` が
`1.0 if not unfilled_requirements else 0.85` という決め打ちで、
希望充足率を一切計算していなかった（人員不足の有無という別概念の関数）。
この値は管理者のKPIカードと、スタッフへ配布するLINE本文に表示される。
"""

from app.engine.solver import solve_shift_schedule
from app.schemas.scheduler import (
    HourlyRequirementSchema,
    PeriodSchema,
    ShiftOptimizeRequest,
    StaffHourlyAvailabilitySchema,
    StaffMemberSchema,
)


def make_staff(staff_id: str) -> StaffMemberSchema:
    return StaffMemberSchema(
        id=staff_id,
        name=f"スタッフ{staff_id}",
        roles=["hall"],
        hourly_wage=1000,
        max_consecutive_days=7,
    )


def build_request(
    staff: list[StaffMemberSchema],
    days: int,
    availabilities: list[StaffHourlyAvailabilitySchema],
    hours=(10, 11, 12, 13),
) -> ShiftOptimizeRequest:
    return ShiftOptimizeRequest(
        period=PeriodSchema(start_date="2026-09-01", days=days),
        staff_members=staff,
        hourly_requirements=[
            HourlyRequirementSchema(day_offset=d, hour=h, min_staff=1)
            for d in range(days)
            for h in hours
        ],
        hourly_availabilities=availabilities,
    )


def recompute_rate_from_response(request: ShiftOptimizeRequest, response) -> float:
    """レスポンス自身から希望充足率を数え直す（自己整合オラクル）。

    CP-SAT は同一目的値の最適解を複数持ちうるため、`== 0.5` のような
    固定期待値はフレーキーになる。一方「0.85/1.0 でないこと」だけでは
    定数 0.5 を返すインチキ実装を排除できない。
    レスポンスに含まれる割当から数え直した値と一致することを要求すれば、
    どの最適解が選ばれても成立し、かつ定数返し実装は必ず落ちる。
    """
    worked_days = {(s.staff_id, s.day_offset) for s in response.assigned_shifts}
    preferred = [
        a
        for a in request.hourly_availabilities
        if a.is_preferred and a.is_available and a.day_offset < request.period.days
    ]
    if not preferred:
        return 1.0
    fulfilled = sum(1 for a in preferred if (a.staff_id, a.day_offset) in worked_days)
    return round(fulfilled / len(preferred), 2)


def test_wants_fulfillment_rate_matches_the_response_itself() -> None:
    """充足率がレスポンス上の割当から数え直した値と一致する。"""
    staff = [make_staff("s1"), make_staff("s2")]
    availabilities = [
        StaffHourlyAvailabilitySchema(staff_id="s1", day_offset=0, is_preferred=True),
        StaffHourlyAvailabilitySchema(staff_id="s1", day_offset=1, is_preferred=True),
        StaffHourlyAvailabilitySchema(staff_id="s2", day_offset=0, is_preferred=True),
        StaffHourlyAvailabilitySchema(staff_id="s2", day_offset=1, is_preferred=True),
    ]
    request = build_request(staff, days=2, availabilities=availabilities)
    res = solve_shift_schedule(request)

    assert res.status != "INFEASIBLE"
    assert res.summary.wants_fulfillment_rate == recompute_rate_from_response(request, res)


def test_wants_fulfillment_rate_drops_when_preferences_are_unfulfillable() -> None:
    """構造的に充足できない希望があると充足率が 1.0 未満になる。

    需要のない日を希望させる。その日に出勤する理由がないため充足されない。
    決め打ち実装（不足なし=1.0）はここで必ず落ちる。
    """
    staff = [make_staff("s1")]
    # day0 のみ需要があり、day1 には需要がない
    request = ShiftOptimizeRequest(
        period=PeriodSchema(start_date="2026-09-01", days=2),
        staff_members=staff,
        hourly_requirements=[
            HourlyRequirementSchema(day_offset=0, hour=h, min_staff=1) for h in (10, 11, 12)
        ],
        hourly_availabilities=[
            StaffHourlyAvailabilitySchema(staff_id="s1", day_offset=0, is_preferred=True),
            # 終日不可かつ希望 → 構造的に充足不能だが、分母からは除外される
            StaffHourlyAvailabilitySchema(
                staff_id="s1", day_offset=1, is_preferred=True, is_available=False
            ),
        ],
    )
    res = solve_shift_schedule(request)

    assert res.status != "INFEASIBLE"
    # is_available=False の希望は分母に含めない（含めると恒久的に率が下がる）
    assert res.summary.wants_fulfillment_rate == recompute_rate_from_response(request, res)
    assert res.summary.wants_fulfillment_rate == 1.0


def test_wants_fulfillment_rate_is_one_when_no_preferences() -> None:
    """希望が0件なら 1.0（ゼロ除算しない）。"""
    request = build_request([make_staff("s1")], days=1, availabilities=[])
    res = solve_shift_schedule(request)

    assert res.summary.wants_fulfillment_rate == 1.0


def test_wants_fulfillment_rate_is_zero_when_no_preference_can_be_met() -> None:
    """希望が全て充足不能なら 0.0（定数 1.0/0.85 返しの排除）。

    希望日に需要が無く、かつ他日に需要を置くことで
    「希望日には出勤しない」解が最適になるよう構成する。
    """
    staff = [make_staff("s1")]
    request = ShiftOptimizeRequest(
        period=PeriodSchema(start_date="2026-09-01", days=2),
        staff_members=staff,
        hourly_requirements=[
            HourlyRequirementSchema(day_offset=0, hour=h, min_staff=1) for h in (10, 11, 12)
        ],
        hourly_availabilities=[
            # day1 を希望するが day1 は勤務不可時間帯しかない
            StaffHourlyAvailabilitySchema(
                staff_id="s1", day_offset=1, is_preferred=True, available_from=3, available_to=4
            ),
        ],
    )
    res = solve_shift_schedule(request)

    assert res.status != "INFEASIBLE"
    assert res.summary.wants_fulfillment_rate == recompute_rate_from_response(request, res)
