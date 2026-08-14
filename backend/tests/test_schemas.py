import pytest
from pydantic import ValidationError

from app.schemas.scheduler import (
    PeriodSchema,
    ShiftOptimizeRequest,
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


def test_staff_member_wage_boundaries():
    with pytest.raises(ValidationError):
        StaffMemberSchema(
            id="emp_1",
            name="Test",
            hourly_wage=799,  # ge=800
            roles=["hall"],
        )

    staff = StaffMemberSchema(
        id="emp_1",
        name="Test",
        hourly_wage=800,
        roles=["hall"],
    )
    assert staff.hourly_wage == 800


def test_request_schema_rejects_empty_lists():
    with pytest.raises(ValidationError):
        ShiftOptimizeRequest(
            period=PeriodSchema(start_date="2026-09-01", days=7),
            shifts=[],  # min_length=1
            staff_members=[StaffMemberSchema(id="e1", name="A", hourly_wage=1000, roles=["hall"])],
            requirements=[],
        )
