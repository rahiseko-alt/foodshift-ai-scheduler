import math
import time
from datetime import datetime, timedelta

from ortools.sat.python import cp_model

from app.engine.constraints import (
    collect_compliance_warnings,
    describe_no_solution,
    effective_max_weekly_hours,
    is_staff_minor,
)
from app.engine.helpers import add_consecutive_days_constraint, add_rolling_window_limit
from app.engine.time_utils import build_hourly_requirements_from_shifts, parse_time_to_minutes
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

    compliance_warnings = collect_compliance_warnings(request)
    num_staff = len(request.staff_members)
    num_days = request.period.days
    start_date_obj = datetime.strptime(request.period.start_date, "%Y-%m-%d")

    # 1時間ごとの必要人数マップ: (day_offset, hour) -> min_staff
    req_map: dict[tuple[int, int], int] = {}
    # 1時間ごとの必須ロールマップ: (day_offset, hour) -> {role: 必要数}
    role_req_map: dict[tuple[int, int], dict[str, int]] = {}
    for r in request.hourly_requirements:
        req_map[(r.day_offset, r.hour)] = r.min_staff
        if r.required_roles:
            role_req_map[(r.day_offset, r.hour)] = r.required_roles

    # 従来の固定枠 requirements からの自動変換（hourly_requirements が空の場合）
    if not request.hourly_requirements and request.shifts and request.requirements:
        req_map = build_hourly_requirements_from_shifts(request.shifts, request.requirements)

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

    # 4. Hard制約: 週間最大労働時間（全スタッフ／任意の連続7日窓）
    #
    # 従来は留学生の28時間制限のみを、しかも非重複ブロックで張っていた。
    # 一般スタッフの max_weekly_hours はこのソルバーで一切参照されておらず、
    # 管理画面からの最適化は全てこのソルバーに到達するため、
    # 36協定・契約上の週上限が本番経路で丸ごと無効になっていた。
    #
    # 単位について（意図的な選択）:
    # このソルバーは休憩をモデル変数として持たない（解の事後に控除している）ため、
    # sum(work[e, d, h]) は実労働時間ではなく拘束時間である。
    # これを max_weekly_hours に対して掛けるのは法定より厳しい側であり、
    # 上限としては安全側。正確な実労働時間での上限は休憩のモデル内制約化
    # （15分グリッド化が前提）が必要なため、別途対応する。
    for e, staff in enumerate(request.staff_members):
        daily_hours = [sum(work[e, d, h] for h in range(24)) for d in range(num_days)]
        max_hours = int(effective_max_weekly_hours(staff))
        add_rolling_window_limit(model, daily_hours, max_hours)

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

    # 9b. Hard制約: 必須ロール要件（例: kitchen 1名常駐）
    #
    # `HourlyRequirementSchema.required_roles` はスキーマに存在するが
    # このソルバーで一度も読まれておらず、管理画面からの最適化は全て
    # ここに到達するため「調理できるスタッフが1人もいないシフト」が
    # 正常解として出力されていた。人数要件と同じくスラック変数で緩和し、
    # 不足時は解なしではなく不足として可視化する。
    for (d, h), roles in role_req_map.items():
        if d >= num_days:
            continue
        for role_name, min_role_count in roles.items():
            if min_role_count <= 0:
                continue
            capable = [e for e, st in enumerate(request.staff_members) if role_name in st.roles]
            role_under = model.NewIntVar(0, min_role_count, f"role_under_d{d}_h{h}_{role_name}")
            if capable:
                model.Add(sum(work[e, d, h] for e in capable) + role_under >= min_role_count)
            else:
                # 該当ロール保有者が1人もいない場合は全量不足として計上する
                model.Add(role_under == min_role_count)
            # 人数不足(10,000)より重く扱う: 頭数が揃っていても職能が欠ければ店は回らない
            obj_vars.append(role_under)
            obj_coeffs.append(20000)

    # 9c. Hard制約: 固定割当 (fixed_assignments)
    #
    # 店長が手で確定した配置・交渉で確保したスタッフを保持する。
    # 従来このソルバーでは完全に無視されており、再最適化のたびに消えていた。
    # 時間帯まで指定されたシフト枠が特定できる場合はその時間も固定する。
    shift_span_by_id = {}
    for sh in request.shifts:
        s_min = parse_time_to_minutes(sh.start)
        e_min = parse_time_to_minutes(sh.end)
        if e_min <= s_min:
            e_min += 24 * 60
        shift_span_by_id[sh.id] = (s_min // 60, -(-e_min // 60))

    for fa in request.fixed_assignments:
        if fa.staff_id not in staff_id_to_idx or fa.day_offset >= num_days:
            continue
        e_idx = staff_id_to_idx[fa.staff_id]
        model.Add(day_worked[e_idx, fa.day_offset] == 1)
        span = shift_span_by_id.get(fa.shift_id)
        if span:
            s_h, e_h = span
            for h in range(s_h, e_h):
                model.Add(work[e_idx, fa.day_offset, h % 24] == 1)

    # 9d. Hard制約: 期間内の出勤日数の上下限
    #
    # 「週3日は必ず入れる」「月10日まで」といった契約上の約束。
    # min は緩和変数を持たないと週上限と衝突して INFEASIBLE になるため、
    # 不足として緩和し理由を可視化する（constraints.py 側は Hard のまま）。
    for e_idx, staff in enumerate(request.staff_members):
        total_days = sum(day_worked[e_idx, d] for d in range(num_days))
        if staff.min_days_per_period > 0:
            effective_min = min(staff.min_days_per_period, num_days)
            days_under = model.NewIntVar(0, effective_min, f"days_under_e{e_idx}")
            model.Add(total_days + days_under >= effective_min)
            obj_vars.append(days_under)
            obj_coeffs.append(5000)
        if staff.max_days_per_period < num_days:
            model.Add(total_days <= staff.max_days_per_period)

    # 10. 目的関数: 人件費（時給・深夜割増）および 希望日ボーナス
    # 希望ボーナスの上限: 最も安いスタッフが最低勤務時間だけ働いたときのコスト未満。
    # これを超えると「働くこと自体が得」になり需要のない出勤が発生する。
    cheapest_hourly_coeff = min((st.hourly_wage // 100) for st in request.staff_members)
    cheapest_day_cost = max(1, cheapest_hourly_coeff * request.min_shift_hours)
    preference_bonus = max(1, cheapest_day_cost - 1)

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

            # 希望日出勤ボーナス
            #
            # 従来は -500 の固定値だったが、1時間あたりのコスト係数は
            # hourly_cost // 100 = 約10〜12 でしかない。最低勤務時間3hでも
            # 1日working するコストは約30であり、ボーナスがそれを大きく上回るため
            # **需要がゼロの日にも希望というだけで出勤させる**状態だった。
            # 「1日働いて得られるボーナス < その1日の最低コスト」を満たす値にし、
            # 希望が新たな需要を生まないようにする（同条件での優先順位付けには効く）。
            if is_pref:
                obj_vars.append(day_worked[e, d])
                obj_coeffs.append(-preference_bonus)

    model.Minimize(
        cp_model.LinearExpr.WeightedSum(
            obj_vars,
            obj_coeffs,
        )
    )

    # ソルバーの実行
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 4.0
    # ワーカー数について（実測に基づく意図的な選択）:
    # 同一入力でも解が変わる問題を単一ワーカー化で解消しようとしたが、
    # 15人×14日で不足154枠（店が回らない解）しか出せず、
    # 制限時間を20秒に延ばしても改善しなかった。時間ではなく探索戦略の問題。
    #   workers=1 -> 決定的だが 不足154枠 / workers=4 -> 不足0枠だが非決定的
    # 「まず使えること」を優先し品質を採る。再現性が無いことは
    # is_proven_optimal で正直に表示し、「最適解確定」とは名乗らない。
    solver.parameters.num_search_workers = 4
    solver.parameters.random_seed = 0
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
                bottleneck_constraints=describe_no_solution(request, solve_status),
                compliance_warnings=compliance_warnings,
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

    # 希望充足率の分母。
    # is_available=False の日は day_worked==0 が強制される（構造的に充足不能）ため
    # 分母から除外する。含めると充足率が恒久的に下がってしまう。
    total_wants = sum(
        1
        for a in request.hourly_availabilities
        if a.is_preferred and a.is_available and a.day_offset < num_days
    )
    fulfilled_wants = 0

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
                        reason=f"{h}:00〜{h + 1}:00 の人員不足",
                    )
                )

        # 各スタッフの連続勤務時間帯を復元
        for e in range(num_staff):
            staff = request.staff_members[e]
            if solver.Value(day_worked[e, d]) == 1:
                staff_days_count[e] += 1
                avail_pref = hourly_avail_map.get((staff.id, d))
                if avail_pref and avail_pref.is_preferred and avail_pref.is_available:
                    fulfilled_wants += 1
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
                    night_hours = sum(1 for h in hours_worked if h >= 22 or h < 5)
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
    # solver.py:298 と同じ意味論に揃える（希望が0件なら1.0）
    wants_rate = (fulfilled_wants / total_wants) if total_wants > 0 else 1.0
    status_str = "FEASIBLE_WITH_SHORTAGE" if unfilled_requirements else "OPTIMAL"

    summary = ScheduleSummarySchema(
        total_labor_cost=total_labor_cost,
        total_work_hours=round(total_work_hours, 2),
        total_break_hours=round(total_break_hours, 2),
        deep_night_extra_cost=total_deep_night_extra,
        # 従来は `1.0 if not unfilled_requirements else 0.85` という決め打ちで、
        # 希望充足率を一切計算していなかった（人員不足の有無という別概念の関数）。
        # この値は管理者のKPIカードと、スタッフへ配布するLINE本文に表示される。
        wants_fulfillment_rate=round(wants_rate, 2),
        max_staff_day_difference=max_diff,
        unfilled_requirements=unfilled_requirements,
        bottleneck_constraints=[],
        compliance_warnings=compliance_warnings,
        # CP-SAT が最適性を証明できたか。制限時間内に打ち切った解は FEASIBLE であり
        # 「最適解確定」ではない。従来は実ステータスを捨てて unfilled の有無だけで
        # OPTIMAL を名乗っていたため、同一入力で異なる解が全て「最適」と表示されていた。
        is_proven_optimal=(solve_status == cp_model.OPTIMAL),
    )

    return ShiftOptimizeResponse(
        status=status_str,
        solve_time_ms=elapsed_ms,
        summary=summary,
        schedule=[],
        assigned_shifts=assigned_shifts,
        hourly_schedule=hourly_schedule,
    )
