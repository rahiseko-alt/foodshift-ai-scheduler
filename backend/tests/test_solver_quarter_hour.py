from app.engine.solver import solve_shift_schedule
from app.schemas.scheduler import (
    PeriodSchema,
    ShiftOptimizeRequest,
    ShiftRequirementSchema,
    ShiftSchema,
    StaffAvailabilitySchema,
    StaffMemberSchema,
)


def test_solver_quarter_hour_optimal_and_cost_calculation():
    # 15分刻みシフト枠定義
    # shift_lunch: 10:15〜14:45 (4.5h, 休憩0分)
    # shift_dinner: 17:45〜22:15 (4.5h, 休憩0分, 深夜0.25h)
    shifts = [
        ShiftSchema(
            id="lunch",
            name="仕込みランチ",
            start="10:15",
            end="14:45",
            hours=4.5,
            break_minutes=0,
        ),
        ShiftSchema(
            id="dinner",
            name="ディナー",
            start="17:45",
            end="22:15",
            hours=4.5,
            break_minutes=0,
        ),
    ]

    # スタッフ2名
    staff = [
        StaffMemberSchema(
            id="emp_01",
            name="佐藤 健",
            hourly_wage=1200,
            roles=["kitchen"],
            max_weekly_hours=40.0,
        ),
        StaffMemberSchema(
            id="emp_02",
            name="田中 太郎",
            hourly_wage=1000,
            roles=["hall"],
            max_weekly_hours=40.0,
        ),
    ]

    # 1日間の必要人数: lunch 1名, dinner 1名
    period = PeriodSchema(start_date="2026-09-01", days=1)
    reqs = [
        ShiftRequirementSchema(day_offset=0, shift_id="lunch", min_staff=1),
        ShiftRequirementSchema(day_offset=0, shift_id="dinner", min_staff=1),
    ]

    # emp_01 は lunch, emp_02 は dinner を希望
    avails = [
        StaffAvailabilitySchema(staff_id="emp_01", day_offset=0, shift_id="lunch", status="want"),
        StaffAvailabilitySchema(staff_id="emp_02", day_offset=0, shift_id="dinner", status="want"),
    ]

    request = ShiftOptimizeRequest(
        period=period,
        shifts=shifts,
        staff_members=staff,
        requirements=reqs,
        availabilities=avails,
    )

    response = solve_shift_schedule(request)

    assert response.status == "OPTIMAL"
    assert len(response.schedule) == 2

    # TV-1: emp_01 lunch (4.5h * 1200 = 5,400円)
    # TV-2: emp_02 dinner (4.5h * 1000 = 4,500円 + 深夜0.25h * 1000 * 0.25 = 63円 -> 4,563円)
    # 合計人件費: 5,400 + 4,563 = 9,963円
    # 深夜割増合計: 63円
    assert response.summary.total_work_hours == 9.0
    assert response.summary.deep_night_extra_cost == 63
    assert response.summary.total_labor_cost == 9963


def test_solver_quarter_hour_minor_night_ban():
    # 22:15終了のディナー枠 (TV-7)
    shifts = [
        ShiftSchema(
            id="dinner",
            name="ディナー",
            start="17:45",
            end="22:15",
            hours=4.5,
            break_minutes=0,
        ),
    ]

    # emp_minor (17歳高校生)
    staff = [
        StaffMemberSchema(
            id="emp_minor",
            name="高校生バイト",
            is_minor=True,
            hourly_wage=1000,
            roles=["hall"],
        ),
    ]

    period = PeriodSchema(start_date="2026-09-01", days=1)
    reqs = [
        ShiftRequirementSchema(day_offset=0, shift_id="dinner", min_staff=1),
    ]
    # 高校生が「入りたい」と希望しても深夜禁止で弾かれる
    avails = [
        StaffAvailabilitySchema(
            staff_id="emp_minor", day_offset=0, shift_id="dinner", status="want"
        ),
    ]

    request = ShiftOptimizeRequest(
        period=period,
        shifts=shifts,
        staff_members=staff,
        requirements=reqs,
        availabilities=avails,
    )

    response = solve_shift_schedule(request)

    # 年少者は22:15終了枠に絶対アサインされず、FEASIBLE_WITH_SHORTAGE になる
    assert response.status == "FEASIBLE_WITH_SHORTAGE"
    assert len(response.summary.unfilled_requirements) == 1
    assert response.schedule[0].assigned_staff == []


def test_solver_quarter_hour_interval_constraint():
    # 前日 dinner: 17:45〜22:15
    # 翌日 morning_early: 09:00〜14:00 (インターバル 10.75h < 11.0h -> 禁止 TV-5)
    # 翌日 morning_ok: 09:15〜14:15 (インターバル 11.0h >= 11.0h -> 許可 TV-4)
    shifts = [
        ShiftSchema(
            id="dinner",
            name="前日ディナー",
            start="17:45",
            end="22:15",
            hours=4.5,
            break_minutes=0,
        ),
        ShiftSchema(
            id="morning_early",
            name="翌朝早出",
            start="09:00",
            end="14:00",
            hours=5.0,
            break_minutes=0,
        ),
    ]

    staff = [
        StaffMemberSchema(
            id="emp_01",
            name="佐藤 健",
            hourly_wage=1200,
            roles=["kitchen"],
            max_consecutive_days=5,
        ),
    ]

    period = PeriodSchema(start_date="2026-09-01", days=2)
    # Day 0 dinner に 1名、Day 1 morning_early に 1名
    reqs = [
        ShiftRequirementSchema(day_offset=0, shift_id="dinner", min_staff=1),
        ShiftRequirementSchema(day_offset=1, shift_id="morning_early", min_staff=1),
    ]

    request = ShiftOptimizeRequest(
        period=period,
        shifts=shifts,
        staff_members=staff,
        requirements=reqs,
        availabilities=[],
        min_interval_hours=11.0,
    )

    response = solve_shift_schedule(request)

    # 1人しかいないため、10.75hインターバル違反により両方には入れず不足が発生する
    assert response.status == "FEASIBLE_WITH_SHORTAGE"
    assert len(response.summary.unfilled_requirements) >= 1
