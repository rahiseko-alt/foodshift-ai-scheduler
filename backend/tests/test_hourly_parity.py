"""本番経路(hourly ソルバー)が UI の設定を取りこぼしていないことの検証。

管理画面からの最適化は 100% hourly_solver に到達するが、
以下は `constraints.py` 側にのみ実装があり本番では黙って捨てられていた:

* `required_roles`      -> 調理できるスタッフが1人もいないシフトが正常解として出ていた
* `fixed_assignments`   -> 店長が手で確定した配置が再最適化で消えていた
* `min/max_days_per_period` -> 契約上の出勤日数の約束が守られなかった
"""

from app.engine.solver import solve_shift_schedule
from app.schemas.scheduler import (
    FixedAssignmentSchema,
    HourlyRequirementSchema,
    PeriodSchema,
    ShiftOptimizeRequest,
    StaffMemberSchema,
)


def staff(sid: str, role: str, **kw) -> StaffMemberSchema:
    base = dict(id=sid, name=f"スタッフ{sid}", roles=[role], hourly_wage=1000)
    base.update(kw)
    return StaffMemberSchema(**base)


def hourly_req(days: int, hours, min_staff: int = 1, roles=None):
    return [
        HourlyRequirementSchema(
            day_offset=d, hour=h, min_staff=min_staff, required_roles=roles or {}
        )
        for d in range(days)
        for h in hours
    ]


def role_of(members, staff_id: str) -> str:
    return next(m.roles[0] for m in members if m.id == staff_id)


def test_required_roles_are_enforced() -> None:
    """必須ロールを指定した時間帯には、そのロール保有者が必ず入る。

    ここで調理担当だけを明確に高く(¥2,500 対 ¥900)しているのは意図的。
    従来は3人とも同額(¥1,000)だったため、ソルバーにとって
    「調理担当を入れる」と「ホールをもう1人入れる」は**完全に等コスト**で、
    調理担当が入るかどうかは目的関数ではなく探索順の偶然で決まっていた。
    実際、ロール不足ペナルティ(20,000)を **0 に落としてもこのテストは緑のまま**
    だった（変異テスト H-ROLE-PENALTY が生存）。
    コスト差をつけることで、ペナルティが効いている時だけ通るようにする。
    """
    members = [
        staff("hall1", "hall", hourly_wage=900),
        staff("hall2", "hall", hourly_wage=900),
        staff("kit1", "kitchen", hourly_wage=2500),
    ]
    res = solve_shift_schedule(
        ShiftOptimizeRequest(
            period=PeriodSchema(start_date="2026-09-01", days=1),
            staff_members=members,
            hourly_requirements=hourly_req(1, range(11, 15), 2, {"kitchen": 1}),
        )
    )

    assert res.status != "INFEASIBLE"
    covered = [s for s in res.hourly_schedule if s.assigned_staff_ids and 11 <= s.hour < 15]
    assert len(covered) == 4, f"割当が4スロット揃っていない（テストが空振り）: {len(covered)}"
    for slot in covered:
        roles = [role_of(members, i) for i in slot.assigned_staff_ids]
        assert "kitchen" in roles, f"{slot.hour}時に調理担当がいない: {roles}"


def test_no_role_requirement_lets_the_cheaper_staff_win() -> None:
    """対照群: ロール要件が無ければ、高い調理担当は選ばれない。

    この対照群が無いと、上のテストが通るのは
    「ロール要件が効いているから」なのか
    「そもそも kit1 が常に選ばれるだけ」なのかを区別できない。
    """
    members = [
        staff("hall1", "hall", hourly_wage=900),
        staff("hall2", "hall", hourly_wage=900),
        staff("kit1", "kitchen", hourly_wage=2500),
    ]
    res = solve_shift_schedule(
        ShiftOptimizeRequest(
            period=PeriodSchema(start_date="2026-09-01", days=1),
            staff_members=members,
            hourly_requirements=hourly_req(1, range(11, 15), 2),
        )
    )

    assert res.status != "INFEASIBLE"
    assigned = {sid for s in res.hourly_schedule for sid in s.assigned_staff_ids}
    assert assigned == {"hall1", "hall2"}, (
        f"ロール要件が無いのに高い kit1 が選ばれている: {assigned}"
    )


def test_missing_role_does_not_break_the_solve() -> None:
    """該当ロール保有者が皆無でも解が壊れず、頭数の需要は満たされる。

    従来ここは `assert res.status != "ERROR"` だけだった。
    `ShiftOptimizeResponse.status` の Literal に "ERROR" は含まれるものの
    **どちらのソルバーもこの値を返す経路を持たない**（`grep -rn '"ERROR"' app/`
    はスキーマ定義1件のみ）ため、このアサーションは恒真で、
    ソルバーが何を返しても緑になっていた。

    なお、ロール不足そのものは hourly ソルバーの `unfilled_requirements` には
    載らない（不足は頭数ベースでしか算出されない）ため、
    ここで検証できるのは「落ちないこと」と「頭数は満たされること」まで。
    ロール要件が実際に効くことは `test_required_roles_are_enforced` が担う。
    """
    members = [staff("hall1", "hall"), staff("hall2", "hall")]
    res = solve_shift_schedule(
        ShiftOptimizeRequest(
            period=PeriodSchema(start_date="2026-09-01", days=1),
            staff_members=members,
            hourly_requirements=hourly_req(1, range(11, 15), 1, {"kitchen": 1}),
        )
    )

    assert res.status == "OPTIMAL"
    # 頭数の需要(1名)は満たされる。ここが空だとテストが空振りする
    covered = [s for s in res.hourly_schedule if 11 <= s.hour < 15]
    assert len(covered) == 4
    for slot in covered:
        assert len(slot.assigned_staff_ids) >= 1, f"{slot.hour}時に誰も配置されていない"
        assert slot.shortage == 0


def test_fixed_assignment_is_preserved() -> None:
    """固定指定したスタッフは必ずその日に出勤する。"""
    members = [staff("hall1", "hall"), staff("kit1", "kitchen", hourly_wage=1400)]
    res = solve_shift_schedule(
        ShiftOptimizeRequest(
            period=PeriodSchema(start_date="2026-09-01", days=1),
            staff_members=members,
            hourly_requirements=hourly_req(1, range(11, 15), 1),
            fixed_assignments=[
                FixedAssignmentSchema(staff_id="kit1", day_offset=0, shift_id="any")
            ],
        )
    )

    assert res.status != "INFEASIBLE"
    assigned = {s.staff_id for s in res.assigned_shifts}
    # kit1 は時給が高く需要も1名なので、固定しなければ選ばれない側
    assert "kit1" in assigned


def test_without_fixed_assignment_cheaper_staff_is_chosen() -> None:
    """固定しなければ安い方が選ばれる（固定制約が常時発火していないことの対照群）。"""
    members = [staff("hall1", "hall"), staff("kit1", "kitchen", hourly_wage=1400)]
    res = solve_shift_schedule(
        ShiftOptimizeRequest(
            period=PeriodSchema(start_date="2026-09-01", days=1),
            staff_members=members,
            hourly_requirements=hourly_req(1, range(11, 15), 1),
        )
    )
    assigned = {s.staff_id for s in res.assigned_shifts}
    assert assigned == {"hall1"}


def test_min_days_per_period_is_honored() -> None:
    """需要が1日しか無くても、最低出勤日数の約束は満たされる。"""
    members = [staff("p1", "hall", min_days_per_period=3, max_consecutive_days=7)]
    res = solve_shift_schedule(
        ShiftOptimizeRequest(
            period=PeriodSchema(start_date="2026-09-01", days=7),
            staff_members=members,
            hourly_requirements=hourly_req(1, range(11, 15), 1),
        )
    )
    worked = {s.day_offset for s in res.assigned_shifts if s.staff_id == "p1"}
    assert len(worked) >= 3


def test_max_days_per_period_is_honored() -> None:
    """最大出勤日数を超えて割り当てられない。

    p1 を明確に安くして「上限が無ければ7日すべて p1 が選ばれる」状態にする。
    従来は両者同額だったため、上限を消しても p1 が2日以下に収まる解が普通に出て、
    `len(worked) <= 2` が偶然成立していた。
    """
    members = [
        staff("p1", "hall", hourly_wage=900, max_days_per_period=2, max_consecutive_days=7),
        staff("p2", "hall", hourly_wage=2500, max_consecutive_days=7),
    ]
    res = solve_shift_schedule(
        ShiftOptimizeRequest(
            period=PeriodSchema(start_date="2026-09-01", days=7),
            staff_members=members,
            hourly_requirements=hourly_req(7, range(11, 15), 1),
        )
    )
    worked = {s.day_offset for s in res.assigned_shifts if s.staff_id == "p1"}
    # 対照群: 安い p1 は上限いっぱいまで使われるはず（0日で通る空振りを防ぐ）
    assert len(worked) == 2, f"最大出勤日数2日のスタッフが {len(worked)} 日出勤している"
    # 残りは高い p2 が埋める
    p2_worked = {s.day_offset for s in res.assigned_shifts if s.staff_id == "p2"}
    assert len(p2_worked) == 5


def test_without_max_days_the_cheaper_staff_takes_every_day() -> None:
    """上限が無ければ安いスタッフが全日入る（出勤日数上限の常時発火を排除）。"""
    members = [
        staff("p1", "hall", hourly_wage=900, max_consecutive_days=7),
        staff("p2", "hall", hourly_wage=2500, max_consecutive_days=7),
    ]
    res = solve_shift_schedule(
        ShiftOptimizeRequest(
            period=PeriodSchema(start_date="2026-09-01", days=7),
            staff_members=members,
            hourly_requirements=hourly_req(7, range(11, 15), 1),
        )
    )
    worked = {s.day_offset for s in res.assigned_shifts if s.staff_id == "p1"}
    assert worked == set(range(7)), f"上限が無いのに安い p1 が全日入っていない: {worked}"


def test_preference_does_not_create_demand() -> None:
    """希望は「需要のない日に出勤する理由」にはならない。

    希望ボーナス(-500)が時間コスト(約10〜12/時)に対し過大だったため、
    需要ゼロの日にも希望というだけで出勤させ人件費を無駄にしていた。
    """
    from app.schemas.scheduler import StaffHourlyAvailabilitySchema

    members = [staff("s1", "hall", hourly_wage=1200, max_consecutive_days=7)]
    res = solve_shift_schedule(
        ShiftOptimizeRequest(
            period=PeriodSchema(start_date="2026-09-01", days=4),
            staff_members=members,
            hourly_requirements=hourly_req(1, range(11, 15), 1),  # day0 のみ需要
            hourly_availabilities=[
                StaffHourlyAvailabilitySchema(staff_id="s1", day_offset=d, is_preferred=True)
                for d in range(4)
            ],
        )
    )
    worked = sorted({s.day_offset for s in res.assigned_shifts})
    assert worked == [0], f"需要のない日に出勤している: {worked}"


def test_optimality_claim_is_not_hardcoded() -> None:
    """is_proven_optimal が実ステータスを反映する（定数でない）。"""
    small = solve_shift_schedule(
        ShiftOptimizeRequest(
            period=PeriodSchema(start_date="2026-09-01", days=1),
            staff_members=[staff("a", "hall")],
            hourly_requirements=hourly_req(1, range(11, 15), 1),
        )
    )
    assert small.summary.is_proven_optimal is True
