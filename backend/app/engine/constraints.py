from ortools.sat.python import cp_model

from app.engine.helpers import add_consecutive_days_constraint
from app.engine.time_utils import is_shift_late_night
from app.schemas.scheduler import (
    ShiftOptimizeRequest,
)


def build_optimization_model(
    request: ShiftOptimizeRequest,
) -> tuple[
    cp_model.CpModel,
    dict[tuple[int, int, int], cp_model.IntVar],
    dict[tuple[int, int], cp_model.IntVar],
    list[cp_model.LinearExpr],
    list[int],
    dict[tuple[int, int], cp_model.IntVar],  # under_cover (shortage)
]:
    """OR-Tools CP-SAT モデルを構築し、全制約と目的関数要素を生成する。"""
    model = cp_model.CpModel()
    num_staff = len(request.staff_members)
    num_shifts = len(request.shifts)
    num_days = request.period.days

    # 1. 決定変数
    # work[e, s, d]: スタッフ e が 日 d に シフト s に入るか (Bool)
    work: dict[tuple[int, int, int], cp_model.IntVar] = {}
    for e in range(num_staff):
        for s in range(num_shifts):
            for d in range(num_days):
                work[e, s, d] = model.NewBoolVar(f"work_e{e}_s{s}_d{d}")

    # day_worked[e, d]: スタッフ e が 日 d に出勤するか (Bool)
    day_worked: dict[tuple[int, int], cp_model.IntVar] = {}
    for e in range(num_staff):
        for d in range(num_days):
            day_worked[e, d] = model.NewBoolVar(f"day_worked_e{e}_d{d}")
            # 1日最大1シフト制約 (Hard: 同日に2シフト以上勤務禁止)
            model.Add(sum(work[e, s, d] for s in range(num_shifts)) == day_worked[e, d])

    obj_vars: list[cp_model.LinearExpr] = []
    obj_coeffs: list[int] = []
    under_cover_vars: dict[tuple[int, int], cp_model.IntVar] = {}

    # 2. Hard制約: 年少者保護 (労基法第60条 22:00以降深夜業禁止)
    for s_idx, shift in enumerate(request.shifts):
        is_late = shift.is_late_night or is_shift_late_night(shift.start, shift.end)
        if is_late:
            for e_idx, staff in enumerate(request.staff_members):
                if staff.is_minor:
                    for d in range(num_days):
                        # 年少者の深夜シフト割当変数を 0 に固定 (例外なく禁止)
                        model.Add(work[e_idx, s_idx, d] == 0)

    # 3. Hard制約: スタッフ別の連続勤務上限
    for e_idx, staff in enumerate(request.staff_members):
        works_per_day = [day_worked[e_idx, d] for d in range(num_days)]
        add_consecutive_days_constraint(model, works_per_day, staff.max_consecutive_days)

    # 4. Hard制約: 週間最大労働時間 (各週7日ブロックでの労働時間合計)
    shift_hours = [int(round(s.hours * 10)) for s in request.shifts]
    for e_idx, staff in enumerate(request.staff_members):
        max_scaled = int(round(staff.max_weekly_hours * 10))
        # 7日ごとのブロック制約
        for start_d in range(0, max(1, num_days - 6), 7):
            window_days = range(start_d, min(num_days, start_d + 7))
            hours_expr = sum(
                shift_hours[s] * work[e_idx, s, d] for s in range(num_shifts) for d in window_days
            )
            model.Add(hours_expr <= max_scaled)

    # 5. 必要人数制約 (スラック変数による緩和付き)
    # requirements を (day_offset, shift_id) でマップ化
    shift_id_to_idx = {s.id: idx for idx, s in enumerate(request.shifts)}
    staff_id_to_idx = {st.id: idx for idx, st in enumerate(request.staff_members)}

    req_map: dict[tuple[int, int], int] = {}
    role_req_map: dict[tuple[int, int], dict[str, int]] = {}
    for req in request.requirements:
        if req.shift_id in shift_id_to_idx and req.day_offset < num_days:
            s_idx = shift_id_to_idx[req.shift_id]
            req_map[req.day_offset, s_idx] = req.min_staff
            if req.required_roles:
                role_req_map[req.day_offset, s_idx] = req.required_roles

    for d in range(num_days):
        for s in range(num_shifts):
            required_count = req_map.get((d, s), 0)
            if required_count > 0:
                # 該当スロットの出勤スタッフ合計
                assigned_sum = sum(work[e, s, d] for e in range(num_staff))
                under_var = model.NewIntVar(0, required_count, f"under_d{d}_s{s}")
                over_var = model.NewIntVar(0, num_staff, f"over_d{d}_s{s}")

                # assigned + under - over == required
                model.Add(assigned_sum + under_var - over_var == required_count)
                under_cover_vars[d, s] = under_var

                # 人員不足には高額ペナルティ (10,000 / 人)
                obj_vars.append(under_var)
                obj_coeffs.append(10000)
                # 過剰配属には軽微なペナルティ (10 / 人)
                obj_vars.append(over_var)
                obj_coeffs.append(10)

    # 6. Hard制約: 必須ロール要件 (例: kitchen_leader >= 1)
    for (d, s), required_roles in role_req_map.items():
        for role_name, min_role_count in required_roles.items():
            capable_staff = [
                e for e, st in enumerate(request.staff_members) if role_name in st.roles
            ]
            if capable_staff:
                role_assigned = sum(work[e, s, d] for e in capable_staff)
                # ロール不足用のスラック変数
                role_under = model.NewIntVar(0, min_role_count, f"role_under_d{d}_s{s}_{role_name}")
                model.Add(role_assigned + role_under >= min_role_count)
                obj_vars.append(role_under)
                obj_coeffs.append(8000)  # ロール不足ペナルティ

    # 7. スタッフ希望 (unavailable: Hard制約, want: Soft制約)
    for avail in request.availabilities:
        if (
            avail.staff_id in staff_id_to_idx
            and avail.shift_id in shift_id_to_idx
            and avail.day_offset < num_days
        ):
            e_idx = staff_id_to_idx[avail.staff_id]
            s_idx = shift_id_to_idx[avail.shift_id]
            d = avail.day_offset

            if avail.status == "unavailable":
                # 不可希望は Hard 制約 (出勤割当を 0 に固定)
                model.Add(work[e_idx, s_idx, d] == 0)
            elif avail.status == "want":
                # 希望が叶わなかったらペナルティ (Not() が 1 のとき +50)
                obj_vars.append(work[e_idx, s_idx, d].Not())
                obj_coeffs.append(50)

    # 8. Soft制約: 人件費最小化 (時給 × 勤務時間)
    for e in range(num_staff):
        wage = request.staff_members[e].hourly_wage
        for s in range(num_shifts):
            hours = request.shifts[s].hours
            cost = int(wage * hours)
            for d in range(num_days):
                obj_vars.append(work[e, s, d])
                obj_coeffs.append(cost // 100)  # コスト重みスケール

    # 9. 目的関数の集約
    if obj_vars:
        model.Minimize(
            cp_model.LinearExpr.Sum([v * c for v, c in zip(obj_vars, obj_coeffs, strict=False)])
        )

    return model, work, day_worked, obj_vars, obj_coeffs, under_cover_vars
