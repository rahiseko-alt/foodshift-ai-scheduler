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
