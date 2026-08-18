import math
import time
from datetime import datetime, timedelta

from ortools.sat.python import cp_model

from app.engine.constraints import build_optimization_model
from app.engine.time_utils import calculate_late_night_hours
from app.schemas.scheduler import (
    AssignedShiftTimeSchema,
    AssignedStaffSchema,
    ScheduledShiftSlotSchema,
    ScheduleSummarySchema,
    ShiftOptimizeRequest,
    ShiftOptimizeResponse,
    UnfilledRequirementSchema,
)


def _analyze_infeasible_bottlenecks(request: ShiftOptimizeRequest) -> list[str]:
    """Infeasible発生時のボトルネック要因を静的解析して提示する。"""
    bottlenecks: list[str] = []
    num_staff = len(request.staff_members)

    # 1. 出勤日数上限のチェック
    max_days_total = sum(st.max_days_per_period for st in request.staff_members)

    total_shifts_required = sum(req.min_staff for req in request.requirements)
    if total_shifts_required > max_days_total:
        bottlenecks.append(
            f"スタッフ全員の最大出勤日数合計 ({max_days_total}日) が"
            f"総必要シフト数 ({total_shifts_required}枠) を下回っています。"
        )

    # 2. 1日あたりの必要人数とスタッフ総数
    req_by_day: dict[int, int] = {}
    for req in request.requirements:
        req_by_day[req.day_offset] = req_by_day.get(req.day_offset, 0) + req.min_staff

    for d, count in req_by_day.items():
        if count > num_staff:
            bottlenecks.append(
                f"Day {d} の総必要人数 ({count}名) が"
                f"登録スタッフ総数 ({num_staff}名) を超過しています（1日1シフト制約）。"
            )

    # 3. 必須ロール保持者の有無チェック
    all_staff_roles = {r for st in request.staff_members for r in st.roles}
    missing_roles = sorted(
        {
            role
            for req in request.requirements
            for role, count in req.required_roles.items()
            if count > 0 and role not in all_staff_roles
        }
    )
    if missing_roles:
        bottlenecks.append(
            f"必須ロール [{', '.join(missing_roles)}] を保有するスタッフが1人も登録されていません。"
        )

    # 4. NGペア競合チェック
    ng_pairs = []
    for i, st1 in enumerate(request.staff_members):
        for st2 in request.staff_members[i + 1 :]:
            if st2.id in st1.ng_staff_ids or st1.id in st2.ng_staff_ids:
                ng_pairs.append((st1.name, st2.name))
    if ng_pairs:
        bottlenecks.append(f"NGペア制約が設定されています: {ng_pairs[:3]}")

    # 5. 固定割当の重複チェック
    fixed_by_staff_day: dict[tuple[str, int], list[str]] = {}
    for fa in request.fixed_assignments:
        key = (fa.staff_id, fa.day_offset)
        fixed_by_staff_day.setdefault(key, []).append(fa.shift_id)

    for (staff_id, day_offset), shifts in fixed_by_staff_day.items():
        if len(shifts) > 1:
            bottlenecks.append(
                f"スタッフ {staff_id} が Day {day_offset} に"
                f"複数の固定シフト ({shifts}) に重複指定されています。"
            )

    if not bottlenecks:
        bottlenecks.append(
            "Hard制約（勤務間インターバル・連続勤務上限・出勤日数上下限等）"
            "の組み合わせにより解が存在しません。"
        )

    return bottlenecks


def _analyze_shortage_bottlenecks(
    request: ShiftOptimizeRequest,
    unfilled_list: list[UnfilledRequirementSchema],
) -> list[str]:
    """人員不足（FEASIBLE_WITH_SHORTAGE）発生時の要因分析テキストを生成する。"""
    bottlenecks: list[str] = []
    shift_map = {s.id: s for s in request.shifts}

    # 必須ロール保持者の有無チェック
    all_staff_roles = {r for st in request.staff_members for r in st.roles}
    missing_roles = sorted(
        {
            role
            for req in request.requirements
            for role, count in req.required_roles.items()
            if count > 0 and role not in all_staff_roles
        }
    )
    if missing_roles:
        bottlenecks.append(
            f"必須ロール [{', '.join(missing_roles)}] を保有するスタッフが1人も登録されていません。"
        )

    for unfilled in unfilled_list:
        shift = shift_map.get(unfilled.shift_id)
        shift_name = shift.name if shift else unfilled.shift_id
        d = unfilled.day_offset

        # 該当日に不可(unavailable)を出しているスタッフ数
        unavail_count = sum(
            1
            for a in request.availabilities
            if a.day_offset == d and a.shift_id == unfilled.shift_id and a.status == "unavailable"
        )

        # 深夜シフトの場合、未成年者・母性保護対象者の除外
        night_excluded = 0
        if shift and (
            shift.is_late_night or calculate_late_night_hours(shift.start, shift.end) > 0
        ):
            night_excluded = sum(
                1 for st in request.staff_members if st.is_minor or st.is_maternity_protection
            )

        reasons = []
        if unavail_count > 0:
            reasons.append(f"不可希望 {unavail_count}名")
        if night_excluded > 0:
            reasons.append(f"深夜業除外(年少者/母性保護) {night_excluded}名")

        reason_str = " / ".join(reasons) if reasons else "連続勤務・インターバル上限等による制約"
        bottlenecks.append(
            f"{unfilled.date} [{shift_name}]: 不足 {unfilled.shortage}名 "
            f"(必要 {unfilled.required_count}名 / 割当 {unfilled.assigned_count}名) - "
            f"要因: {reason_str}"
        )

    return bottlenecks


def solve_shift_schedule(request: ShiftOptimizeRequest) -> ShiftOptimizeResponse:
    """OR-Tools CP-SAT ソルバーを実行し、シフト最適化結果を生成する。"""
    # 1時間ごとのタイムスロット指定がある場合はタイムスロット連続最適化を実行
    if request.hourly_requirements:
        from app.engine.hourly_solver import solve_hourly_shift_schedule

        return solve_hourly_shift_schedule(request)

    start_time = time.time()
    model, work, day_worked, obj_vars, obj_coeffs, under_cover_vars = build_optimization_model(
        request
    )

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 4.0
    solver.parameters.num_search_workers = 4
    solver.parameters.relative_gap_limit = 0.05  # 5%ギャップ以内で高速終了

    status = solver.Solve(model)
    elapsed_ms = int((time.time() - start_time) * 1000)

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        bottlenecks = _analyze_infeasible_bottlenecks(request)
        return ShiftOptimizeResponse(
            status="INFEASIBLE",
            solve_time_ms=elapsed_ms,
            summary=ScheduleSummarySchema(
                total_labor_cost=0,
                total_work_hours=0.0,
                total_break_hours=0.0,
                deep_night_extra_cost=0,
                wants_fulfillment_rate=0.0,
                max_staff_day_difference=0,
                unfilled_requirements=[],
                bottleneck_constraints=bottlenecks,
            ),
            schedule=[],
        )

    # 結果の集約
    num_staff = len(request.staff_members)
    num_shifts = len(request.shifts)
    num_days = request.period.days
    start_date_obj = datetime.strptime(request.period.start_date, "%Y-%m-%d")

    # スタッフごとの希望マップ (staff_id, day_offset, shift_id) -> status
    avail_map = {(a.staff_id, a.day_offset, a.shift_id): a.status for a in request.availabilities}

    schedule_slots: list[ScheduledShiftSlotSchema] = []
    assigned_shifts_list: list[AssignedShiftTimeSchema] = []
    total_base_labor_cost = 0
    total_deep_night_extra_cost = 0
    total_work_hours = 0.0
    total_break_hours = 0.0
    total_wants = 0
    fulfilled_wants = 0
    staff_days_count = [0] * num_staff
    unfilled_list: list[UnfilledRequirementSchema] = []

    # 希望合計の事前カウント
    for a in request.availabilities:
        if a.status == "want" and a.day_offset < num_days:
            total_wants += 1

    for d in range(num_days):
        current_date_str = (start_date_obj + timedelta(days=d)).strftime("%Y-%m-%d")

        for s in range(num_shifts):
            shift = request.shifts[s]
            net_shift_hours = max(0.0, shift.hours - shift.break_minutes / 60.0)
            break_hours = shift.break_minutes / 60.0
            late_hours = calculate_late_night_hours(shift.start, shift.end)

            assigned_staff_list: list[AssignedStaffSchema] = []

            for e in range(num_staff):
                if solver.Value(work[e, s, d]) == 1:
                    staff = request.staff_members[e]
                    is_want = avail_map.get((staff.id, d, shift.id)) == "want"
                    if is_want:
                        fulfilled_wants += 1

                    assigned_staff_list.append(
                        AssignedStaffSchema(
                            id=staff.id,
                            name=staff.name,
                            assigned_role=staff.roles[0] if staff.roles else "staff",
                            hourly_wage=staff.hourly_wage,
                            is_want_fulfilled=is_want,
                        )
                    )

                    # 基本人件費（実働時間 × 時給 / 四捨五入）
                    base_cost = int(math.floor(staff.hourly_wage * net_shift_hours + 0.5))
                    # 深夜割増人件費（22:00〜05:00にかかる時間 × 時給 × 0.25 / 四捨五入）
                    night_extra = int(math.floor(staff.hourly_wage * 0.25 * late_hours + 0.5))

                    assigned_shifts_list.append(
                        AssignedShiftTimeSchema(
                            staff_id=staff.id,
                            name=staff.name,
                            day_offset=d,
                            date=current_date_str,
                            start_time=shift.start,
                            end_time=shift.end,
                            hours=net_shift_hours,
                            break_minutes=shift.break_minutes,
                            hourly_wage=staff.hourly_wage,
                            labor_cost=base_cost + night_extra,
                            is_late_night=shift.is_late_night or late_hours > 0,
                        )
                    )

                    total_base_labor_cost += base_cost
                    total_deep_night_extra_cost += night_extra
                    total_work_hours += net_shift_hours
                    total_break_hours += break_hours
                    staff_days_count[e] += 1

            # 不足チェック (スラック変数)
            under_var = under_cover_vars.get((d, s))
            shortage = solver.Value(under_var) if under_var is not None else 0

            if shortage > 0:
                unfilled_list.append(
                    UnfilledRequirementSchema(
                        date=current_date_str,
                        day_offset=d,
                        shift_id=shift.id,
                        required_count=len(assigned_staff_list) + shortage,
                        assigned_count=len(assigned_staff_list),
                        shortage=shortage,
                        reason="出勤可能スタッフの上限到達または全員NG",
                    )
                )

            schedule_slots.append(
                ScheduledShiftSlotSchema(
                    date=current_date_str,
                    day_offset=d,
                    shift_id=shift.id,
                    assigned_staff=assigned_staff_list,
                )
            )

    wants_rate = (fulfilled_wants / total_wants) if total_wants > 0 else 1.0
    day_diff = (max(staff_days_count) - min(staff_days_count)) if staff_days_count else 0
    final_status = "FEASIBLE_WITH_SHORTAGE" if unfilled_list else "OPTIMAL"

    bottleneck_constraints = []
    all_staff_roles = {r for st in request.staff_members for r in st.roles}
    missing_roles = sorted(
        {
            role
            for req in request.requirements
            for role, count in req.required_roles.items()
            if count > 0 and role not in all_staff_roles
        }
    )
    if unfilled_list:
        bottleneck_constraints = _analyze_shortage_bottlenecks(request, unfilled_list)
    elif missing_roles:
        bottleneck_constraints.append(
            f"必須ロール [{', '.join(missing_roles)}] を保有するスタッフが1人も登録されていません。"
        )

    total_labor_cost = total_base_labor_cost + total_deep_night_extra_cost

    return ShiftOptimizeResponse(
        status=final_status,
        solve_time_ms=elapsed_ms,
        summary=ScheduleSummarySchema(
            total_labor_cost=total_labor_cost,
            total_work_hours=round(total_work_hours, 2),
            total_break_hours=round(total_break_hours, 2),
            deep_night_extra_cost=total_deep_night_extra_cost,
            wants_fulfillment_rate=round(wants_rate, 2),
            max_staff_day_difference=day_diff,
            unfilled_requirements=unfilled_list,
            bottleneck_constraints=bottleneck_constraints,
        ),
        schedule=schedule_slots,
        assigned_shifts=assigned_shifts_list,
    )
