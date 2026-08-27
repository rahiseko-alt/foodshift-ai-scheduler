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
            shifts=[
                ShiftSchema(
                    id="s1", name="S1", start="09:00", end="17:00", hours=8.0, break_minutes=45
                )
            ],
            staff_members=[StaffMemberSchema(id="e1", name="A", hourly_wage=1000, roles=["hall"])],
            requirements=[],
            min_interval_hours=25.0,  # le=24.0
        )

    req = ShiftOptimizeRequest(
        period=PeriodSchema(start_date="2026-09-01", days=7),
        shifts=[
            ShiftSchema(id="s1", name="S1", start="09:00", end="17:00", hours=8.0, break_minutes=45)
        ],
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


def test_shift_schema_hours_consistency_and_quarter_hour():
    # 15分刻み (10:15〜14:45 = 4.5h) 有効
    s_quarter = ShiftSchema(
        id="s_lunch",
        name="仕込みランチ",
        start="10:15",
        end="14:45",
        hours=4.5,
        break_minutes=0,
    )
    assert s_quarter.hours == 4.5
    assert s_quarter.is_late_night is False

    # 15分刻み日跨ぎ深夜 (22:15〜02:45 = 4.5h) 自動で is_late_night=True
    s_night = ShiftSchema(
        id="s_night",
        name="深夜",
        start="22:15",
        end="02:45",
        hours=4.5,
        break_minutes=0,
    )
    assert s_night.hours == 4.5
    assert s_night.is_late_night is True

    # 15分刻みでない時刻 (10:17) -> ValidationError (TV-8)
    with pytest.raises(ValidationError):
        ShiftSchema(
            id="s_bad_time",
            name="不正時刻",
            start="10:17",
            end="15:45",
            hours=5.5,
        )

    # 拘束時間不整合 (10:15〜14:45 なのに hours=4.30) -> ValidationError (TV-9)
    with pytest.raises(ValidationError):
        ShiftSchema(
            id="s_bad_hours",
            name="不整合シフト",
            start="10:15",
            end="14:45",
            hours=4.30,
        )


def test_shift_schema_labor_law_break_validation():
    # 拘束6.25h (10:15〜16:30) で休憩0分 -> 労基法第34条違反でエラー (TV-6)
    with pytest.raises(ValidationError):
        ShiftSchema(
            id="s_no_break",
            name="休憩なし6h超",
            start="10:15",
            end="16:30",
            hours=6.25,
            break_minutes=0,
        )

    # 拘束6.25h で休憩45分 -> 有効
    s_valid_break = ShiftSchema(
        id="s_break_45",
        name="45分休憩",
        start="10:15",
        end="16:30",
        hours=6.25,
        break_minutes=45,
    )
    assert s_valid_break.break_minutes == 45

    # 拘束8.5h (10:00〜18:30) で休憩45分 -> 8h超は60分必要なのでエラー
    with pytest.raises(ValidationError):
        ShiftSchema(
            id="s_break_short",
            name="8h超で45分休憩不足",
            start="10:00",
            end="18:30",
            hours=8.5,
            break_minutes=45,
        )

    # 拘束8.5h で休憩60分 -> 有効
    s_valid_8h = ShiftSchema(
        id="s_break_60",
        name="60分休憩",
        start="10:00",
        end="18:30",
        hours=8.5,
        break_minutes=60,
    )
    assert s_valid_8h.break_minutes == 60


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


def test_calendar_invalid_birth_date_rejected():
    """正規表現は通るが暦として存在しない生年月日は 422 相当で拒否される。"""
    for bad in ("2010-13-01", "2010-02-30", "2010-00-15", "2011-04-31"):
        with pytest.raises(ValidationError):
            StaffMemberSchema(
                id="s1", name="テスト", roles=["hall"], hourly_wage=1000, birth_date=bad
            )


def test_leap_day_birth_date_accepted():
    """実在する閏日は受理される（過剰厳格化の防止）。"""
    staff = StaffMemberSchema(
        id="s1", name="テスト", roles=["hall"], hourly_wage=1000, birth_date="2008-02-29"
    )
    assert staff.birth_date == "2008-02-29"


def test_future_birth_date_rejected():
    """未来日の生年月日は拒否される（負の年齢による誤判定を防ぐ）。"""
    with pytest.raises(ValidationError):
        StaffMemberSchema(
            id="s1", name="テスト", roles=["hall"], hourly_wage=1000, birth_date="2999-01-01"
        )


def test_calendar_invalid_start_date_rejected():
    """暦として存在しない開始日は拒否される（従来は解決時に500になっていた）。"""
    for bad in ("2026-13-01", "2026-02-30"):
        with pytest.raises(ValidationError):
            PeriodSchema(start_date=bad, days=7)


def test_valid_start_date_accepted():
    """実在する開始日は受理される（2028年は閏年）。"""
    assert PeriodSchema(start_date="2028-02-29", days=7).start_date == "2028-02-29"


def _pattern_error_fields(exc: pytest.ExceptionInfo[ValidationError]) -> set[str]:
    """書式パターン違反として報告されたフィールド名を取り出す。

    単に `pytest.raises(ValidationError)` で括ると、
    `hours` と時刻の整合を見る `model_validator` が別の理由で例外を投げても
    テストが緑になってしまい、**15分刻みの検証を一度も通らずに通過する**。
    エラーの型とフィールドまで見て、狙った検証が発火したことを確定させる。
    """
    return {str(e["loc"][0]) for e in exc.value.errors() if e["type"] == "string_pattern_mismatch"}


@pytest.mark.parametrize("bad_time", ["09:07", "09:01", "09:59", "09:20", "09:44"])
def test_shift_times_must_be_on_the_quarter_hour(bad_time: str):
    """シフト時刻は15分刻みでなければ拒否される。

    この契約は飾りではなく、下流の複数箇所が依存している:
    * タイムラインのドラッグ伸縮は 15分単位でスナップする
      (`DailyTimelineView.tsx` の `Math.round(rawMinutes / 15) * 15`)
    * `calculate_late_night_hours` は 0.25h 精度で深夜割増を算出する

    刻みを任意の分に緩めても**全テストが緑のまま**だった
    （変異テスト SCH-QUARTER が生存）。誰も刻みを見張っていなかった。
    """
    with pytest.raises(ValidationError) as exc:
        ShiftSchema(id="s1", name="日勤", start=bad_time, end="17:00", hours=8.0, break_minutes=45)
    assert "start" in _pattern_error_fields(exc), f"start={bad_time} が刻み違反として弾かれていない"

    with pytest.raises(ValidationError) as exc:
        ShiftSchema(id="s1", name="日勤", start="09:00", end=bad_time, hours=8.0, break_minutes=45)
    assert "end" in _pattern_error_fields(exc), f"end={bad_time} が刻み違反として弾かれていない"


@pytest.mark.parametrize(
    ("good_time", "hours"),
    [("09:00", 8.0), ("09:15", 7.75), ("09:30", 7.5), ("09:45", 7.25)],
)
def test_quarter_hour_shift_times_are_accepted(good_time: str, hours: float):
    """対照群: 15分刻みちょうどの時刻は受理される。

    これが無いと「全部の時刻を拒否する」壊れ方を上のテストが検出できない。
    """
    shift = ShiftSchema(
        id="s1", name="日勤", start=good_time, end="17:00", hours=hours, break_minutes=45
    )
    assert shift.start == good_time
