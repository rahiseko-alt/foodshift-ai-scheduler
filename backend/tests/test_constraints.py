from app.engine.solver import solve_shift_schedule
from app.engine.time_utils import (
    calculate_interval_hours,
    calculate_late_night_hours,
    is_shift_late_night,
)
from app.schemas.scheduler import (
    FixedAssignmentSchema,
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


def test_time_utils_calculate_late_night_hours():
    assert calculate_late_night_hours("09:00", "15:00") == 0.0
    assert calculate_late_night_hours("17:00", "23:00") == 1.0  # 22:00〜23:00
    assert calculate_late_night_hours("21:30", "24:30") == 2.5  # 22:00〜24:30
    assert calculate_late_night_hours("04:00", "09:00") == 1.0  # 04:00〜05:00


def test_time_utils_calculate_interval_hours():
    # 前日23:00終了 -> 翌日09:00開始 (10時間)
    assert calculate_interval_hours("23:00", "09:00") == 10.0
    # 前日21:00終了 -> 翌日09:00開始 (12時間)
    assert calculate_interval_hours("21:00", "09:00") == 12.0
    # 前日01:00跨ぎ終了 -> 翌日10:00開始 (9時間)
    assert calculate_interval_hours("01:00", "10:00") == 9.0


def test_minor_protection_hard_constraint_zero_late_night_assignment():
    """満18歳未満のスタッフは22:00以降にかかるシフトに例外なく0件配置されることを検証。"""
    request = ShiftOptimizeRequest(
        period=PeriodSchema(start_date="2026-09-01", days=5),
        shifts=[
            ShiftSchema(
                id="day",
                name="日勤",
                start="09:00",
                end="17:00",
                hours=8.0,
                break_minutes=45,
                is_late_night=False,
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
    assert res.status == "OPTIMAL"

    # 全夜勤シフトに minor が 1 回も入っていないことを検証。
    # 対照群として、成人が実際に全夜勤を埋めていることも要求する。
    # これが無いと「誰も配置しない実装」でも緑になってしまう。
    night_slots = [slot for slot in res.schedule if slot.shift_id == "night"]
    assert len(night_slots) == 5, "夜勤枠が5日分ない"
    for slot in night_slots:
        assigned_ids = [s.id for s in slot.assigned_staff]
        assert "minor" not in assigned_ids, "未成年が深夜シフトに配置されています！"
        assert assigned_ids == ["adult"], (
            f"Day {slot.day_offset} の夜勤を成人が埋めていない: {assigned_ids}"
        )
    assert res.summary.unfilled_requirements == []


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
    per_day = []
    for d in range(3):
        day_slots = [slot for slot in res.schedule if slot.day_offset == d]
        assigned_count = sum(1 for slot in day_slots for s in slot.assigned_staff if s.id == "e1")
        per_day.append(assigned_count)
        assert assigned_count <= 1, f"Day {d} に e1 が {assigned_count} シフト入っています"

    # 対照群: 上界だけでは「1件も割り当てない実装」でも通ってしまう。
    # 6枠中3枠(1日1枠)は必ず埋まり、残り3枠は不足として現れる。
    assert per_day == [1, 1, 1], f"1日1シフトずつ埋まっていない: {per_day}"
    assert len(res.summary.unfilled_requirements) == 3


def _worked_days(response, staff_id: str, num_days: int) -> list[int]:
    return [
        d
        for d in range(num_days)
        for slot in response.schedule
        if slot.day_offset == d and any(s.id == staff_id for s in slot.assigned_staff)
    ]


def _longest_streak(days: list[int]) -> int:
    if not days:
        return 0
    best = run = 1
    for prev, cur in zip(sorted(days), sorted(days)[1:], strict=False):
        run = run + 1 if cur == prev + 1 else 1
        best = max(best, run)
    return best


def _consecutive_days_request(max_consecutive: int) -> ShiftOptimizeRequest:
    """連続勤務上限だけが効く条件を作る。

    スタッフを1名にして「他の人が埋めたから連続しなかった」という
    偶然を排除し、週労働時間の上限も外して**連続勤務上限だけ**が
    出勤日数を決めるようにする。
    """
    return ShiftOptimizeRequest(
        period=PeriodSchema(start_date="2026-09-01", days=7),
        shifts=[
            ShiftSchema(
                id="day",
                name="日勤",
                start="09:00",
                end="14:00",
                hours=5.0,
                break_minutes=0,
                is_late_night=False,
            ),
        ],
        staff_members=[
            StaffMemberSchema(
                id="solo",
                name="単独スタッフ",
                is_minor=False,
                roles=["hall"],
                hourly_wage=1000,
                max_consecutive_days=max_consecutive,
                max_weekly_hours=168.0,  # 週上限は効かせない
            ),
        ],
        requirements=[
            ShiftRequirementSchema(day_offset=d, shift_id="day", min_staff=1) for d in range(7)
        ],
        availabilities=[],
    )


def test_consecutive_days_limit_is_enforced():
    """連続勤務日数の上限を超えて配置されないことを検証。

    従来は2名で7日を分担していたため、制約を外しても連続勤務が発生せず
    `max_streak <= 3` が偶然成立していた（＝制約を1つも見張れていなかった）。
    """
    res = solve_shift_schedule(_consecutive_days_request(3))
    assert res.status in ("OPTIMAL", "FEASIBLE_WITH_SHORTAGE")

    days = _worked_days(res, "solo", 7)
    # 対照群: 需要は7日すべてにあるので、上限いっぱいまでは働く
    # 上界(streak<=3)だけでは「制約を過剰に厳しくした実装」を検出できない。
    # 窓幅を1広げるだけの変異は streak を増やさず**出勤日数を減らす**方向に効くため、
    # 上限3日で理論上取りうる最大日数 6日 (3連勤→1休→3連勤) を下界として固定する。
    assert len(days) == 6, (
        f"上限3日で取りうる最大の6日が割り当てられていない: {days}"
        "（6日未満なら制約が過剰、空なら上界テストの空振り）"
    )
    assert _longest_streak(days) <= 3, f"3日上限のスタッフが連続勤務しています: {days}"


def test_higher_consecutive_limit_actually_allows_more_days():
    """上限を7日にすれば7連勤できる（連続勤務上限の決め打ち・常時発火を排除）。"""
    res = solve_shift_schedule(_consecutive_days_request(7))
    assert res.status == "OPTIMAL"

    days = _worked_days(res, "solo", 7)
    assert days == list(range(7)), f"上限7日なのに7連勤できていない: {days}"
    assert _longest_streak(days) == 7


def _ng_pair_request(ng: bool) -> ShiftOptimizeRequest:
    """A と B が最安ペアになる条件を作る。

    従来は3名とも時給1000円だったため、NG制約を外しても solver が
    {A, C} を選ぶ解が普通に出て、制約を消してもテストが緑のままだった。
    C を高額にして「NG制約が無ければ必ず {A, B} が選ばれる」状態にすると、
    このテストが初めて NG 制約そのものを見張るようになる。
    """
    return ShiftOptimizeRequest(
        period=PeriodSchema(start_date="2026-09-01", days=3),
        shifts=[
            ShiftSchema(
                id="dinner",
                name="ディナー",
                start="17:00",
                end="22:00",
                hours=5.0,
                is_late_night=False,
            ),
        ],
        staff_members=[
            StaffMemberSchema(
                id="staff_a",
                name="スタッフA",
                is_minor=False,
                roles=["hall"],
                hourly_wage=1000,
                ng_staff_ids=["staff_b"] if ng else [],
            ),
            StaffMemberSchema(
                id="staff_b",
                name="スタッフB",
                is_minor=False,
                roles=["hall"],
                hourly_wage=1000,
                ng_staff_ids=[],
            ),
            StaffMemberSchema(
                id="staff_c",
                name="スタッフC",
                is_minor=False,
                roles=["hall"],
                hourly_wage=2500,  # 明確に高い: NG制約が無ければ選ばれない
                ng_staff_ids=[],
            ),
        ],
        # ディナーに2名必要
        requirements=[
            ShiftRequirementSchema(day_offset=d, shift_id="dinner", min_staff=2) for d in range(3)
        ],
        availabilities=[],
    )


def test_ng_pairs_hard_constraint():
    """NGペア（同時勤務禁止）の2名が同一シフト・同一日に同時に配置されないことを検証。"""
    res = solve_shift_schedule(_ng_pair_request(ng=True))
    assert res.status == "OPTIMAL"

    for slot in res.schedule:
        assigned_ids = {s.id for s in slot.assigned_staff}
        # 対照群: 各日2名が実際に配置されていること（割当0での空振り防止）
        assert len(assigned_ids) == 2, f"Day {slot.day_offset} の配置が2名でない: {assigned_ids}"
        assert not {"staff_a", "staff_b"}.issubset(assigned_ids), (
            f"NGペアが同一シフトに同時配置されました: {assigned_ids}"
        )


def test_without_ng_flag_the_cheapest_pair_is_chosen():
    """NG指定が無ければ最安ペア {A, B} が選ばれる（NG制約の常時発火を排除）。"""
    res = solve_shift_schedule(_ng_pair_request(ng=False))
    assert res.status == "OPTIMAL"

    for slot in res.schedule:
        assigned_ids = {s.id for s in slot.assigned_staff}
        assert assigned_ids == {"staff_a", "staff_b"}, (
            f"NG指定が無いのに最安ペアが選ばれていない: {assigned_ids}"
        )


def test_min_interval_hours_hard_constraint():
    """前日遅番と翌日早番の間隔が min_interval_hours 未満の場合、連続して配置されないことを検証。"""
    request = ShiftOptimizeRequest(
        period=PeriodSchema(start_date="2026-09-01", days=2),
        shifts=[
            # 翌日早番 08:00〜12:00
            ShiftSchema(
                id="early", name="早番", start="08:00", end="12:00", hours=4.0, is_late_night=False
            ),
            # 前日遅番 18:00〜23:00 (前日終了23:00 -> 翌日08:00開始 = 9時間インターバル)
            ShiftSchema(
                id="late", name="遅番", start="18:00", end="23:00", hours=5.0, is_late_night=True
            ),
        ],
        staff_members=[
            StaffMemberSchema(
                id="staff_1",
                name="スタッフ1",
                is_minor=False,
                roles=["hall"],
                hourly_wage=1000,
            ),
            StaffMemberSchema(
                id="staff_2",
                name="スタッフ2",
                is_minor=False,
                roles=["hall"],
                hourly_wage=1000,
            ),
        ],
        requirements=[
            # Day 0: 遅番 1名
            ShiftRequirementSchema(day_offset=0, shift_id="late", min_staff=1),
            # Day 1: 早番 1名
            ShiftRequirementSchema(day_offset=1, shift_id="early", min_staff=1),
        ],
        availabilities=[],
        min_interval_hours=11.0,  # 11時間以上必要（9時間 < 11時間）
    )

    res = solve_shift_schedule(request)
    assert res.status == "OPTIMAL"

    day0_late_staff = [
        s.id
        for slot in res.schedule
        if slot.day_offset == 0 and slot.shift_id == "late"
        for s in slot.assigned_staff
    ]
    day1_early_staff = [
        s.id
        for slot in res.schedule
        if slot.day_offset == 1 and slot.shift_id == "early"
        for s in slot.assigned_staff
    ]

    # Day 0 の遅番スタッフと Day 1 の早番スタッフが別人であること
    assert len(day0_late_staff) == 1
    assert len(day1_early_staff) == 1
    assert day0_late_staff[0] != day1_early_staff[0], (
        "勤務間インターバルが11時間未満なのに同一スタッフが配置されました"
    )


def test_period_days_limits_constraint():
    """期間内最小・最大出勤日数が厳守されることを検証。"""
    request = ShiftOptimizeRequest(
        period=PeriodSchema(start_date="2026-09-01", days=5),
        shifts=[
            ShiftSchema(
                id="day",
                name="日勤",
                start="09:00",
                end="17:00",
                hours=8.0,
                break_minutes=45,
                is_late_night=False,
            ),
        ],
        staff_members=[
            # 出勤日数 2日〜2日に制限
            StaffMemberSchema(
                id="staff_exact_2",
                name="2日限定スタッフ",
                is_minor=False,
                roles=["hall"],
                hourly_wage=1000,
                min_days_per_period=2,
                max_days_per_period=2,
            ),
            StaffMemberSchema(
                id="staff_other",
                name="他スタッフ",
                is_minor=False,
                roles=["hall"],
                hourly_wage=1000,
                min_days_per_period=0,
                max_days_per_period=5,
            ),
        ],
        requirements=[
            ShiftRequirementSchema(day_offset=d, shift_id="day", min_staff=1) for d in range(5)
        ],
        availabilities=[],
    )

    res = solve_shift_schedule(request)
    assert res.status == "OPTIMAL"

    exact_2_days = sum(
        1 for slot in res.schedule if any(s.id == "staff_exact_2" for s in slot.assigned_staff)
    )
    assert exact_2_days == 2, f"出勤日数が2日制限のスタッフが {exact_2_days} 日出勤しています"


def test_fixed_assignments_warm_start():
    """固定割当 (fixed_assignments) が指定された枠に確実に配置されることを検証。"""
    request = ShiftOptimizeRequest(
        period=PeriodSchema(start_date="2026-09-01", days=3),
        shifts=[
            ShiftSchema(
                id="s1",
                name="日勤",
                start="09:00",
                end="17:00",
                hours=8.0,
                break_minutes=45,
                is_late_night=False,
            ),
        ],
        staff_members=[
            StaffMemberSchema(
                id="emp_a", name="スタッフA", is_minor=False, roles=["hall"], hourly_wage=1000
            ),
            StaffMemberSchema(
                id="emp_b", name="スタッフB", is_minor=False, roles=["hall"], hourly_wage=1000
            ),
        ],
        requirements=[
            ShiftRequirementSchema(day_offset=d, shift_id="s1", min_staff=1) for d in range(3)
        ],
        availabilities=[],
        fixed_assignments=[
            FixedAssignmentSchema(staff_id="emp_a", day_offset=1, shift_id="s1"),
            FixedAssignmentSchema(staff_id="emp_b", day_offset=2, shift_id="s1"),
        ],
    )

    res = solve_shift_schedule(request)
    assert res.status == "OPTIMAL"

    day1_slot = next(
        slot for slot in res.schedule if slot.day_offset == 1 and slot.shift_id == "s1"
    )
    day2_slot = next(
        slot for slot in res.schedule if slot.day_offset == 2 and slot.shift_id == "s1"
    )

    assert any(s.id == "emp_a" for s in day1_slot.assigned_staff), (
        "Day 1 に emp_a が固定割当されていません"
    )
    assert any(s.id == "emp_b" for s in day2_slot.assigned_staff), (
        "Day 2 に emp_b が固定割当されていません"
    )


def test_foreign_student_28h_hard_constraint():
    """留学生（is_foreign_student == True）は週間労働時間が28.0h以下に厳格制限されることを検証。"""
    request = ShiftOptimizeRequest(
        period=PeriodSchema(start_date="2026-09-01", days=7),
        shifts=[
            ShiftSchema(
                id="day",
                name="日勤",
                start="09:00",
                end="17:00",
                hours=8.0,
                break_minutes=45,
                is_late_night=False,
            ),
        ],
        staff_members=[
            StaffMemberSchema(
                id="student_1",
                name="留学生1",
                is_foreign_student=True,
                max_weekly_hours=28.0,
                roles=["hall"],
                hourly_wage=1000,
            ),
        ],
        requirements=[
            ShiftRequirementSchema(day_offset=d, shift_id="day", min_staff=1) for d in range(7)
        ],
        availabilities=[],
    )

    res = solve_shift_schedule(request)
    assert res.status == "FEASIBLE_WITH_SHORTAGE"

    assigned_days = sum(
        1 for slot in res.schedule if any(s.id == "student_1" for s in slot.assigned_staff)
    )
    # 実働 7.25h/日 (拘束8h - 休憩45分)。3日=21.75h <= 28h、4日=29.0h > 28h。
    # 上界だけでは「1件も割り当てない実装」でも通るため、下界も併せて要求する。
    assert assigned_days == 3, (
        f"留学生の勤務日数が3日ではなく {assigned_days} 日です"
        "（3日未満なら上界テストの空振り、4日以上なら28h規制違反）"
    )
    assert len(res.summary.unfilled_requirements) == 4


def test_foreign_student_28h_cap_survives_a_schema_bypass():
    """スキーマ検証を通さずに週上限を書き換えても、エンジンが28時間で止める。

    `StaffMemberSchema` が留学生の max_weekly_hours>28 を弾くため、
    通常経路では `effective_max_weekly_hours()` の min() が恒等写像になり、
    エンジン側の28時間キャップを検証しているテストが1件も無かった。
    キャップを消してもテストが全て緑のままだったので、多層防御として明示的に固定する。
    """
    request = ShiftOptimizeRequest(
        period=PeriodSchema(start_date="2026-09-01", days=7),
        shifts=[
            ShiftSchema(
                id="day",
                name="日勤",
                start="09:00",
                end="14:00",
                hours=5.0,
                break_minutes=0,
                is_late_night=False,
            ),
        ],
        staff_members=[
            StaffMemberSchema(
                id="student_1",
                name="留学生1",
                is_foreign_student=True,
                max_weekly_hours=28.0,
                roles=["hall"],
                hourly_wage=1000,
                max_consecutive_days=7,
            ),
        ],
        requirements=[
            ShiftRequirementSchema(day_offset=d, shift_id="day", min_staff=1) for d in range(7)
        ],
        availabilities=[],
    )
    # スキーマ検証を経由せず上限を緩める（ネストモデルは再検証されるため組立後に行う）
    request.staff_members[0].max_weekly_hours = 40.0

    res = solve_shift_schedule(request)

    assert res.status != "INFEASIBLE"
    assigned_days = sum(
        1 for slot in res.schedule if any(s.id == "student_1" for s in slot.assigned_staff)
    )
    # 実働5h/日。28h上限なら5日 (25h) まで、キャップが消えると40h上限で7日 (35h) 入れる。
    assert assigned_days > 0, "1件も割当がない（上界テストが空振りしている）"
    assert assigned_days == 5, (
        f"留学生が {assigned_days} 日 ({assigned_days * 5}h) 勤務しています。"
        "エンジン側の28時間キャップが効いていません"
    )


def test_maternity_protection_zero_late_night_assignment():
    """母性保護対象（is_maternity_protection == True）は深夜枠に割当0件を検証。"""
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
                id="mat_staff",
                name="妊産婦スタッフ",
                is_minor=False,
                is_maternity_protection=True,
                roles=["hall"],
                hourly_wage=1200,
            ),
        ],
        requirements=[
            ShiftRequirementSchema(day_offset=d, shift_id="night", min_staff=1) for d in range(3)
        ],
        availabilities=[],
    )

    res = solve_shift_schedule(request)
    assert res.status == "FEASIBLE_WITH_SHORTAGE"

    # 全夜勤枠で母性保護スタッフが0件割当
    for slot in res.schedule:
        assigned_ids = [s.id for s in slot.assigned_staff]
        assert "mat_staff" not in assigned_ids, "母性保護対象スタッフが深夜シフトに配置されています"


def test_minor_max_8h_daily_limit_hard_constraint():
    """年少者（is_minor == True）は1日8時間超のシフトに割当0件を検証。"""
    request = ShiftOptimizeRequest(
        period=PeriodSchema(start_date="2026-09-01", days=2),
        shifts=[
            ShiftSchema(
                id="long_shift",
                name="9.5時間ロング",
                start="09:00",
                end="18:30",
                hours=9.5,
                break_minutes=60,
                is_late_night=False,
            ),
        ],
        staff_members=[
            StaffMemberSchema(
                id="minor_emp",
                name="高校生",
                is_minor=True,
                roles=["hall"],
                hourly_wage=1000,
            ),
        ],
        requirements=[
            ShiftRequirementSchema(day_offset=d, shift_id="long_shift", min_staff=1)
            for d in range(2)
        ],
        availabilities=[],
    )

    res = solve_shift_schedule(request)
    assert res.status == "FEASIBLE_WITH_SHORTAGE"

    for slot in res.schedule:
        assigned_ids = [s.id for s in slot.assigned_staff]
        assert "minor_emp" not in assigned_ids, (
            "年少者に8時間を超える長時間シフトが配置されています"
        )


def test_birth_date_auto_minor_protection():
    """生年月日から18歳未満と判定されたスタッフは、is_minor=False指定でも深夜シフトに配置されないことを検証。"""
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
                id="young_emp",
                name="17歳スタッフ",
                is_minor=False,  # フラグはFalseだが生年月日が17歳
                birth_date="2009-01-15",
                roles=["hall"],
                hourly_wage=1000,
            ),
        ],
        requirements=[
            ShiftRequirementSchema(day_offset=d, shift_id="night", min_staff=1) for d in range(3)
        ],
        availabilities=[],
    )

    res = solve_shift_schedule(request)
    assert res.status == "FEASIBLE_WITH_SHORTAGE"

    for slot in res.schedule:
        assigned_ids = [s.id for s in slot.assigned_staff]
        assert "young_emp" not in assigned_ids, (
            "生年月日18歳未満のスタッフが深夜シフトに配置されています"
        )


def test_missing_required_role_bottleneck_warning():
    """必須ロールを保有するスタッフが1人も存在しない場合、ボトルネック警告が出力されることを検証。"""
    request = ShiftOptimizeRequest(
        period=PeriodSchema(start_date="2026-09-01", days=2),
        shifts=[
            ShiftSchema(
                id="s1",
                name="早番",
                start="09:00",
                end="17:00",
                hours=8.0,
                break_minutes=45,
                is_late_night=False,
            ),
        ],
        staff_members=[
            StaffMemberSchema(
                id="emp1",
                name="スタッフ1",
                roles=["hall"],
                hourly_wage=1000,
            ),
        ],
        requirements=[
            ShiftRequirementSchema(
                day_offset=0,
                shift_id="s1",
                min_staff=1,
                required_roles={"key_holder": 1},
            ),
        ],
        availabilities=[],
    )

    res = solve_shift_schedule(request)
    assert any("key_holder" in b for b in res.summary.bottleneck_constraints), (
        f"ボトルネックに必須ロール不足警告が含まれていません: {res.summary.bottleneck_constraints}"
    )


def _required_role_request(require_role: bool) -> ShiftOptimizeRequest:
    """調理担当を高額にして「ロール要件が無ければ選ばれない」状態を作る。"""
    return ShiftOptimizeRequest(
        period=PeriodSchema(start_date="2026-09-01", days=2),
        shifts=[
            ShiftSchema(
                id="s1",
                name="早番",
                start="09:00",
                end="14:00",
                hours=5.0,
                break_minutes=0,
                is_late_night=False,
            ),
        ],
        staff_members=[
            StaffMemberSchema(
                id="hall_1",
                name="ホール",
                roles=["hall"],
                hourly_wage=1000,
                max_consecutive_days=7,
            ),
            StaffMemberSchema(
                id="kitchen_1",
                name="調理",
                roles=["kitchen"],
                hourly_wage=2500,
                max_consecutive_days=7,
            ),
        ],
        requirements=[
            ShiftRequirementSchema(
                day_offset=d,
                shift_id="s1",
                min_staff=1,
                required_roles={"kitchen": 1} if require_role else {},
            )
            for d in range(2)
        ],
        availabilities=[],
    )


def test_required_role_holder_is_actually_assigned():
    """必須ロールを指定した枠には、そのロール保有者が実際に配置される。

    従来 `required_roles` の検証は「保有者が1人もいない場合の警告文」しか
    無く、**制約そのもの**（保有者がいるときに必ず入れる）を見張るテストが
    存在しなかった。ロール要件の制約行を消しても全テストが緑のままだった。
    """
    res = solve_shift_schedule(_required_role_request(require_role=True))
    assert res.status == "OPTIMAL"

    for slot in res.schedule:
        ids = {s.id for s in slot.assigned_staff}
        assert ids, f"Day {slot.day_offset} に誰も配置されていない（空振り）"
        assert "kitchen_1" in ids, f"Day {slot.day_offset} に調理担当がいない: {ids}"


def test_without_required_role_the_cheaper_staff_is_chosen():
    """ロール要件が無ければ安いホール担当が選ばれる（ロール制約の常時発火を排除）。"""
    res = solve_shift_schedule(_required_role_request(require_role=False))
    assert res.status == "OPTIMAL"

    for slot in res.schedule:
        ids = {s.id for s in slot.assigned_staff}
        assert ids == {"hall_1"}, f"ロール要件が無いのに高額な調理担当が選ばれた: {ids}"
