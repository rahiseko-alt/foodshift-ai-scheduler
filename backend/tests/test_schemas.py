import pytest
from pydantic import ValidationError

from app.schemas.scheduler import (
    FixedAssignmentSchema,
    PeriodSchema,
    ScheduleSummarySchema,
    ShiftOptimizeRequest,
    ShiftSchema,
    StaffMemberSchema,
)


def test_valid_period_schema():
    p = PeriodSchema(start_date="2026-09-01", days=14)
    assert p.days == 14


def test_invalid_period_schema_rejects_out_of_range():
    with pytest.raises(ValidationError):
        PeriodSchema(start_date="2026-09-01", days=0)  # ge=1

    with pytest.raises(ValidationError):
        PeriodSchema(start_date="2026-09-01", days=32)  # le=31


def test_staff_member_wage_and_days_boundaries():
    with pytest.raises(ValidationError):
        StaffMemberSchema(
            id="emp_1",
            name="Test",
            hourly_wage=799,  # ge=800
            roles=["hall"],
        )

    with pytest.raises(ValidationError):
        StaffMemberSchema(
            id="emp_1",
            name="Test",
            hourly_wage=1000,
            roles=["hall"],
            min_days_per_period=-1,  # ge=0
        )

    with pytest.raises(ValidationError):
        StaffMemberSchema(
            id="emp_1",
            name="Test",
            hourly_wage=1000,
            roles=["hall"],
            max_days_per_period=32,  # le=31
        )

    staff = StaffMemberSchema(
        id="emp_1",
        name="Test",
        hourly_wage=800,
        roles=["hall"],
        ng_staff_ids=["emp_2"],
        preferred_partner_ids=["emp_3"],
        min_days_per_period=2,
        max_days_per_period=10,
    )
    assert staff.hourly_wage == 800
    assert staff.ng_staff_ids == ["emp_2"]
    assert staff.preferred_partner_ids == ["emp_3"]
    assert staff.min_days_per_period == 2
    assert staff.max_days_per_period == 10


def test_shift_schema_break_minutes():
    with pytest.raises(ValidationError):
        ShiftSchema(
            id="s1",
            name="Test",
            start="09:00",
            end="17:00",
            hours=8.0,
            break_minutes=181,  # le=180
        )

    shift = ShiftSchema(
        id="s1",
        name="Test",
        start="09:00",
        end="17:00",
        hours=8.0,
        break_minutes=60,
    )
    assert shift.break_minutes == 60


def test_request_schema_rejects_empty_lists():
    with pytest.raises(ValidationError):
        ShiftOptimizeRequest(
            period=PeriodSchema(start_date="2026-09-01", days=7),
            shifts=[],  # min_length=1
            staff_members=[StaffMemberSchema(id="e1", name="A", hourly_wage=1000, roles=["hall"])],
            requirements=[],
        )


def test_request_schema_min_interval_and_fixed_assignments():
    with pytest.raises(ValidationError):
        ShiftOptimizeRequest(
            period=PeriodSchema(start_date="2026-09-01", days=7),
            shifts=[ShiftSchema(id="s1", name="S1", start="09:00", end="17:00", hours=8.0)],
            staff_members=[StaffMemberSchema(id="e1", name="A", hourly_wage=1000, roles=["hall"])],
            requirements=[],
            min_interval_hours=25.0,  # le=24.0
        )

    req = ShiftOptimizeRequest(
        period=PeriodSchema(start_date="2026-09-01", days=7),
        shifts=[ShiftSchema(id="s1", name="S1", start="09:00", end="17:00", hours=8.0)],
        staff_members=[StaffMemberSchema(id="e1", name="A", hourly_wage=1000, roles=["hall"])],
        requirements=[],
        min_interval_hours=12.0,
        fixed_assignments=[FixedAssignmentSchema(staff_id="e1", day_offset=0, shift_id="s1")],
    )
    assert req.min_interval_hours == 12.0
    assert len(req.fixed_assignments) == 1


def test_schedule_summary_schema_fields():
    summary = ScheduleSummarySchema(
        total_labor_cost=10000,
        total_work_hours=40.0,
        total_break_hours=5.0,
        deep_night_extra_cost=500,
        wants_fulfillment_rate=0.85,
        max_staff_day_difference=2,
        bottleneck_constraints=["制約分析"],
    )
    assert summary.total_break_hours == 5.0
    assert summary.deep_night_extra_cost == 500
    assert summary.bottleneck_constraints == ["制約分析"]


def test_staff_member_foreign_student_and_maternity_and_birth_date():
    # 留学生は週28時間以下で有効
    staff_valid = StaffMemberSchema(
        id="f_valid",
        name="留学生A",
        hourly_wage=1000,
        roles=["hall"],
        is_foreign_student=True,
        max_weekly_hours=28.0,
        is_maternity_protection=True,
        birth_date="2004-03-15",
    )
    assert staff_valid.is_foreign_student is True
    assert staff_valid.is_maternity_protection is True
    assert staff_valid.birth_date == "2004-03-15"
    assert staff_valid.max_weekly_hours == 28.0

    # 留学生で28時間超はバリデーションエラー
    with pytest.raises(ValidationError):
        StaffMemberSchema(
            id="f_invalid",
            name="留学生B",
            hourly_wage=1000,
            roles=["hall"],
            is_foreign_student=True,
            max_weekly_hours=28.5,
        )

    # 生年月日のフォーマット違反
    with pytest.raises(ValidationError):
        StaffMemberSchema(
            id="b_invalid",
            name="無効日付",
            hourly_wage=1000,
            roles=["hall"],
            birth_date="2004/03/15",  # YYYY-MM-DD でなければならない
        )


def test_shift_schema_hours_consistency_validation():
    # 整合している場合 (09:00〜17:00 = 8.0h)
    s_valid = ShiftSchema(
        id="s_ok",
        name="日勤",
        start="09:00",
        end="17:00",
        hours=8.0,
    )
    assert s_valid.hours == 8.0

    # 日跨ぎ (22:00〜02:00 = 4.0h)
    s_night = ShiftSchema(
        id="s_night",
        name="深夜",
        start="22:00",
        end="02:00",
        hours=4.0,
        is_late_night=True,
    )
    assert s_night.hours == 4.0

    # 不整合 (09:00〜17:00 なのに hours=5.0) -> ValidationError
    with pytest.raises(ValidationError):
        ShiftSchema(
            id="s_bad",
            name="不整合シフト",
            start="09:00",
            end="17:00",
            hours=5.0,
        )


def test_shift_requirement_schema_min_staff_upper_bound():
    from app.schemas.scheduler import ShiftRequirementSchema

    # min_staff=50 は有効
    req_valid = ShiftRequirementSchema(
        day_offset=0,
        shift_id="s1",
        min_staff=50,
    )
    assert req_valid.min_staff == 50

    # min_staff=51 は上限超過エラー
    with pytest.raises(ValidationError):
        ShiftRequirementSchema(
            day_offset=0,
            shift_id="s1",
            min_staff=51,
        )
