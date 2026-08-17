from datetime import datetime

from ortools.sat.python import cp_model

from app.engine.helpers import add_consecutive_days_constraint
from app.engine.time_utils import (
    calculate_interval_minutes,
    calculate_late_night_hours,
    is_shift_late_night,
)
from app.schemas.scheduler import (
    ShiftOptimizeRequest,
    StaffMemberSchema,
)


def is_staff_minor(staff: StaffMemberSchema, start_date_str: str) -> bool:
    """スタッフが満18歳未満（年少者）であるかを判定する（is_minorフラグまたは生年月日から算出）。"""
    if staff.is_minor:
        return True
    if staff.birth_date:
        try:
            start_dt = datetime.strptime(start_date_str, "%Y-%m-%d")
            birth_dt = datetime.strptime(staff.birth_date, "%Y-%m-%d")
            age = (
                start_dt.year
                - birth_dt.year
                - ((start_dt.month, start_dt.day) < (birth_dt.month, birth_dt.day))
            )
            if age < 18:
                return True
        except Exception:
            pass
    return False


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

    shift_id_to_idx = {s.id: idx for idx, s in enumerate(request.shifts)}
    staff_id_to_idx = {st.id: idx for idx, st in enumerate(request.staff_members)}

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

    # 2. Hard制約: 年少者保護 (労基法第60条) & 母性保護 (労基法第64条の3 深夜禁止)
    for s_idx, shift in enumerate(request.shifts):
        is_late = shift.is_late_night or is_shift_late_night(shift.start, shift.end)
        if is_late:
            for e_idx, staff in enumerate(request.staff_members):
                if (
                    is_staff_minor(staff, request.period.start_date)
                    or staff.is_maternity_protection
                ):
                    for d in range(num_days):
                        # 年少者および母性保護対象者の深夜シフト割当変数を 0 に固定 (例外なく禁止)
                        model.Add(work[e_idx, s_idx, d] == 0)

    # 2b. Hard制約: 年少者の1日拘束時間上限 (労基法第60条 原則1日8時間以下)
    for s_idx, shift in enumerate(request.shifts):
        if shift.hours > 8.0:
            for e_idx, staff in enumerate(request.staff_members):
                if is_staff_minor(staff, request.period.start_date):
                    for d in range(num_days):
                        # 1日8時間を超えるシフトへの年少者割当変数を 0 に固定
                        model.Add(work[e_idx, s_idx, d] == 0)

    # 3. Hard制約: スタッフ別の連続勤務上限
    for e_idx, staff in enumerate(request.staff_members):
        works_per_day = [day_worked[e_idx, d] for d in range(num_days)]
        add_consecutive_days_constraint(model, works_per_day, staff.max_consecutive_days)

    # 4. Hard制約: 期間内出勤日数上下限 (min_days_per_period / max_days_per_period)
    for e_idx, staff in enumerate(request.staff_members):
        total_days_worked = sum(day_worked[e_idx, d] for d in range(num_days))
        if staff.min_days_per_period > 0:
            effective_min = min(staff.min_days_per_period, num_days)
            model.Add(total_days_worked >= effective_min)
        if staff.max_days_per_period < 31:
            model.Add(total_days_worked <= staff.max_days_per_period)

    # 5. Hard制約: 勤務間インターバル制約 (min_interval_hours)
    # 前日シフト s1 終了〜翌日シフト s2 開始までの時間が min_interval_hours 未満なら同時に配置不可
    min_interval_min = int(round(request.min_interval_hours * 60))
    for s1_idx, s1 in enumerate(request.shifts):
        for s2_idx, s2 in enumerate(request.shifts):
            interval_min = calculate_interval_minutes(s1.end, s2.start)
            if interval_min < min_interval_min:
                for e_idx in range(num_staff):
                    for d in range(num_days - 1):
                        model.Add(work[e_idx, s1_idx, d] + work[e_idx, s2_idx, d + 1] <= 1)

    # 6. Hard制約: NGペア制約 (同時勤務NG)
    for e1_idx in range(num_staff):
        for e2_idx in range(e1_idx + 1, num_staff):
            st1 = request.staff_members[e1_idx]
            st2 = request.staff_members[e2_idx]
            is_ng = (st2.id in st1.ng_staff_ids) or (st1.id in st2.ng_staff_ids)
            if is_ng:
                for s in range(num_shifts):
                    for d in range(num_days):
                        model.Add(work[e1_idx, s, d] + work[e2_idx, s, d] <= 1)

    # 7. Soft制約: GOODペア制約 (優先ペア同時出勤ボーナス)
    for e1_idx in range(num_staff):
        for e2_idx in range(e1_idx + 1, num_staff):
            st1 = request.staff_members[e1_idx]
            st2 = request.staff_members[e2_idx]
            is_good = (st2.id in st1.preferred_partner_ids) or (st1.id in st2.preferred_partner_ids)
            if is_good:
                for s in range(num_shifts):
                    for d in range(num_days):
                        pair_var = model.NewBoolVar(f"good_pair_e{e1_idx}_e{e2_idx}_s{s}_d{d}")
                        model.Add(pair_var <= work[e1_idx, s, d])
                        model.Add(pair_var <= work[e2_idx, s, d])
                        model.Add(pair_var >= work[e1_idx, s, d] + work[e2_idx, s, d] - 1)
                        obj_vars.append(pair_var)
                        obj_coeffs.append(-3000)  # ペア同時出勤ボーナス (負のコスト)

    # 8. Hard制約: Warm Start / 固定割当 (fixed_assignments)
    for fa in request.fixed_assignments:
        if (
            fa.staff_id in staff_id_to_idx
            and fa.shift_id in shift_id_to_idx
            and fa.day_offset < num_days
        ):
            e_idx = staff_id_to_idx[fa.staff_id]
            s_idx = shift_id_to_idx[fa.shift_id]
            model.Add(work[e_idx, s_idx, fa.day_offset] == 1)

    # 9. Hard制約: 週間最大労働時間
    # 分単位完全整数スケーリング: 留学生は1680分[28h]、一般はmax_weekly_hours * 60
    shift_net_minutes = []
    for s in request.shifts:
        s_parts = s.start.split(":")
        e_parts = s.end.split(":")
        s_m = int(s_parts[0]) * 60 + int(s_parts[1])
        e_m = int(e_parts[0]) * 60 + int(e_parts[1])
        if e_m <= s_m:
            e_m += 24 * 60
        gross_m = e_m - s_m
        net_m = max(0, gross_m - s.break_minutes)
        shift_net_minutes.append(net_m)

    for e_idx, staff in enumerate(request.staff_members):
        effective_max_hours = (
            min(staff.max_weekly_hours, 28.0)
            if staff.is_foreign_student
            else staff.max_weekly_hours
        )
        max_minutes = int(round(effective_max_hours * 60))
        # 7日ごとのブロック制約
        for start_d in range(0, max(1, num_days - 6), 7):
            window_days = range(start_d, min(num_days, start_d + 7))
            minutes_expr = sum(
                shift_net_minutes[s] * work[e_idx, s, d]
                for s in range(num_shifts)
                for d in window_days
            )
            model.Add(minutes_expr <= max_minutes)

    # 10. 必要人数制約 (スラック変数による緩和付き)
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
                assigned_sum = sum(work[e, s, d] for e in range(num_staff))
                under_var = model.NewIntVar(0, required_count, f"under_d{d}_s{s}")
                over_var = model.NewIntVar(0, num_staff, f"over_d{d}_s{s}")

                # assigned + under - over == required
                model.Add(assigned_sum + under_var - over_var == required_count)
                under_cover_vars[d, s] = under_var

                # 人員不足には高額ペナルティ (1,000,000 / 人)
                obj_vars.append(under_var)
                obj_coeffs.append(1000000)
                # 過剰配属には軽微なペナルティ (1,000 / 人)
                obj_vars.append(over_var)
                obj_coeffs.append(1000)

    # 11. Hard制約: 必須ロール要件 (例: kitchen_leader >= 1)
    for (d, s), required_roles in role_req_map.items():
        for role_name, min_role_count in required_roles.items():
            if min_role_count <= 0:
                continue
            capable_staff = [
                e for e, st in enumerate(request.staff_members) if role_name in st.roles
            ]
            if capable_staff:
                role_assigned = sum(work[e, s, d] for e in capable_staff)
                role_under = model.NewIntVar(0, min_role_count, f"role_under_d{d}_s{s}_{role_name}")
                model.Add(role_assigned + role_under >= min_role_count)
                obj_vars.append(role_under)
                obj_coeffs.append(800000)  # ロール不足ペナルティ
            else:
                # 該当ロールを保有するスタッフが1人も存在しない場合
                role_under = model.NewIntVar(
                    min_role_count, min_role_count, f"role_under_d{d}_s{s}_{role_name}"
                )
                obj_vars.append(role_under)
                obj_coeffs.append(800000)

    # 12. スタッフ希望 (unavailable: Hard制約, want: Soft制約)
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
                model.Add(work[e_idx, s_idx, d] == 0)
            elif avail.status == "want":
                obj_vars.append(work[e_idx, s_idx, d].Not())
                obj_coeffs.append(30000)

    # 13. Soft制約: 人件費最小化 (実働時間 × 時給 + 深夜割増 / 10円単位)
    for e in range(num_staff):
        wage = request.staff_members[e].hourly_wage
        for s in range(num_shifts):
            shift = request.shifts[s]
            net_hours = max(0.0, shift.hours - shift.break_minutes / 60.0)
            late_hours = calculate_late_night_hours(shift.start, shift.end)
            cost = int(round(wage * net_hours + wage * 0.25 * late_hours))
            for d in range(num_days):
                obj_vars.append(work[e, s, d])
                obj_coeffs.append(cost // 10)

    # 14. 目的関数の集約
    if obj_vars:
        model.Minimize(
            cp_model.LinearExpr.Sum([v * c for v, c in zip(obj_vars, obj_coeffs, strict=False)])
        )

    return model, work, day_worked, obj_vars, obj_coeffs, under_cover_vars
