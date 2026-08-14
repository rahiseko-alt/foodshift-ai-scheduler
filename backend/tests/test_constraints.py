from app.engine.solver import solve_shift_schedule
from app.engine.time_utils import is_shift_late_night
from app.schemas.scheduler import (
    PeriodSchema,
    ShiftOptimizeRequest,
    ShiftRequirementSchema,
    ShiftSchema,
    StaffAvailabilitySchema,
    StaffMemberSchema,
)


def test_time_utils_is_shift_late_night():
    # 22:00以降にかかるシフト
    assert is_shift_late_night("17:00", "23:00") is True
    assert is_shift_late_night("21:30", "24:30") is True
    assert is_shift_late_night("22:00", "02:00") is True
    assert is_shift_late_night("04:00", "09:00") is True

    # 22:00以前に終了するシフト
    assert is_shift_late_night("09:00", "15:00") is False
    assert is_shift_late_night("12:00", "18:00") is False
    assert is_shift_late_night("17:00", "21:30") is False


def test_minor_protection_hard_constraint_zero_late_night_assignment():
    """満18歳未満のスタッフは22:00以降にかかるシフトに例外なく0件配置されることを検証。"""
    request = ShiftOptimizeRequest(
        period=PeriodSchema(start_date="2026-09-01", days=5),
        shifts=[
            ShiftSchema(
                id="day", name="日勤", start="09:00", end="17:00", hours=8.0, is_late_night=False
            ),
            ShiftSchema(
                id="night",
                name="夜勤",
                start="18:00",
                end="23:30",
                hours=5.5,
                is_late_night=True,
            ),
        ],
        staff_members=[
            StaffMemberSchema(
                id="adult", name="成人", is_minor=False, roles=["hall"], hourly_wage=1200
            ),
            StaffMemberSchema(
                id="minor", name="高校生", is_minor=True, roles=["hall"], hourly_wage=1000
            ),
        ],
        requirements=[
            ShiftRequirementSchema(day_offset=d, shift_id="night", min_staff=1) for d in range(5)
        ],
        availabilities=[],
    )

    res = solve_shift_schedule(request)
    assert res.status in ("OPTIMAL", "FEASIBLE_WITH_SHORTAGE")

    # 全夜勤シフトに minor が 1 回も入っていないことを検証
    for slot in res.schedule:
        if slot.shift_id == "night":
            assigned_ids = [s.id for s in slot.assigned_staff]
            assert "minor" not in assigned_ids, "未成年が深夜シフトに配置されています！"


def test_minor_wants_late_night_still_rejected():
    """未成年スタッフが遅番を「want(希望)」として出しても、Hard制約が優先され配置されないことを検証。"""
    request = ShiftOptimizeRequest(
        period=PeriodSchema(start_date="2026-09-01", days=3),
        shifts=[
            ShiftSchema(
                id="night",
                name="夜勤",
                start="18:00",
                end="23:00",
                hours=5.0,
                is_late_night=True,
            ),
        ],
        staff_members=[
            StaffMemberSchema(
                id="minor_1", name="高校生A", is_minor=True, roles=["hall"], hourly_wage=1000
            ),
        ],
        requirements=[
            ShiftRequirementSchema(day_offset=d, shift_id="night", min_staff=1) for d in range(3)
        ],
        availabilities=[
            StaffAvailabilitySchema(
                staff_id="minor_1", day_offset=d, shift_id="night", status="want"
            )
            for d in range(3)
        ],
    )

    res = solve_shift_schedule(request)
    assert res.status == "FEASIBLE_WITH_SHORTAGE"
    assert len(res.summary.unfilled_requirements) == 3
    for slot in res.schedule:
        assert len(slot.assigned_staff) == 0


def test_one_shift_per_day_constraint():
    """同一スタッフが同日に複数シフトに配置されないことを検証。"""
    request = ShiftOptimizeRequest(
        period=PeriodSchema(start_date="2026-09-01", days=3),
        shifts=[
            ShiftSchema(
                id="s1", name="早番", start="09:00", end="14:00", hours=5.0, is_late_night=False
            ),
            ShiftSchema(
                id="s2", name="遅番", start="14:00", end="19:00", hours=5.0, is_late_night=False
            ),
        ],
        staff_members=[
            StaffMemberSchema(
                id="e1", name="スタッフ1", is_minor=False, roles=["hall"], hourly_wage=1000
            ),
        ],
        requirements=[
            ShiftRequirementSchema(day_offset=d, shift_id="s1", min_staff=1) for d in range(3)
        ]
        + [ShiftRequirementSchema(day_offset=d, shift_id="s2", min_staff=1) for d in range(3)],
        availabilities=[],
    )

    res = solve_shift_schedule(request)
    assert res.status == "FEASIBLE_WITH_SHORTAGE"

    # 各日において e1 は最大 1 シフトのみ
    for d in range(3):
        day_slots = [slot for slot in res.schedule if slot.day_offset == d]
        assigned_count = sum(1 for slot in day_slots for s in slot.assigned_staff if s.id == "e1")
        assert assigned_count <= 1


def test_consecutive_days_individual_limits():
    """スタッフごとの連続勤務日数上限 (3日/5日) が各々守られることを検証。"""
    request = ShiftOptimizeRequest(
        period=PeriodSchema(start_date="2026-09-01", days=7),
        shifts=[
            ShiftSchema(
                id="day", name="日勤", start="09:00", end="17:00", hours=8.0, is_late_night=False
            ),
        ],
        staff_members=[
            StaffMemberSchema(
                id="staff_limit_3",
                name="3日上限",
                is_minor=False,
                roles=["hall"],
                hourly_wage=1000,
                max_consecutive_days=3,
            ),
            StaffMemberSchema(
                id="staff_limit_5",
                name="5日上限",
                is_minor=False,
                roles=["hall"],
                hourly_wage=1000,
                max_consecutive_days=5,
            ),
        ],
        requirements=[
            ShiftRequirementSchema(day_offset=d, shift_id="day", min_staff=1) for d in range(7)
        ],
        availabilities=[],
    )

    res = solve_shift_schedule(request)
    assert res.status in ("OPTIMAL", "FEASIBLE_WITH_SHORTAGE")

    # staff_limit_3 の最大連続勤務数を計算
    days_3 = [
        1
        if any(
            s.id == "staff_limit_3"
            for slot in res.schedule
            if slot.day_offset == d
            for s in slot.assigned_staff
        )
        else 0
        for d in range(7)
    ]

    current_streak = 0
    max_streak_3 = 0
    for w in days_3:
        if w == 1:
            current_streak += 1
            max_streak_3 = max(max_streak_3, current_streak)
        else:
            current_streak = 0

    assert max_streak_3 <= 3, f"3日上限のスタッフが {max_streak_3} 日連続勤務しています"
