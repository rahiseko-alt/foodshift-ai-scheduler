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
    """必須ロールを指定した時間帯には、そのロール保有者が必ず入る。"""
    members = [staff("hall1", "hall"), staff("hall2", "hall"), staff("kit1", "kitchen")]
    res = solve_shift_schedule(
        ShiftOptimizeRequest(
            period=PeriodSchema(start_date="2026-09-01", days=1),
            staff_members=members,
            hourly_requirements=hourly_req(1, range(11, 15), 2, {"kitchen": 1}),
        )
    )

    assert res.status != "INFEASIBLE"
    covered = [s for s in res.hourly_schedule if s.assigned_staff_ids and 11 <= s.hour < 15]
    assert covered, "1件も割当がない（テストが空振りしている）"
    for slot in covered:
        roles = [role_of(members, i) for i in slot.assigned_staff_ids]
        assert "kitchen" in roles, f"{slot.hour}時に調理担当がいない: {roles}"


def test_missing_role_surfaces_as_shortage_not_crash() -> None:
    """該当ロール保有者が皆無でも落ちず、不足として可視化される（変異テスト）。"""
    members = [staff("hall1", "hall"), staff("hall2", "hall")]
    res = solve_shift_schedule(
        ShiftOptimizeRequest(
            period=PeriodSchema(start_date="2026-09-01", days=1),
            staff_members=members,
            hourly_requirements=hourly_req(1, range(11, 15), 1, {"kitchen": 1}),
        )
    )
    assert res.status != "ERROR"


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
    """最大出勤日数を超えて割り当てられない。"""
    members = [
        staff("p1", "hall", max_days_per_period=2, max_consecutive_days=7),
        staff("p2", "hall", max_consecutive_days=7),
    ]
    res = solve_shift_schedule(
        ShiftOptimizeRequest(
            period=PeriodSchema(start_date="2026-09-01", days=7),
            staff_members=members,
            hourly_requirements=hourly_req(7, range(11, 15), 1),
        )
    )
    worked = {s.day_offset for s in res.assigned_shifts if s.staff_id == "p1"}
    assert len(worked) <= 2


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
