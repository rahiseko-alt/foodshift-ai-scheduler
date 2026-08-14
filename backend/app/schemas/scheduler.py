from typing import Literal

from pydantic import BaseModel, Field


class PeriodSchema(BaseModel):
    start_date: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$", description="開始日 (YYYY-MM-DD)")
    days: int = Field(..., ge=1, le=31, description="計算日数 (最大31日)")


class ShiftSchema(BaseModel):
    id: str = Field(..., min_length=1, max_length=50, pattern=r"^[a-zA-Z0-9_\-]+$")
    name: str = Field(..., min_length=1, max_length=50)
    start: str = Field(..., pattern=r"^\d{2}:\d{2}$", description="開始時刻 (HH:MM)")
    end: str = Field(..., pattern=r"^\d{2}:\d{2}$", description="終了時刻 (HH:MM)")
    hours: float = Field(..., ge=0.5, le=24.0, description="勤務時間数")
    break_minutes: int = Field(default=0, ge=0, le=180, description="法定休憩時間(分)")
    is_late_night: bool = Field(default=False, description="22:00以降にかかるシフトか否か")


class StaffMemberSchema(BaseModel):
    id: str = Field(..., min_length=1, max_length=50, pattern=r"^[a-zA-Z0-9_\-]+$")
    name: str = Field(..., min_length=1, max_length=50)
    is_minor: bool = Field(default=False, description="満18歳未満フラグ")
    roles: list[str] = Field(..., min_length=1, max_length=10, description="保有ロール")
    hourly_wage: int = Field(..., ge=800, le=10000, description="時給(円)")
    max_weekly_hours: float = Field(default=40.0, ge=0.0, le=168.0, description="週間最大労働時間")
    target_weekly_hours: float = Field(
        default=30.0, ge=0.0, le=168.0, description="週間目標労働時間"
    )
    max_consecutive_days: int = Field(default=5, ge=1, le=7, description="最大連続勤務日数")
    ng_staff_ids: list[str] = Field(default_factory=list, description="同時勤務NGスタッフIDリスト")
    preferred_partner_ids: list[str] = Field(
        default_factory=list, description="優先ペアスタッフIDリスト"
    )
    min_days_per_period: int = Field(default=0, ge=0, description="期間内最小出勤日数")
    max_days_per_period: int = Field(default=31, ge=0, le=31, description="期間内最大出勤日数")


class ShiftRequirementSchema(BaseModel):
    day_offset: int = Field(..., ge=0, le=30, description="開始日からの日数オフセット")
    shift_id: str = Field(..., min_length=1, max_length=50)
    min_staff: int = Field(..., ge=0, le=50, description="必要人数")
    required_roles: dict[str, int] = Field(default_factory=dict, description="特定ロールの必須人数")


class StaffAvailabilitySchema(BaseModel):
    staff_id: str = Field(..., min_length=1, max_length=50)
    day_offset: int = Field(..., ge=0, le=30)
    shift_id: str = Field(..., min_length=1, max_length=50)
    status: Literal["available", "want", "unavailable"] = Field(
        default="available", description="出勤可能/希望/不可"
    )


class FixedAssignmentSchema(BaseModel):
    staff_id: str = Field(..., min_length=1, max_length=50, description="スタッフID")
    day_offset: int = Field(..., ge=0, le=30, description="開始日からの日数オフセット")
    shift_id: str = Field(..., min_length=1, max_length=50, description="シフトID")


class ShiftOptimizeRequest(BaseModel):
    period: PeriodSchema
    shifts: list[ShiftSchema] = Field(..., min_length=1, max_length=20)
    staff_members: list[StaffMemberSchema] = Field(..., min_length=1, max_length=50)
    requirements: list[ShiftRequirementSchema] = Field(..., max_length=500)
    availabilities: list[StaffAvailabilitySchema] = Field(default_factory=list, max_length=1000)
    min_interval_hours: float = Field(
        default=11.0, ge=0.0, le=24.0, description="勤務間インターバル最小時間(h)"
    )
    fixed_assignments: list[FixedAssignmentSchema] = Field(
        default_factory=list, description="Warm Start用固定割当 (staff_id, day_offset, shift_id)"
    )


# レスポンススキーマ
class AssignedStaffSchema(BaseModel):
    id: str
    name: str
    assigned_role: str
    hourly_wage: int
    is_want_fulfilled: bool = False


class ScheduledShiftSlotSchema(BaseModel):
    date: str
    day_offset: int
    shift_id: str
    assigned_staff: list[AssignedStaffSchema]


class UnfilledRequirementSchema(BaseModel):
    date: str
    day_offset: int
    shift_id: str
    required_count: int
    assigned_count: int
    shortage: int
    reason: str = "人員不足または制約競合"


class ScheduleSummarySchema(BaseModel):
    total_labor_cost: int
    total_work_hours: float
    total_break_hours: float = Field(default=0.0, description="合計休憩時間(h)")
    deep_night_extra_cost: int = Field(default=0, description="深夜割増人件費(円)")
    wants_fulfillment_rate: float
    max_staff_day_difference: int
    unfilled_requirements: list[UnfilledRequirementSchema] = Field(default_factory=list)
    bottleneck_constraints: list[str] = Field(
        default_factory=list, description="Infeasible時等の制約ボトルネック分析"
    )


class ShiftOptimizeResponse(BaseModel):
    status: Literal["OPTIMAL", "FEASIBLE_WITH_SHORTAGE", "INFEASIBLE", "ERROR"]
    solve_time_ms: int
    summary: ScheduleSummarySchema
    schedule: list[ScheduledShiftSlotSchema]
