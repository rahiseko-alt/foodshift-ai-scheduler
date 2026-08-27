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
    reqs = [HourlyRequirementSchema(day_offset=0, hour=h, min_staff=2) for h in range(10, 14)]
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
    """TV-H3: 年少者は22:00〜05:00のスロットに一切割り当てられない。

    年少者 s3 を**唯一のスタッフ**にすることで「そもそも s3 に割当が無いから
    ループが1度も回らず緑」という空振りを構造的に排除する。
    s3 は 18:00〜22:00 は適法に働けるため、割当があること自体が対照群になる。
    """
    # 18:00〜24:00 (6時間) に各時間1名必要
    reqs = [HourlyRequirementSchema(day_offset=0, hour=h, min_staff=1) for h in range(18, 24)]
    minor = next(s for s in base_staff if s.id == "s3")
    req = ShiftOptimizeRequest(
        period=PeriodSchema(start_date="2026-09-01", days=1),
        staff_members=[minor],
        hourly_requirements=reqs,
        min_shift_hours=3,
    )

    res = solve_hourly_shift_schedule(req)
    assert res.status == "FEASIBLE_WITH_SHORTAGE"

    # 1時間スロットの実体から、年少者が実際に入った時刻を取る。
    # assigned_shifts は開始・終了しか持たないため深夜帯の観測に使わない。
    minor_hours = sorted(
        slot.hour for slot in res.hourly_schedule if "s3" in slot.assigned_staff_ids
    )
    # 対照群: 適法な時間帯には実際に配置されること（割当0での空振り防止）。
    # 18〜21時は需要があり年少者でも適法なので必ず埋まる。
    assert set(minor_hours) >= {18, 19, 20, 21}, f"年少者の配置が想定と異なる: {minor_hours}"
    # 不変条件: 深夜帯(22:00〜05:00)は例外なく0
    assert not any(h >= 22 or h < 5 for h in minor_hours), (
        f"年少者が深夜帯に配置されている: {minor_hours}"
    )

    # 22時・23時は年少者では埋められないので不足として可視化される
    night_shortage = {
        slot.hour: slot.shortage for slot in res.hourly_schedule if slot.hour in (22, 23)
    }
    assert night_shortage == {22: 1, 23: 1}, f"深夜帯の不足が出ていない: {night_shortage}"

    minor_shifts = [s for s in res.assigned_shifts if s.staff_id == "s3"]
    assert len(minor_shifts) == 1
    assert minor_shifts[0].end_time == "22:00"
    assert minor_shifts[0].is_late_night is False


def test_hourly_adult_may_cover_the_night_slots(base_staff):
    """成人は同じ深夜帯を埋められる（年少者テストが「常に0」で通るのを防ぐ対照群）。"""
    reqs = [HourlyRequirementSchema(day_offset=0, hour=h, min_staff=1) for h in range(18, 24)]
    adult = next(s for s in base_staff if s.id == "s2")
    req = ShiftOptimizeRequest(
        period=PeriodSchema(start_date="2026-09-01", days=1),
        staff_members=[adult],
        hourly_requirements=reqs,
        min_shift_hours=3,
    )

    res = solve_hourly_shift_schedule(req)
    assert res.status == "OPTIMAL"

    adult_hours = sorted(
        slot.hour for slot in res.hourly_schedule if "s2" in slot.assigned_staff_ids
    )
    assert adult_hours == [18, 19, 20, 21, 22, 23], f"成人が深夜帯を埋められていない: {adult_hours}"
    assert res.summary.unfilled_requirements == []


def test_hourly_foreign_student_28h_limit(base_staff):
    """TV-H4: 留学生は週間28時間を絶対に超過しない。

    留学生 s4 を**唯一のスタッフ**にする。他にスタッフがいると
    需要は別の人で埋まり、s4 の割当が 0 でも上界だけは満たされてしまう
    （＝28時間規制を1ミリも検証しないまま緑になる）。
    """
    # 7日間にわたり毎日 10:00〜16:00 (6時間) 必要 = 需要42時間
    reqs = [
        HourlyRequirementSchema(day_offset=d, hour=h, min_staff=1)
        for d in range(7)
        for h in range(10, 16)
    ]
    student = next(s for s in base_staff if s.id == "s4")
    req = ShiftOptimizeRequest(
        period=PeriodSchema(start_date="2026-09-01", days=7),
        staff_members=[student],
        hourly_requirements=reqs,
        min_shift_hours=3,
    )

    res = solve_hourly_shift_schedule(req)
    assert res.status in ("OPTIMAL", "FEASIBLE_WITH_SHORTAGE")

    # 拘束時間（gross）で集計する。`assigned_shifts.hours` は休憩控除後(net)
    # であり、上限が掛かっている量とは単位が違う。
    gross = sum(1 for slot in res.hourly_schedule if "s4" in slot.assigned_staff_ids)
    # 対照群: 上界だけでは「1件も割り当てない実装」でも通ってしまう。
    # 需要は 7日×6時間=42時間あるので、上限の28時間近くまでは使われるはず。
    assert gross >= 24, f"留学生に {gross} 時間しか割り当てられていない（上界テストの空振り）"
    assert gross <= 28, f"留学生が週 {gross} 時間勤務している（28h規制違反）"


def test_hourly_staff_availability_preference():
    """TV-H5: スタッフの出勤可能時間帯外には割り当てられない。

    従来この検証は `if s1_shifts:` の中にあり、solver が s1 を選ばなければ
    **何も検証せずに緑**になっていた（実際、他に安いスタッフがいるため
    s1 が選ばれない解が普通に出る）。
    s1 を唯一のスタッフにしてガードを外し、割当があること自体を主張する。
    """
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
    reqs = [HourlyRequirementSchema(day_offset=0, hour=h, min_staff=1) for h in range(10, 20)]
    only_s1 = StaffMemberSchema(
        id="s1",
        name="佐藤(一般)",
        roles=["kitchen"],
        hourly_wage=1200,
        max_consecutive_days=5,
        max_weekly_hours=40.0,
    )
    req = ShiftOptimizeRequest(
        period=PeriodSchema(start_date="2026-09-01", days=1),
        staff_members=[only_s1],
        hourly_requirements=reqs,
        hourly_availabilities=avail,
        min_shift_hours=3,
    )

    res = solve_hourly_shift_schedule(req)
    assert res.status == "FEASIBLE_WITH_SHORTAGE"

    s1_hours = sorted(slot.hour for slot in res.hourly_schedule if "s1" in slot.assigned_staff_ids)
    # ガードなしで主張する: 希望枠 14:00〜18:00 をちょうど埋める
    assert s1_hours == [14, 15, 16, 17], f"希望時間帯外に割り当てられた: {s1_hours}"
    # 対照群: 枠外の 10-13時・18-19時は誰も入れないので不足になる
    shortage_hours = sorted(slot.hour for slot in res.hourly_schedule if slot.shortage > 0)
    assert shortage_hours == [10, 11, 12, 13, 18, 19], (
        f"枠外の需要が不足として現れていない: {shortage_hours}"
    )
