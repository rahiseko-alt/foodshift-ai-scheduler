import time
from datetime import datetime, timedelta

from ortools.sat.python import cp_model

from app.engine.constraints import build_optimization_model
from app.schemas.scheduler import (
    AssignedStaffSchema,
    ScheduledShiftSlotSchema,
    ScheduleSummarySchema,
    ShiftOptimizeRequest,
    ShiftOptimizeResponse,
    UnfilledRequirementSchema,
)


def solve_shift_schedule(request: ShiftOptimizeRequest) -> ShiftOptimizeResponse:
    """OR-Tools CP-SAT ソルバーを実行し、シフト最適化結果を生成する。"""
    start_time = time.time()
    model, work, day_worked, obj_vars, obj_coeffs, under_cover_vars = build_optimization_model(
        request
    )

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 5.0
    solver.parameters.num_search_workers = 4
    solver.parameters.relative_gap_limit = 0.05  # 5%ギャップ以内で高速終了

    status = solver.Solve(model)
    elapsed_ms = int((time.time() - start_time) * 1000)

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return ShiftOptimizeResponse(
            status="INFEASIBLE",
            solve_time_ms=elapsed_ms,
            summary=ScheduleSummarySchema(
                total_labor_cost=0,
                total_work_hours=0.0,
                wants_fulfillment_rate=0.0,
                max_staff_day_difference=0,
                unfilled_requirements=[],
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
    total_labor_cost = 0
    total_work_hours = 0.0
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
                    total_labor_cost += int(staff.hourly_wage * shift.hours)
                    total_work_hours += shift.hours
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

    return ShiftOptimizeResponse(
        status=final_status,
        solve_time_ms=elapsed_ms,
        summary=ScheduleSummarySchema(
            total_labor_cost=total_labor_cost,
            total_work_hours=round(total_work_hours, 1),
            wants_fulfillment_rate=round(wants_rate, 2),
            max_staff_day_difference=day_diff,
            unfilled_requirements=unfilled_list,
        ),
        schedule=schedule_slots,
    )
