import pytest

from app.engine.hourly_solver import solve_hourly_shift_schedule
from app.schemas.scheduler import (
    HourlyRequirementSchema,
    PeriodSchema,
    ShiftOptimizeRequest,
    StaffHourlyAvailabilitySchema,
    StaffMemberSchema,
)


@pytest.fixture
def base_staff():
    return [
        StaffMemberSchema(
            id="s1",
            name="佐藤(一般)",
            roles=["kitchen"],
            hourly_wage=1200,
            max_consecutive_days=5,
            max_weekly_hours=40.0,
            is_minor=False,
        ),
        StaffMemberSchema(
            id="s2",
            name="田中(一般)",
            roles=["hall"],
            hourly_wage=1100,
            max_consecutive_days=5,
            max_weekly_hours=40.0,
            is_minor=False,
        ),
        StaffMemberSchema(
            id="s3",
            name="高橋(高校生・年少者)",
            roles=["hall"],
            hourly_wage=1050,
            max_consecutive_days=4,
            max_weekly_hours=20.0,
            is_minor=True,
        ),
        StaffMemberSchema(
            id="s4",
            name="グエン(留学生)",
            roles=["kitchen"],
            hourly_wage=1150,
            max_consecutive_days=5,
            max_weekly_hours=28.0,
            is_minor=False,
            is_foreign_student=True,
        ),
    ]


def test_hourly_continuous_shift_generation(base_staff):
    """TV-H1: 1日1回連続勤務（飛び石なし、最低3h以上）の出退勤時間が動的に生成される。"""
    # 10:00〜14:00 (4時間) に各時間2名必要
    reqs = [
        HourlyRequirementSchema(day_offset=0, hour=h, min_staff=2)
        for h in range(10, 14)
    ]
    req = ShiftOptimizeRequest(
        period=PeriodSchema(start_date="2026-09-01", days=1),
        staff_members=base_staff,
        hourly_requirements=reqs,
        min_shift_hours=3,
        max_shift_hours=8,
    )

    res = solve_hourly_shift_schedule(req)
    assert res.status in ("OPTIMAL", "FEASIBLE_WITH_SHORTAGE")
    assert len(res.assigned_shifts) >= 2

    # 各スタッフの勤務時間が連続していること（10:00〜14:00等）
    for assigned in res.assigned_shifts:
        start_h = int(assigned.start_time.split(":")[0])
        end_h = int(assigned.end_time.split(":")[0])
        assert end_h > start_h
        assert assigned.hours >= 3.0  # 最低3h
        assert assigned.labor_cost > 0


def test_hourly_minor_night_prohibition(base_staff):
    """TV-H3: 年少者は22:00〜05:00のスロットに一切割り当てられない。"""
    # 18:00〜24:00 (6時間) に各時間1名必要
    reqs = [
        HourlyRequirementSchema(day_offset=0, hour=h, min_staff=1)
        for h in range(18, 24)
    ]
    req = ShiftOptimizeRequest(
        period=PeriodSchema(start_date="2026-09-01", days=1),
        staff_members=base_staff,
        hourly_requirements=reqs,
        min_shift_hours=3,
    )

    res = solve_hourly_shift_schedule(req)
    assert res.status in ("OPTIMAL", "FEASIBLE_WITH_SHORTAGE")

    # 年少者 s3 のシフトを確認
    minor_shifts = [s for s in res.assigned_shifts if s.staff_id == "s3"]
    for s in minor_shifts:
        end_h = int(s.end_time.split(":")[0])
        assert end_h <= 22  # 22時以降にかかる勤務は絶対なし
        assert s.is_late_night is False


def test_hourly_foreign_student_28h_limit(base_staff):
    """TV-H4: 留学生は週間28時間を絶対に超過しない。"""
    # 7日間にわたり毎日 10:00〜16:00 (6時間) 必要
    reqs = [
        HourlyRequirementSchema(day_offset=d, hour=h, min_staff=1)
        for d in range(7)
        for h in range(10, 16)
    ]
    req = ShiftOptimizeRequest(
        period=PeriodSchema(start_date="2026-09-01", days=7),
        staff_members=base_staff,
        hourly_requirements=reqs,
        min_shift_hours=3,
    )

    res = solve_hourly_shift_schedule(req)
    assert res.status in ("OPTIMAL", "FEASIBLE_WITH_SHORTAGE")

    # 留学生 s4 の総時間を集計
    student_shifts = [s for s in res.assigned_shifts if s.staff_id == "s4"]
    total_hours = sum(s.hours for s in student_shifts)
    assert total_hours <= 28.0


def test_hourly_staff_availability_preference(base_staff):
    """TV-H5: スタッフの出勤可能時間帯外には割り当てられない。"""
    # 佐藤 s1 は 14:00〜18:00 のみ可
    avail = [
        StaffHourlyAvailabilitySchema(
            staff_id="s1",
            day_offset=0,
            available_from=14,
            available_to=18,
            is_available=True,
            is_preferred=True,
        )
    ]
    reqs = [
        HourlyRequirementSchema(day_offset=0, hour=h, min_staff=1)
        for h in range(10, 20)
    ]
    req = ShiftOptimizeRequest(
        period=PeriodSchema(start_date="2026-09-01", days=1),
        staff_members=base_staff,
        hourly_requirements=reqs,
        hourly_availabilities=avail,
        min_shift_hours=3,
    )

    res = solve_hourly_shift_schedule(req)
    s1_shifts = [s for s in res.assigned_shifts if s.staff_id == "s1"]
    if s1_shifts:
        assert int(s1_shifts[0].start_time.split(":")[0]) >= 14
        assert int(s1_shifts[0].end_time.split(":")[0]) <= 18
