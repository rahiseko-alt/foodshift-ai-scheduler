from typing import Literal

from pydantic import BaseModel, Field, model_validator


class PeriodSchema(BaseModel):
    start_date: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$", description="開始日 (YYYY-MM-DD)")
    days: int = Field(..., ge=1, le=31, description="計算日数 (最大31日)")


class ShiftSchema(BaseModel):
    id: str = Field(..., min_length=1, max_length=50, pattern=r"^[a-zA-Z0-9_\-]+$")
    name: str = Field(..., min_length=1, max_length=50)
    start: str = Field(
        ...,
        pattern=r"^([0-2]?\d|3[0-5]):(00|15|30|45)$",
        description="開始時刻 (HH:MM / 15分刻み / 00:00〜35:45対応)",
    )
    end: str = Field(
        ...,
        pattern=r"^([0-2]?\d|3[0-5]):(00|15|30|45)$",
        description="終了時刻 (HH:MM / 15分刻み / 00:00〜35:45対応)",
    )
    hours: float = Field(..., ge=0.25, le=24.0, description="拘束時間(時間 / 0.25刻み)")
    break_minutes: int = Field(default=0, ge=0, le=180, description="法定休憩時間(分)")
    is_late_night: bool = Field(default=False, description="22:00以降にかかるシフトか否か")

    @model_validator(mode="after")
    def validate_labor_standards_and_times(self) -> "ShiftSchema":
        start_parts = self.start.split(":")
        end_parts = self.end.split(":")
        start_min = int(start_parts[0]) * 60 + int(start_parts[1])
        end_min = int(end_parts[0]) * 60 + int(end_parts[1])
        if end_min <= start_min:
            end_min += 24 * 60
        gross_min = end_min - start_min
        calculated_hours = round(gross_min / 60.0, 2)

        # 15分刻みおよび拘束時間整合性チェック
        if gross_min % 15 != 0 or abs(calculated_hours - self.hours) > 1e-4:
            raise ValueError(
                f"拘束時間 ({self.hours:.2f}h) が開始・終了時刻 "
                f"({calculated_hours:.2f}h) と一致しないか、15分刻みではありません。"
            )

        # 労基法第34条（法定休憩時間）バリデーション
        if gross_min > 8 * 60 and self.break_minutes < 60:
            raise ValueError(
                f"拘束時間が8時間を超えるシフト ({calculated_hours:.2f}h) は、"
                f"労基法第34条に基づき60分以上の休憩が必要です (現在: {self.break_minutes}分)。"
            )
        elif gross_min > 6 * 60 and self.break_minutes < 45:
            raise ValueError(
                f"拘束時間が6時間を超えるシフト ({calculated_hours:.2f}h) は、"
                f"労基法第34条に基づき45分以上の休憩が必要です (現在: {self.break_minutes}分)。"
            )

        # 深夜フラグの自動同期（22:00以降または早朝5:00前にかかるか）
        from app.engine.time_utils import is_shift_late_night

        self.is_late_night = is_shift_late_night(self.start, self.end)
        return self


class StaffMemberSchema(BaseModel):
    id: str = Field(..., min_length=1, max_length=50, pattern=r"^[a-zA-Z0-9_\-]+$")
    name: str = Field(..., min_length=1, max_length=50)
    is_minor: bool = Field(default=False, description="満18歳未満フラグ")
    is_foreign_student: bool = Field(default=False, description="留学生フラグ（週28時間制限）")
    is_maternity_protection: bool = Field(default=False, description="母性保護フラグ（深夜業制限）")
    birth_date: str | None = Field(
        default=None, pattern=r"^\d{4}-\d{2}-\d{2}$", description="生年月日 (YYYY-MM-DD)"
    )
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

    @model_validator(mode="after")
    def validate_foreign_student_hours(self) -> "StaffMemberSchema":
        if self.is_foreign_student and self.max_weekly_hours > 28.0:
            raise ValueError("留学生の週間最大労働時間は28.0時間以下で設定してください。")
        return self


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


class HourlyRequirementSchema(BaseModel):
    day_offset: int = Field(..., ge=0, le=30, description="開始日からの日数オフセット")
    hour: int = Field(..., ge=0, le=23, description="時間 (0〜23時の1時間スロット)")
    min_staff: int = Field(..., ge=0, le=50, description="必要人数")
    required_roles: dict[str, int] = Field(default_factory=dict, description="特定ロールの必須人数")


class StaffHourlyAvailabilitySchema(BaseModel):
    staff_id: str = Field(..., min_length=1, max_length=50)
    day_offset: int = Field(..., ge=0, le=30)
    available_from: int = Field(default=0, ge=0, le=23, description="勤務可能開始時刻 (0〜23)")
    available_to: int = Field(default=24, ge=0, le=24, description="勤務可能終了時刻 (0〜24)")
    is_available: bool = Field(default=True, description="出勤可能か (Falseなら終日不可)")
    is_preferred: bool = Field(default=False, description="特に希望する日か")


class FixedAssignmentSchema(BaseModel):
    staff_id: str = Field(..., min_length=1, max_length=50, description="スタッフID")
    day_offset: int = Field(..., ge=0, le=30, description="開始日からの日数オフセット")
    shift_id: str = Field(..., min_length=1, max_length=50, description="シフトID")


class ShiftOptimizeRequest(BaseModel):
    period: PeriodSchema
    shifts: list[ShiftSchema] = Field(default_factory=list, max_length=20)
    staff_members: list[StaffMemberSchema] = Field(..., min_length=1, max_length=50)
    requirements: list[ShiftRequirementSchema] = Field(default_factory=list, max_length=500)
    availabilities: list[StaffAvailabilitySchema] = Field(default_factory=list, max_length=1000)
    hourly_requirements: list[HourlyRequirementSchema] = Field(
        default_factory=list, max_length=1000, description="1時間ごとの必要人数山谷"
    )
    hourly_availabilities: list[StaffHourlyAvailabilitySchema] = Field(
        default_factory=list, max_length=1000, description="スタッフの時間帯希望"
    )
    min_shift_hours: int = Field(default=3, ge=1, le=12, description="1回の最低連続勤務時間(h)")
    max_shift_hours: int = Field(default=8, ge=1, le=16, description="1回の最大連続勤務時間(h)")
    min_interval_hours: float = Field(
        default=11.0, ge=0.0, le=24.0, description="勤務間インターバル最小時間(h)"
    )
    fixed_assignments: list[FixedAssignmentSchema] = Field(
        default_factory=list, description="Warm Start用固定割当 (staff_id, day_offset, shift_id)"
    )

    @model_validator(mode="after")
    def validate_shift_or_hourly(self) -> "ShiftOptimizeRequest":
        if not self.shifts and not self.hourly_requirements:
            raise ValueError(
                "シフト枠(shifts)または1時間単位必要人数(hourly_requirements)のいずれかを指定してください。"
            )
        return self


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


class AssignedShiftTimeSchema(BaseModel):
    staff_id: str
    name: str
    day_offset: int
    date: str
    start_time: str = Field(..., description="出勤時刻 (HH:00)")
    end_time: str = Field(..., description="退勤時刻 (HH:00)")
    hours: float = Field(..., description="実労働時間(h)")
    break_minutes: int = Field(default=0, description="休憩時間(分)")
    hourly_wage: int
    labor_cost: int = Field(..., description="人件費(円)")
    is_late_night: bool = Field(default=False, description="深夜業(22時以降)を含むか")


class HourlyScheduleSlotSchema(BaseModel):
    date: str
    day_offset: int
    hour: int
    required_count: int
    assigned_staff_ids: list[str] = Field(default_factory=list)
    shortage: int = 0


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
    schedule: list[ScheduledShiftSlotSchema] = Field(default_factory=list)
    assigned_shifts: list[AssignedShiftTimeSchema] = Field(
        default_factory=list, description="1時間タイムスロットで決定した各個人の出退勤時間一覧"
    )
    hourly_schedule: list[HourlyScheduleSlotSchema] = Field(
        default_factory=list, description="1時間ごとの時間帯別配置状況"
    )
