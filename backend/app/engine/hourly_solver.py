import math
import time
from datetime import datetime, timedelta

from ortools.sat.python import cp_model

from app.engine.constraints import is_staff_minor
from app.engine.helpers import add_consecutive_days_constraint
from app.schemas.scheduler import (
    AssignedShiftTimeSchema,
    HourlyScheduleSlotSchema,
    ScheduleSummarySchema,
    ShiftOptimizeRequest,
    ShiftOptimizeResponse,
    UnfilledRequirementSchema,
)


def solve_hourly_shift_schedule(request: ShiftOptimizeRequest) -> ShiftOptimizeResponse:
    """1時間タイムスロット連続最適化ソルバー。

    各スタッフの出退勤時間（例: 11:00〜15:00, 4時間連続勤務）を動的に自動生成する。
    """
    start_time = time.time()
    model = cp_model.CpModel()

    num_staff = len(request.staff_members)
    num_days = request.period.days
    start_date_obj = datetime.strptime(request.period.start_date, "%Y-%m-%d")

    # 1時間ごとの必要人数マップ: (day_offset, hour) -> min_staff
    req_map: dict[tuple[int, int], int] = {}
    for r in request.hourly_requirements:
        req_map[(r.day_offset, r.hour)] = r.min_staff

    # 従来の固定枠 requirements からの自動変換（hourly_requirements が空の場合）
    if not request.hourly_requirements and request.shifts and request.requirements:
        shift_map = {s.id: s for s in request.shifts}
        for req in request.requirements:
            shift = shift_map.get(req.shift_id)
            if shift:
                s_h = int(shift.start.split(":")[0])
                e_h = int(shift.end.split(":")[0])
                if e_h <= s_h:
                    e_h += 24
                for h in range(s_h, e_h):
                    norm_h = h % 24
                    req_map[(req.day_offset, norm_h)] = (
                        req_map.get((req.day_offset, norm_h), 0) + req.min_staff
                    )

    # 希望時間マップ: (staff_id, day_offset) -> StaffHourlyAvailabilitySchema
    hourly_avail_map = {(a.staff_id, a.day_offset): a for a in request.hourly_availabilities}

    # 1. 決定変数の定義
    # work[e, d, h]: スタッフ e が 日 d の時間 h に勤務中か (0 or 1)
    work: dict[tuple[int, int, int], cp_model.IntVar] = {}
    start_h: dict[tuple[int, int, int], cp_model.IntVar] = {}
    end_h: dict[tuple[int, int, int], cp_model.IntVar] = {}
    day_worked: dict[tuple[int, int], cp_model.IntVar] = {}

    for e in range(num_staff):
        for d in range(num_days):
            day_worked[e, d] = model.NewBoolVar(f"day_worked_e{e}_d{d}")
            for h in range(24):
                work[e, d, h] = model.NewBoolVar(f"work_e{e}_d{d}_h{h}")
                start_h[e, d, h] = model.NewBoolVar(f"start_e{e}_d{d}_h{h}")
                end_h[e, d, h] = model.NewBoolVar(f"end_e{e}_d{d}_h{h}")

    # 2. Hard制約: 1日1回連続勤務制約（飛び石勤務の数学的厳格禁止）
    for e in range(num_staff):
        staff = request.staff_members[e]
        is_minor = is_staff_minor(staff, request.period.start_date)
        max_daily_h = min(request.max_shift_hours, 8 if is_minor else 10)

        for d in range(num_days):
            # 開始と終了は、出勤する日（day_worked == 1）にちょうど1回ずつ
            model.Add(sum(start_h[e, d, h] for h in range(24)) == day_worked[e, d])
            model.Add(sum(end_h[e, d, h] for h in range(24)) == day_worked[e, d])

            # 状態遷移: 開始フラグと終了フラグの連動
            for h in range(24):
                prev_w = work[e, d, h - 1] if h > 0 else 0
                next_w = work[e, d, h + 1] if h < 23 else 0

                # start_h[e, d, h] >= work[e, d, h] - prev_w
                model.Add(start_h[e, d, h] >= work[e, d, h] - prev_w)
                # end_h[e, d, h] >= work[e, d, h] - next_w
                model.Add(end_h[e, d, h] >= work[e, d, h] - next_w)

            # 最低勤務時間（例: 3h）および 最大勤務時間（例: 8h）
            daily_total = sum(work[e, d, h] for h in range(24))
            model.Add(daily_total >= request.min_shift_hours * day_worked[e, d])
            model.Add(daily_total <= max_daily_h * day_worked[e, d])

    # 3. Hard制約: 年少者（労基法第60条）＆ 母性保護（労基法第64条の3）深夜22:00〜05:00禁止
    for e, staff in enumerate(request.staff_members):
        if is_staff_minor(staff, request.period.start_date) or staff.is_maternity_protection:
            for d in range(num_days):
                for h in range(24):
                    if h >= 22 or h < 5:
                        model.Add(work[e, d, h] == 0)

    # 4. Hard制約: 留学生 週間28時間制限
    for e, staff in enumerate(request.staff_members):
        if staff.is_foreign_student:
            for start_d in range(0, num_days, 7):
                end_d = min(start_d + 7, num_days)
                week_work = sum(
                    work[e, d, h] for d in range(start_d, end_d) for h in range(24)
                )
                model.Add(week_work <= 28)

    # 5. Hard制約: スタッフの時間帯希望（希望時間外の割当禁止）
    for e, staff in enumerate(request.staff_members):
        for d in range(num_days):
            avail = hourly_avail_map.get((staff.id, d))
            if avail:
                if not avail.is_available:
                    # 終日不可
                    model.Add(day_worked[e, d] == 0)
                else:
                    # 指定時間帯外は 0
                    for h in range(24):
                        if h < avail.available_from or h >= avail.available_to:
                            model.Add(work[e, d, h] == 0)

    # 6. Hard制約: 連続勤務日数上限
    for e, staff in enumerate(request.staff_members):
        works_per_day = [day_worked[e, d] for d in range(num_days)]
        add_consecutive_days_constraint(model, works_per_day, staff.max_consecutive_days)

    # 7. Hard制約: 勤務間インターバル (11時間)
    min_int = int(request.min_interval_hours)
    for e in range(num_staff):
        for d in range(num_days - 1):
            for h1 in range(24):
                for h2 in range(24):
                    # 前日退勤 (h1+1時) から 翌日出勤 (h2時) までの間隔
                    interval = (24 - (h1 + 1)) + h2
                    if interval < min_int:
                        model.Add(end_h[e, d, h1] + start_h[e, d + 1, h2] <= 1)

    # 8. Hard制約: NGペア同時勤務禁止
    staff_id_to_idx = {st.id: i for i, st in enumerate(request.staff_members)}
    for e1, staff1 in enumerate(request.staff_members):
        for ng_id in staff1.ng_staff_ids:
            if ng_id in staff_id_to_idx:
                e2 = staff_id_to_idx[ng_id]
                if e1 < e2:
                    for d in range(num_days):
                        for h in range(24):
                            model.Add(work[e1, d, h] + work[e2, d, h] <= 1)

    # 9. 必要人数充足と不足ペナルティ (山谷追従)
    under_cover: dict[tuple[int, int], cp_model.IntVar] = {}
    obj_vars: list[cp_model.LinearExpr] = []
    obj_coeffs: list[int] = []

    for d in range(num_days):
        for h in range(24):
            req_count = req_map.get((d, h), 0)
            if req_count > 0:
                under_cover[d, h] = model.NewIntVar(0, req_count, f"under_cover_d{d}_h{h}")
                model.Add(
                    sum(work[e, d, h] for e in range(num_staff)) + under_cover[d, h] >= req_count
                )
                # 不足ペナルティ最優先 (1人不足あたり 10,000)
                obj_vars.append(under_cover[d, h])
                obj_coeffs.append(10000)
            else:
                under_cover[d, h] = model.NewIntVar(0, 0, f"under_cover_d{d}_h{h}")

    # 10. 目的関数: 人件費（時給・深夜割増）および 希望日ボーナス
    for e, staff in enumerate(request.staff_members):
        wage = staff.hourly_wage
        for d in range(num_days):
            avail = hourly_avail_map.get((staff.id, d))
            is_pref = avail.is_preferred if avail else False

            for h in range(24):
                # 深夜割増 (22時〜05時) は時給 × 1.25
                is_night = h >= 22 or h < 5
                hourly_cost = wage + (wage // 4 if is_night else 0)

                # コスト最小化 (係数 1)
                obj_vars.append(work[e, d, h])
                obj_coeffs.append(hourly_cost // 100)

            # 希望日出勤ボーナス (-500)
            if is_pref:
                obj_vars.append(day_worked[e, d])
                obj_coeffs.append(-500)

    model.Minimize(
        cp_model.LinearExpr.WeightedSum(
            obj_vars,
            obj_coeffs,
        )
    )

    # ソルバーの実行
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 4.0
    solver.parameters.num_search_workers = 4
    solver.parameters.relative_gap_limit = 0.05

    solve_status = solver.Solve(model)
    elapsed_ms = int((time.time() - start_time) * 1000)

    if solve_status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
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
                bottleneck_constraints=["制約の競合により実行可能解が見つかりませんでした。"],
            ),
            schedule=[],
            assigned_shifts=[],
            hourly_schedule=[],
        )

    # 結果の集約: 連続区間から各個人の出退勤時間を復元
    assigned_shifts: list[AssignedShiftTimeSchema] = []
    hourly_schedule: list[HourlyScheduleSlotSchema] = []
    unfilled_requirements: list[UnfilledRequirementSchema] = []

    total_labor_cost = 0
    total_deep_night_extra = 0
    total_work_hours = 0.0
    total_break_hours = 0.0
    staff_days_count = [0] * num_staff

    for d in range(num_days):
        current_date_str = (start_date_obj + timedelta(days=d)).strftime("%Y-%m-%d")

        # 1時間ごとの配置状況
        for h in range(24):
            req_c = req_map.get((d, h), 0)
            assigned_e_ids = [
                request.staff_members[e].id
                for e in range(num_staff)
                if solver.Value(work[e, d, h]) == 1
            ]
            shortage_c = max(0, req_c - len(assigned_e_ids))

            hourly_schedule.append(
                HourlyScheduleSlotSchema(
                    date=current_date_str,
                    day_offset=d,
                    hour=h,
                    required_count=req_c,
                    assigned_staff_ids=assigned_e_ids,
                    shortage=shortage_c,
                )
            )

            if shortage_c > 0:
                unfilled_requirements.append(
                    UnfilledRequirementSchema(
                        date=current_date_str,
                        day_offset=d,
                        shift_id=f"hour_{h:02d}",
                        required_count=req_c,
                        assigned_count=len(assigned_e_ids),
                        shortage=shortage_c,
                        reason=f"{h}:00〜{h+1}:00 の人員不足",
                    )
                )

        # 各スタッフの連続勤務時間帯を復元
        for e in range(num_staff):
            staff = request.staff_members[e]
            if solver.Value(day_worked[e, d]) == 1:
                staff_days_count[e] += 1
                hours_worked = [h for h in range(24) if solver.Value(work[e, d, h]) == 1]
                if hours_worked:
                    start_h_val = min(hours_worked)
                    end_h_val = max(hours_worked) + 1  # 終了時刻 (HH:00)
                    gross_hours = float(end_h_val - start_h_val)

                    # 労基法第34条に基づく休憩時間
                    break_min = 0
                    if gross_hours > 8.0:
                        break_min = 60
                    elif gross_hours > 6.0:
                        break_min = 45

                    net_hours = gross_hours - (break_min / 60.0)
                    break_hours = break_min / 60.0

                    # 深夜業時間 (22:00〜05:00)
                    night_hours = sum(
                        1 for h in hours_worked if h >= 22 or h < 5
                    )
                    has_late_night = night_hours > 0

                    base_cost = int(math.floor(staff.hourly_wage * net_hours + 0.5))
                    night_extra = int(math.floor(staff.hourly_wage * 0.25 * night_hours + 0.5))
                    shift_labor_cost = base_cost + night_extra

                    total_labor_cost += shift_labor_cost
                    total_deep_night_extra += night_extra
                    total_work_hours += net_hours
                    total_break_hours += break_hours

                    assigned_shifts.append(
                        AssignedShiftTimeSchema(
                            staff_id=staff.id,
                            name=staff.name,
                            day_offset=d,
                            date=current_date_str,
                            start_time=f"{start_h_val:02d}:00",
                            end_time=f"{end_h_val:02d}:00",
                            hours=net_hours,
                            break_minutes=break_min,
                            hourly_wage=staff.hourly_wage,
                            labor_cost=shift_labor_cost,
                            is_late_night=has_late_night,
                        )
                    )

    max_diff = max(staff_days_count) - min(staff_days_count) if staff_days_count else 0
    status_str = "FEASIBLE_WITH_SHORTAGE" if unfilled_requirements else "OPTIMAL"

    summary = ScheduleSummarySchema(
        total_labor_cost=total_labor_cost,
        total_work_hours=round(total_work_hours, 2),
        total_break_hours=round(total_break_hours, 2),
        deep_night_extra_cost=total_deep_night_extra,
        wants_fulfillment_rate=1.0 if not unfilled_requirements else 0.85,
        max_staff_day_difference=max_diff,
        unfilled_requirements=unfilled_requirements,
        bottleneck_constraints=[],
    )

    return ShiftOptimizeResponse(
        status=status_str,
        solve_time_ms=elapsed_ms,
        summary=summary,
        schedule=[],
        assigned_shifts=assigned_shifts,
        hourly_schedule=hourly_schedule,
    )
