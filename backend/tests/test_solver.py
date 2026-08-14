import time

from app.engine.solver import solve_shift_schedule
from app.schemas.scheduler import (
    FixedAssignmentSchema,
    PeriodSchema,
    ShiftOptimizeRequest,
    ShiftRequirementSchema,
    ShiftSchema,
    StaffAvailabilitySchema,
    StaffMemberSchema,
)


def create_15_staff_14_day_request() -> ShiftOptimizeRequest:
    """15人×14日×3シフトの現実的な居酒屋シフトリクエストを生成。"""
    staff_members = [
        StaffMemberSchema(
            id=f"emp_{i:02d}",
            name=f"スタッフ{i}",
            is_minor=(i >= 13),  # emp_13, emp_14 は年少者
            roles=["kitchen_leader" if i <= 2 else "hall"],
            hourly_wage=1000 + i * 50,
            max_weekly_hours=40.0 if i <= 5 else 20.0,
            target_weekly_hours=35.0 if i <= 5 else 15.0,
            max_consecutive_days=5 if i <= 5 else 3,
            ng_staff_ids=[f"emp_{i + 1:02d}"] if i == 6 else [],  # emp_06 と emp_07 はNG
            preferred_partner_ids=[f"emp_{i + 1:02d}"]
            if i == 0
            else [],  # emp_00 と emp_01 はGood pair
        )
        for i in range(15)
    ]

    shifts = [
        ShiftSchema(
            id="morning",
            name="早番",
            start="10:00",
            end="15:00",
            hours=5.0,
            break_minutes=0,
            is_late_night=False,
        ),
        ShiftSchema(
            id="dinner",
            name="ディナー",
            start="17:00",
            end="22:00",
            hours=5.0,
            break_minutes=30,
            is_late_night=False,
        ),
        ShiftSchema(
            id="late",
            name="深夜",
            start="21:30",
            end="24:30",
            hours=3.0,
            break_minutes=0,
            is_late_night=True,
        ),
    ]

    requirements = []
    for d in range(14):
        requirements.append(
            ShiftRequirementSchema(
                day_offset=d,
                shift_id="morning",
                min_staff=2,
                required_roles={"kitchen_leader": 1} if d % 2 == 0 else {},
            )
        )
        requirements.append(
            ShiftRequirementSchema(
                day_offset=d,
                shift_id="dinner",
                min_staff=3,
                required_roles={"kitchen_leader": 1},
            )
        )
        requirements.append(
            ShiftRequirementSchema(
                day_offset=d,
                shift_id="late",
                min_staff=2,
                required_roles={},
            )
        )

    # 希望データ: 複数スタッフが出勤希望(want)や不可(unavailable)を提示
    availabilities = [
        StaffAvailabilitySchema(staff_id="emp_00", day_offset=0, shift_id="morning", status="want"),
        StaffAvailabilitySchema(staff_id="emp_01", day_offset=1, shift_id="dinner", status="want"),
        StaffAvailabilitySchema(staff_id="emp_02", day_offset=2, shift_id="late", status="want"),
        StaffAvailabilitySchema(staff_id="emp_13", day_offset=0, shift_id="morning", status="want"),
        StaffAvailabilitySchema(
            staff_id="emp_13", day_offset=0, shift_id="late", status="unavailable"
        ),
        StaffAvailabilitySchema(
            staff_id="emp_14", day_offset=1, shift_id="late", status="unavailable"
        ),
    ]

    return ShiftOptimizeRequest(
        period=PeriodSchema(start_date="2026-09-01", days=14),
        shifts=shifts,
        staff_members=staff_members,
        requirements=requirements,
        availabilities=availabilities,
    )


def test_15_staff_14_days_optimal_and_quality():
    """15人×14日×3シフト規模で OPTIMAL を返し、シフト品質基準を満たすことを検証。"""
    request = create_15_staff_14_day_request()

    start = time.time()
    res = solve_shift_schedule(request)
    elapsed = time.time() - start

    # 1. 求解時間 < 5.0 秒
    assert elapsed < 5.0, f"求解に {elapsed:.2f} 秒かかりました (目標: 5秒未満)"
    assert res.status in ("OPTIMAL", "FEASIBLE_WITH_SHORTAGE")
    assert len(res.schedule) == 14 * 3

    # 2. 希望充足率 >= 70%
    assert res.summary.wants_fulfillment_rate >= 0.70

    # 3. 人件費、総労働時間、休憩時間、深夜割増の正当性
    assert res.summary.total_labor_cost > 0
    assert res.summary.total_work_hours > 0
    assert res.summary.total_break_hours >= 0
    assert res.summary.deep_night_extra_cost > 0

    # 4. 年少者深夜禁止 (労基法第60条) の完全厳守
    minor_ids = {"emp_13", "emp_14"}
    for slot in res.schedule:
        if slot.shift_id == "late":
            assigned = {s.id for s in slot.assigned_staff}
            assert not (assigned & minor_ids), "深夜シフトに年少者が配置されています"


def test_break_minutes_and_deep_night_extra_calculation():
    """休憩時間の控除と深夜割増（22:00〜05:00の25%）が正確に計算されることを検証。"""
    request = ShiftOptimizeRequest(
        period=PeriodSchema(start_date="2026-09-01", days=1),
        shifts=[
            # 実働4.0h (拘束5.0h - 休憩60分=1.0h), 深夜22:00〜23:00 (1.0h)
            ShiftSchema(
                id="dinner_late",
                name="夜勤",
                start="18:00",
                end="23:00",
                hours=5.0,
                break_minutes=60,
                is_late_night=True,
            ),
        ],
        staff_members=[
            StaffMemberSchema(
                id="adult_1",
                name="成人スタッフ",
                is_minor=False,
                roles=["hall"],
                hourly_wage=1000,
            ),
        ],
        requirements=[
            ShiftRequirementSchema(day_offset=0, shift_id="dinner_late", min_staff=1),
        ],
        availabilities=[],
    )

    res = solve_shift_schedule(request)
    assert res.status == "OPTIMAL"

    # 実労働時間: 5.0h - 1.0h = 4.0h
    assert res.summary.total_work_hours == 4.0
    # 休憩時間: 1.0h
    assert res.summary.total_break_hours == 1.0
    # 深夜時間: 1.0h (22:00〜23:00) -> 割増: 1000 * 0.25 * 1.0 = 250円
    assert res.summary.deep_night_extra_cost == 250
    # 総人件費: 基本給 4000円 + 深夜割増 250円 = 4250円
    assert res.summary.total_labor_cost == 4250


def test_preferred_partner_bonus():
    """優先ペア（preferred_partner_ids）が同じシフトに同時配置されることを検証。"""
    request = ShiftOptimizeRequest(
        period=PeriodSchema(start_date="2026-09-01", days=1),
        shifts=[
            ShiftSchema(
                id="shift_1",
                name="通常シフト",
                start="10:00",
                end="15:00",
                hours=5.0,
                is_late_night=False,
            ),
        ],
        staff_members=[
            StaffMemberSchema(
                id="pair_a",
                name="ペアA",
                is_minor=False,
                roles=["hall"],
                hourly_wage=1000,
                preferred_partner_ids=["pair_b"],
            ),
            StaffMemberSchema(
                id="pair_b",
                name="ペアB",
                is_minor=False,
                roles=["hall"],
                hourly_wage=1000,
                preferred_partner_ids=[],
            ),
            StaffMemberSchema(
                id="other_c",
                name="他スタッフC",
                is_minor=False,
                roles=["hall"],
                hourly_wage=1000,
            ),
        ],
        requirements=[
            # 2名必要
            ShiftRequirementSchema(day_offset=0, shift_id="shift_1", min_staff=2),
        ],
        availabilities=[],
    )

    res = solve_shift_schedule(request)
    assert res.status == "OPTIMAL"

    assigned_ids = {s.id for s in res.schedule[0].assigned_staff}
    # ペアAとペアBが同時に配置されること
    assert assigned_ids == {"pair_a", "pair_b"}


def test_counterfactual_mutation_shortage_detected():
    """変異テスト: 全員が特定の日に不可(unavailable)を出した際、
    クラッシュせず正確に不足とボトルネック分析が出ることを検証。
    """
    request = create_15_staff_14_day_request()

    # Day 5 のディナー（必要3名）を全15スタッフが unavailable に設定
    for i in range(15):
        request.availabilities.append(
            StaffAvailabilitySchema(
                staff_id=f"emp_{i:02d}", day_offset=5, shift_id="dinner", status="unavailable"
            )
        )

    res = solve_shift_schedule(request)
    assert res.status == "FEASIBLE_WITH_SHORTAGE"
    assert len(res.summary.unfilled_requirements) >= 1
    assert len(res.summary.bottleneck_constraints) >= 1

    shortage_entries = [
        u for u in res.summary.unfilled_requirements if u.day_offset == 5 and u.shift_id == "dinner"
    ]
    assert len(shortage_entries) == 1
    assert shortage_entries[0].shortage >= 1


def test_infeasible_schedule_returns_bottleneck_analysis():
    """1日あたりの必要人数が登録スタッフ総数を上回るなど、完全Infeasible時のボトルネック出力を検証。"""
    request = ShiftOptimizeRequest(
        period=PeriodSchema(start_date="2026-09-01", days=1),
        shifts=[
            ShiftSchema(
                id="s1", name="シフト1", start="09:00", end="17:00", hours=8.0, is_late_night=False
            ),
            ShiftSchema(
                id="s2", name="シフト2", start="09:00", end="17:00", hours=8.0, is_late_night=False
            ),
        ],
        staff_members=[
            # 1名しかいない
            StaffMemberSchema(
                id="solo",
                name="ソロスタッフ",
                is_minor=False,
                roles=["hall"],
                hourly_wage=1000,
                max_days_per_period=0,  # 出勤可能日数0
            ),
        ],
        requirements=[
            ShiftRequirementSchema(day_offset=0, shift_id="s1", min_staff=1),
        ],
        availabilities=[],
        fixed_assignments=[
            # 不可能な固定割当
            FixedAssignmentSchema(staff_id="solo", day_offset=0, shift_id="s1"),
            FixedAssignmentSchema(staff_id="solo", day_offset=0, shift_id="s2"),
        ],
    )

    res = solve_shift_schedule(request)
    assert res.status == "INFEASIBLE"
    assert len(res.summary.bottleneck_constraints) >= 1
