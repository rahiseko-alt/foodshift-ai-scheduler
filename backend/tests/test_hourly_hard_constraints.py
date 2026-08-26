"""本番経路(hourly ソルバー)の Hard 制約を、変異テストで殺せる形で検証する。

このモジュールの各テストは「実装のどの1行を壊すと赤くなるか」を
docstring に明記している。変異テスト (`scratchpad/mutate.py` 相当) で
実際に赤くなることを確認済みのものだけを置く。

**設計方針**

* 上界だけ／下界だけのアサーションを置かない。
  「割当が0件でも通る」テストは制約を1つも見張っていない。
  そのため各テストは必ず**対照群**（制約を外せば別の結果になること、
  あるいは対象スタッフに実際に割当があること）を併せて主張する。
* 条件付きガード (`if xxx:`) の中だけに assert を置かない。
  ガードが偽なら何も検証せずに緑になる。
* 勤務実績は `assigned_shifts`（開始・終了時刻の丸め表現）ではなく
  `hourly_schedule`（1時間スロットの実体）から復元する。
  前者は最小・最大時刻しか持たないため、飛び石勤務の穴が観測できない。
"""

import pytest

from app.engine.solver import solve_shift_schedule
from app.schemas.scheduler import (
    FixedAssignmentSchema,
    HourlyRequirementSchema,
    PeriodSchema,
    ShiftOptimizeRequest,
    ShiftSchema,
    StaffHourlyAvailabilitySchema,
    StaffMemberSchema,
)

# --------------------------------------------------------------------------
# ヘルパー
# --------------------------------------------------------------------------


def make_staff(sid: str = "s1", **overrides) -> StaffMemberSchema:
    base = {
        "id": sid,
        "name": f"スタッフ{sid}",
        "roles": ["hall"],
        "hourly_wage": 1000,
        "max_consecutive_days": 7,
    }
    base.update(overrides)
    return StaffMemberSchema(**base)


def hourly_request(
    staff: list[StaffMemberSchema],
    *,
    days: int = 1,
    demand: dict[int, list[int]] | None = None,
    min_staff: int = 1,
    **kwargs,
) -> ShiftOptimizeRequest:
    """demand: {day_offset: [hour, ...]} の必要人数を組み立てる。"""
    demand = demand or {0: list(range(10, 14))}
    return ShiftOptimizeRequest(
        period=PeriodSchema(start_date="2026-09-01", days=days),
        staff_members=staff,
        hourly_requirements=[
            HourlyRequirementSchema(day_offset=d, hour=h, min_staff=min_staff)
            for d, hours in demand.items()
            for h in hours
        ],
        **kwargs,
    )


def worked_hours(response, staff_id: str, day_offset: int = 0) -> list[int]:
    """1時間スロットの実体から、その日の実勤務時刻を昇順で復元する。

    `assigned_shifts` は開始・終了時刻しか持たず、途中の穴（飛び石勤務）を
    観測できないため、必ずこちらを使う。
    """
    return sorted(
        slot.hour
        for slot in response.hourly_schedule
        if slot.day_offset == day_offset and staff_id in slot.assigned_staff_ids
    )


def worked_days(response, staff_id: str) -> list[int]:
    return sorted(
        {
            slot.day_offset
            for slot in response.hourly_schedule
            if staff_id in slot.assigned_staff_ids
        }
    )


def gross_hours(response, staff_id: str, days: range) -> int:
    return sum(
        1
        for slot in response.hourly_schedule
        if staff_id in slot.assigned_staff_ids and slot.day_offset in days
    )


def longest_streak(days: list[int]) -> int:
    if not days:
        return 0
    best = run = 1
    for prev, cur in zip(days, days[1:], strict=False):
        run = run + 1 if cur == prev + 1 else 1
        best = max(best, run)
    return best


# --------------------------------------------------------------------------
# 留学生28時間規制（スキーマ検証をバイパスしてもエンジンが守ること）
#
# `StaffMemberSchema` が留学生の max_weekly_hours>28 を弾くため、
# 通常経路では `effective_max_weekly_hours()` の min() が常に恒等写像になり、
# 「エンジン側の28時間キャップ」を検証しているテストが1件も無かった。
# スキーマを1行緩めるだけで規制が丸ごと消える状態だったため、
# ここではスキーマ検証を意図的にバイパスして多層防御を検証する。
# --------------------------------------------------------------------------


def test_foreign_student_28h_cap_is_enforced_by_the_engine_not_only_the_schema() -> None:
    """スキーマ検証をバイパスしても、エンジン側で28時間に丸められる。

    変異: `effective_max_weekly_hours` の
    `min(staff.max_weekly_hours, FOREIGN_STUDENT_WEEKLY_HOURS_CAP)` を
    `staff.max_weekly_hours` にすると赤くなる。
    """
    staff = make_staff("fs", is_foreign_student=True, max_weekly_hours=28.0)
    request = hourly_request([staff], days=7, demand={d: list(range(10, 18)) for d in range(7)})
    # スキーマ検証を経由せずに上限を書き換える（フロント改竄・別経路流入の模擬）。
    # ShiftOptimizeRequest はネストしたモデルを再検証するため、
    # 組み立て後の実体に対して書き換える必要がある。
    request.staff_members[0].max_weekly_hours = 40.0
    assert request.staff_members[0].max_weekly_hours == 40.0, "バイパスが効いていない"

    res = solve_shift_schedule(request)

    assert res.status != "INFEASIBLE"
    worked = gross_hours(res, "fs", range(7))
    # 対照群: 需要は 7日×8時間=56時間あるので、上限が効いていなければ 28 を大きく超える
    assert worked > 0, "1件も割当がない（上界テストが空振りしている）"
    assert worked <= 28, f"留学生に週 {worked} 時間割り当てられた（28h規制違反）"


def test_general_staff_is_not_capped_at_28h() -> None:
    """留学生でなければ28時間キャップは適用されない（キャップの常時適用を排除）。"""
    staff = make_staff("p1", is_foreign_student=False, max_weekly_hours=40.0)
    res = solve_shift_schedule(
        hourly_request([staff], days=7, demand={d: list(range(10, 18)) for d in range(7)})
    )

    assert res.status != "INFEASIBLE"
    worked = gross_hours(res, "p1", range(7))
    assert worked > 28, f"一般スタッフが {worked} 時間に抑えられている（28hキャップの誤適用）"
    assert worked <= 40


# --------------------------------------------------------------------------
# 固定割当の「時間帯」まで固定されること
#
# 既存テストは shifts を持たないリクエストに shift_id="any" を渡していたため
# `shift_span_by_id.get(fa.shift_id)` が常に None になり、
# 時間帯を固定するコードパスに一度も到達していなかった。
# --------------------------------------------------------------------------


def test_fixed_assignment_pins_the_shift_time_span() -> None:
    """固定割当が shifts 上の枠を指す場合、その時間帯まで固定される。

    変異: `model.Add(work[e_idx, fa.day_offset, h % 24] == 1)` を消すと赤くなる。
    """
    evening = ShiftSchema(
        id="evening", name="遅番", start="17:00", end="21:00", hours=4.0, break_minutes=0
    )
    staff = [make_staff("s1"), make_staff("s2")]
    request = ShiftOptimizeRequest(
        period=PeriodSchema(start_date="2026-09-01", days=1),
        staff_members=staff,
        shifts=[evening],
        # 需要は午前中だけ。固定しなければ誰も夕方には入らない
        hourly_requirements=[
            HourlyRequirementSchema(day_offset=0, hour=h, min_staff=1) for h in range(10, 14)
        ],
        fixed_assignments=[FixedAssignmentSchema(staff_id="s1", day_offset=0, shift_id="evening")],
    )

    res = solve_shift_schedule(request)

    assert res.status != "INFEASIBLE"
    s1_hours = worked_hours(res, "s1")
    assert s1_hours, "固定したスタッフに割当がない"
    # 17,18,19,20 時が必ず含まれる（21:00 終了なので 20 時台まで）
    assert set(range(17, 21)).issubset(set(s1_hours)), (
        f"固定枠の時間帯が固定されていない: {s1_hours}"
    )


def test_without_fixed_assignment_nobody_works_the_unneeded_span() -> None:
    """固定しなければ需要のない夕方には誰も入らない（固定制約の常時発火を排除）。"""
    evening = ShiftSchema(
        id="evening", name="遅番", start="17:00", end="21:00", hours=4.0, break_minutes=0
    )
    request = ShiftOptimizeRequest(
        period=PeriodSchema(start_date="2026-09-01", days=1),
        staff_members=[make_staff("s1"), make_staff("s2")],
        shifts=[evening],
        hourly_requirements=[
            HourlyRequirementSchema(day_offset=0, hour=h, min_staff=1) for h in range(10, 14)
        ],
    )

    res = solve_shift_schedule(request)

    evening_workers = {
        sid
        for slot in res.hourly_schedule
        if 17 <= slot.hour < 21
        for sid in slot.assigned_staff_ids
    }
    assert evening_workers == set(), f"需要のない夕方に出勤している: {evening_workers}"


# --------------------------------------------------------------------------
# 1日の最大拘束時間（年少者は8時間 / 労基法第60条）
# --------------------------------------------------------------------------


def test_minor_daily_gross_hours_capped_at_8() -> None:
    """年少者は1日8時間を超えて拘束されない。

    変異: `model.Add(daily_total <= max_daily_h * day_worked[e, d])` の
    `max_daily_h`（年少者は8）を 24 にすると赤くなる。
    """
    # 10:00〜21:00 の11時間に需要。深夜(22時以降)は跨がないので
    # 深夜業禁止ではなく「1日8時間上限」だけが効く条件。
    demand = {0: list(range(10, 21))}
    minor = make_staff("minor", is_minor=True, max_weekly_hours=40.0)
    res = solve_shift_schedule(
        hourly_request([minor], demand=demand, min_shift_hours=3, max_shift_hours=10)
    )

    assert res.status != "INFEASIBLE"
    hours = worked_hours(res, "minor")
    assert hours, "年少者に1件も割当がない（上界テストが空振りしている）"
    assert len(hours) <= 8, f"年少者が1日 {len(hours)} 時間拘束されている（労基法第60条違反）"


def test_adult_may_work_the_configured_max_shift_hours() -> None:
    """成人は max_shift_hours まで働ける（8時間キャップの誤適用を排除する対照群）。"""
    demand = {0: list(range(10, 21))}
    adult = make_staff("adult", is_minor=False, max_weekly_hours=40.0)
    res = solve_shift_schedule(
        hourly_request([adult], demand=demand, min_shift_hours=3, max_shift_hours=10)
    )

    assert res.status != "INFEASIBLE"
    hours = worked_hours(res, "adult")
    assert len(hours) == 10, f"成人が上限10時間まで使えていない: {len(hours)} 時間"


# --------------------------------------------------------------------------
# 飛び石勤務（1日に複数の勤務区間）の禁止
#
# `assigned_shifts` は min/max 時刻しか持たないため、
# 途中に穴が空いていても「09:00〜20:00」と表示され気付けない。
# 必ず1時間スロットの実体から連続性を検証する。
# --------------------------------------------------------------------------


def test_no_split_shift_within_a_day() -> None:
    """1日の勤務は1本の連続区間になる（飛び石勤務の禁止）。

    昼と夜にだけ需要を置くと、飛び石が許されるなら
    「昼2時間＋夜2時間」の方が安いため必ずそちらが選ばれる。
    変異: `model.Add(start_h[e, d, h] >= work[e, d, h] - prev_w)` を消すと赤くなる。
    """
    demand = {0: [10, 11, 18, 19]}
    res = solve_shift_schedule(
        hourly_request(
            [make_staff("s1", max_weekly_hours=40.0)],
            demand=demand,
            min_shift_hours=1,
            max_shift_hours=16,
        )
    )

    assert res.status != "INFEASIBLE"
    hours = worked_hours(res, "s1")
    assert hours, "1件も割当がない（テストが空振りしている）"
    # 連続区間であること = 最大値-最小値+1 が実勤務時間数と一致する
    assert hours == list(range(hours[0], hours[-1] + 1)), f"勤務が飛び石になっている: {hours}"
    # 対照群: 飛び石が許されていれば 4 時間で済むところ、
    # 連続制約により昼〜夜を通しで埋めるので必ず 4 時間より長くなる
    assert len(hours) > 4, f"飛び石勤務が成立している: {hours}"


# --------------------------------------------------------------------------
# 労基法第34条に基づく休憩の控除
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "span_hours,expected_break_min",
    [(5, 0), (7, 45), (9, 60)],
)
def test_break_deduction_follows_labor_standards_act_34(
    span_hours: int, expected_break_min: int
) -> None:
    """拘束6時間超で45分、8時間超で60分の休憩が控除される。

    変異: `if gross_hours > 8.0: break_min = 60 / elif gross_hours > 6.0: break_min = 45`
    を無効化すると赤くなる。
    """
    demand = {0: list(range(10, 10 + span_hours))}
    staff = make_staff("s1", max_weekly_hours=40.0, hourly_wage=1000)
    res = solve_shift_schedule(
        hourly_request([staff], demand=demand, min_shift_hours=1, max_shift_hours=16)
    )

    assert res.status == "OPTIMAL"
    hours = worked_hours(res, "s1")
    assert len(hours) == span_hours, f"需要 {span_hours} 時間が埋まっていない: {hours}"

    shift = next(s for s in res.assigned_shifts if s.staff_id == "s1")
    assert shift.break_minutes == expected_break_min
    # 実労働時間 = 拘束 - 休憩。単位の取り違え(net/gross)をここで固定する
    assert shift.hours == span_hours - expected_break_min / 60.0
    assert res.summary.total_break_hours == expected_break_min / 60.0
    # 人件費は net で計算される（gross で計算すると休憩分を払ってしまう）
    assert shift.labor_cost == round(1000 * (span_hours - expected_break_min / 60.0))


# --------------------------------------------------------------------------
# 深夜割増（22:00〜05:00 / 25%）
# --------------------------------------------------------------------------


def test_deep_night_premium_is_charged_for_hours_after_22() -> None:
    """22時以降の勤務には時給25%の深夜割増が計上される。

    変異: `night_extra = int(math.floor(wage * 0.25 * night_hours + 0.5))` を
    `night_extra = 0` にすると赤くなる。
    """
    # 20:00〜24:00 の4時間 (うち 22,23 時の2時間が深夜帯)
    demand = {0: [20, 21, 22, 23]}
    staff = make_staff("adult", hourly_wage=1000, max_weekly_hours=40.0)
    res = solve_shift_schedule(
        hourly_request([staff], demand=demand, min_shift_hours=1, max_shift_hours=16)
    )

    assert res.status == "OPTIMAL"
    assert worked_hours(res, "adult") == [20, 21, 22, 23]
    shift = next(s for s in res.assigned_shifts if s.staff_id == "adult")
    assert shift.is_late_night is True
    # 深夜2時間 × 1000円 × 0.25 = 500円
    assert res.summary.deep_night_extra_cost == 500
    # 拘束4時間 -> 休憩0分。基本 4000円 + 割増 500円
    assert shift.labor_cost == 4500


def test_no_deep_night_premium_for_day_shift() -> None:
    """22時前に終わる勤務には深夜割増が付かない（割増の常時計上を排除）。"""
    demand = {0: [17, 18, 19, 20]}
    staff = make_staff("adult", hourly_wage=1000, max_weekly_hours=40.0)
    res = solve_shift_schedule(
        hourly_request([staff], demand=demand, min_shift_hours=1, max_shift_hours=16)
    )

    assert res.status == "OPTIMAL"
    shift = next(s for s in res.assigned_shifts if s.staff_id == "adult")
    assert shift.is_late_night is False
    assert res.summary.deep_night_extra_cost == 0
    assert shift.labor_cost == 4000


# --------------------------------------------------------------------------
# スタッフの時間帯希望（Hard制約）
# --------------------------------------------------------------------------


def test_assignment_never_leaves_the_available_window() -> None:
    """指定した勤務可能時間帯の外には絶対に割り当てられない。

    変異: `if h < avail.available_from or h >= avail.available_to: work == 0`
    を無効化すると赤くなる。
    """
    staff = make_staff("s1", max_weekly_hours=40.0)
    res = solve_shift_schedule(
        hourly_request(
            [staff],
            demand={0: list(range(10, 20))},
            min_shift_hours=3,
            max_shift_hours=12,
            hourly_availabilities=[
                StaffHourlyAvailabilitySchema(
                    staff_id="s1",
                    day_offset=0,
                    available_from=14,
                    available_to=18,
                    is_available=True,
                )
            ],
        )
    )

    assert res.status != "INFEASIBLE"
    hours = worked_hours(res, "s1")
    assert hours, "1件も割当がない（ガード付きテストの空振りを防ぐ）"
    assert min(hours) >= 14 and max(hours) < 18, f"希望時間帯外に割り当てられた: {hours}"
    # 対照群: 枠外の需要は不足として可視化される
    unfilled_hours = {u.day_offset: u for u in res.summary.unfilled_requirements}
    assert res.summary.unfilled_requirements, "枠外の需要が不足として現れていない"
    assert unfilled_hours


def test_without_the_window_the_same_staff_covers_the_whole_demand() -> None:
    """時間帯希望を外せば同じスタッフが全需要を埋める（枠制約の常時発火を排除）。"""
    staff = make_staff("s1", max_weekly_hours=40.0)
    res = solve_shift_schedule(
        hourly_request(
            [staff], demand={0: list(range(10, 20))}, min_shift_hours=3, max_shift_hours=12
        )
    )

    assert res.status == "OPTIMAL"
    assert worked_hours(res, "s1") == list(range(10, 20))
    assert res.summary.unfilled_requirements == []


def test_full_day_unavailable_blocks_all_assignment() -> None:
    """終日不可 (is_available=False) の日は一切割り当てられない。

    変異: `model.Add(day_worked[e, d] == 0)` を消すと赤くなる。
    """
    staff = make_staff("s1", max_weekly_hours=40.0)
    res = solve_shift_schedule(
        hourly_request(
            [staff],
            demand={0: list(range(10, 14))},
            hourly_availabilities=[
                StaffHourlyAvailabilitySchema(staff_id="s1", day_offset=0, is_available=False)
            ],
        )
    )

    assert worked_hours(res, "s1") == [], "終日不可の日に割り当てられている"
    # 対照群: 誰も入れないので需要は不足として可視化される
    assert res.status == "FEASIBLE_WITH_SHORTAGE"
    assert len(res.summary.unfilled_requirements) == 4


# --------------------------------------------------------------------------
# 最低連続勤務時間 (min_shift_hours)
# --------------------------------------------------------------------------


def test_min_shift_hours_is_enforced() -> None:
    """1時間だけの需要でも、出勤するなら最低勤務時間を満たす。

    変異: `model.Add(daily_total >= min_shift_hours * day_worked)` を消すと赤くなる。
    """
    staff = make_staff("s1", max_weekly_hours=40.0)
    res = solve_shift_schedule(
        hourly_request([staff], demand={0: [12]}, min_shift_hours=4, max_shift_hours=8)
    )

    assert res.status == "OPTIMAL"
    hours = worked_hours(res, "s1")
    assert 12 in hours, "需要のある時刻に入っていない"
    assert len(hours) >= 4, f"最低勤務時間4hを下回っている: {hours}"


def test_min_shift_hours_one_allows_a_single_hour() -> None:
    """min_shift_hours=1 なら1時間だけの出勤になる（最低時間の決め打ちを排除）。"""
    staff = make_staff("s1", max_weekly_hours=40.0)
    res = solve_shift_schedule(
        hourly_request([staff], demand={0: [12]}, min_shift_hours=1, max_shift_hours=8)
    )

    assert res.status == "OPTIMAL"
    assert worked_hours(res, "s1") == [12]


# --------------------------------------------------------------------------
# NGペア同時勤務禁止
# --------------------------------------------------------------------------


def test_ng_pair_never_shares_an_hour() -> None:
    """NGペアの2名が同じ時間帯に同時勤務しない。

    変異: `model.Add(work[e1, d, h] + work[e2, d, h] <= 1)` を消すと赤くなる。
    """
    members = [
        make_staff("a", ng_staff_ids=["b"], max_weekly_hours=40.0),
        make_staff("b", max_weekly_hours=40.0),
        make_staff("c", max_weekly_hours=40.0),
    ]
    res = solve_shift_schedule(
        hourly_request(members, demand={0: list(range(11, 15))}, min_staff=2, min_shift_hours=3)
    )

    assert res.status == "OPTIMAL", "需要2名が満たせていない（対照群が崩れている）"
    for slot in res.hourly_schedule:
        if 11 <= slot.hour < 15:
            ids = set(slot.assigned_staff_ids)
            # 対照群: 各時間に必ず2名いること（割当0で通るのを防ぐ）
            assert len(ids) >= 2, f"{slot.hour}時の配置が2名未満: {ids}"
            assert not {"a", "b"}.issubset(ids), f"{slot.hour}時にNGペアが同時勤務: {ids}"


def test_without_ng_flag_the_same_pair_may_work_together() -> None:
    """NG指定が無ければ同じ2名が同時勤務しうる（NG制約の常時発火を排除）。"""
    members = [
        make_staff("a", hourly_wage=1000, max_weekly_hours=40.0),
        make_staff("b", hourly_wage=1000, max_weekly_hours=40.0),
        make_staff("c", hourly_wage=9000, max_weekly_hours=40.0),  # 高すぎて選ばれない
    ]
    res = solve_shift_schedule(
        hourly_request(members, demand={0: list(range(11, 15))}, min_staff=2, min_shift_hours=3)
    )

    assert res.status == "OPTIMAL"
    pairs = [set(slot.assigned_staff_ids) for slot in res.hourly_schedule if 11 <= slot.hour < 15]
    assert any({"a", "b"}.issubset(p) for p in pairs), (
        f"NG指定が無いのに a と b が同時勤務していない: {pairs}"
    )


# --------------------------------------------------------------------------
# 連続勤務日数上限
# --------------------------------------------------------------------------


def test_consecutive_days_limit_is_enforced_in_hourly_solver() -> None:
    """連続勤務日数の上限を超えて出勤させない。

    変異: `add_consecutive_days_constraint(...)` を消す、または
    helpers の `window_size = max_consecutive + 1` を +2 にすると赤くなる。
    """
    staff = make_staff("s1", max_consecutive_days=3, max_weekly_hours=168.0)
    res = solve_shift_schedule(
        hourly_request([staff], days=7, demand={d: list(range(10, 14)) for d in range(7)})
    )

    assert res.status != "INFEASIBLE"
    days = worked_days(res, "s1")
    # 対照群: 需要は7日すべてにあるので、上限いっぱいまでは働くはず
    # 上界(streak<=3)だけでは「制約を過剰に厳しくした実装」を検出できない。
    # 窓幅を1広げるだけの変異は streak を増やさず**出勤日数を減らす**方向に効くため、
    # 上限3日で理論上取りうる最大日数 6日 (3連勤→1休→3連勤) を下界として固定する。
    assert len(days) == 6, (
        f"上限3日で取りうる最大の6日が割り当てられていない: {days}"
        "（6日未満なら制約が過剰、空なら上界テストの空振り）"
    )
    assert longest_streak(days) <= 3, f"連続勤務が上限3日を超えている: {days}"


def test_higher_consecutive_limit_allows_a_longer_streak() -> None:
    """上限を上げれば実際に連続勤務が伸びる（上限値の決め打ちを排除）。"""
    staff = make_staff("s1", max_consecutive_days=7, max_weekly_hours=168.0)
    res = solve_shift_schedule(
        hourly_request([staff], days=7, demand={d: list(range(10, 14)) for d in range(7)})
    )

    assert res.status == "OPTIMAL"
    assert longest_streak(worked_days(res, "s1")) == 7


# --------------------------------------------------------------------------
# 勤務間インターバル
# --------------------------------------------------------------------------


def test_min_interval_hours_between_consecutive_days() -> None:
    """前日の退勤から翌日の出勤まで min_interval_hours 未満にならない。

    変異: `model.Add(end_h[e, d, h1] + start_h[e, d + 1, h2] <= 1)` を消すと赤くなる。
    """
    # day0 は 14:00〜21:00、day1 は 06:00〜13:00 に需要。
    # 通しで入ると 21:00 -> 翌 06:00 = 9時間インターバル (< 11)。
    staff = make_staff("s1", max_weekly_hours=168.0)
    res = solve_shift_schedule(
        hourly_request(
            [staff],
            days=2,
            demand={0: list(range(14, 21)), 1: list(range(6, 13))},
            min_shift_hours=3,
            max_shift_hours=12,
            min_interval_hours=11.0,
        )
    )

    assert res.status != "INFEASIBLE"
    d0 = worked_hours(res, "s1", 0)
    d1 = worked_hours(res, "s1", 1)
    assert d0 or d1, "両日とも割当が無い（空振り）"
    if d0 and d1:
        interval = (24 - (max(d0) + 1)) + min(d1)
        assert interval >= 11, (
            f"勤務間インターバルが {interval} 時間しかない "
            f"(day0={d0} 退勤{max(d0) + 1}時 / day1={d1} 出勤{min(d1)}時)"
        )
    # 対照群: インターバル制約により両日の需要を1人で埋めきれず不足が出る
    assert res.summary.unfilled_requirements, (
        "インターバル制約が効いていれば1人では埋めきれず不足が出るはず"
    )


def test_zero_interval_lets_the_same_staff_work_both_days_fully() -> None:
    """インターバル 0 なら同一スタッフが両日フル勤務できる（制約の常時発火を排除）。"""
    staff = make_staff("s1", max_weekly_hours=168.0)
    res = solve_shift_schedule(
        hourly_request(
            [staff],
            days=2,
            demand={0: list(range(14, 21)), 1: list(range(6, 13))},
            min_shift_hours=3,
            max_shift_hours=12,
            min_interval_hours=0.0,
        )
    )

    assert res.status == "OPTIMAL"
    assert worked_hours(res, "s1", 0) == list(range(14, 21))
    assert worked_hours(res, "s1", 1) == list(range(6, 13))
    assert res.summary.unfilled_requirements == []


# --------------------------------------------------------------------------
# 人員不足の検出
# --------------------------------------------------------------------------


def test_shortage_is_counted_and_surfaced_per_hour() -> None:
    """必要人数に満たない時間帯は、不足数まで含めて可視化される。

    変異: `shortage_c = max(0, req_c - len(assigned_e_ids))` を `0` にする、
    あるいは必要人数の充足制約を消すと赤くなる。
    """
    # 3名必要な時間帯に1名しかいない
    res = solve_shift_schedule(
        hourly_request(
            [make_staff("s1", max_weekly_hours=40.0)],
            demand={0: list(range(11, 15))},
            min_staff=3,
            min_shift_hours=3,
        )
    )

    assert res.status == "FEASIBLE_WITH_SHORTAGE"
    assert len(res.summary.unfilled_requirements) == 4
    for u in res.summary.unfilled_requirements:
        assert u.required_count == 3
        assert u.assigned_count == 1
        assert u.shortage == 2
    for slot in res.hourly_schedule:
        if 11 <= slot.hour < 15:
            assert slot.required_count == 3
            assert slot.shortage == 2


def test_no_shortage_reported_when_demand_is_met() -> None:
    """需要が満たされていれば不足は1件も出ない（不足の常時計上を排除）。"""
    members = [make_staff(f"s{i}", max_weekly_hours=40.0) for i in range(1, 4)]
    res = solve_shift_schedule(
        hourly_request(members, demand={0: list(range(11, 15))}, min_staff=3, min_shift_hours=3)
    )

    assert res.status == "OPTIMAL"
    assert res.summary.unfilled_requirements == []
    assert all(slot.shortage == 0 for slot in res.hourly_schedule)
    for slot in res.hourly_schedule:
        if 11 <= slot.hour < 15:
            assert len(slot.assigned_staff_ids) == 3


# --------------------------------------------------------------------------
# 週上限が「期間 < 7日」でも消えないこと
#
# helpers の `range(max(1, num_days - window_size + 1))` から max(1, ...) を
# 外すと range(負数) が空になり、7日未満の期間で週上限が丸ごと消える。
# 既存テストは days=7/14/31 しか使っておらず、この穴を踏めなかった。
# --------------------------------------------------------------------------


@pytest.mark.parametrize("days", [1, 3, 5, 6])
def test_weekly_cap_still_applies_to_periods_shorter_than_a_week(days: int) -> None:
    """期間が7日未満でも週労働時間の上限は適用される。

    変異: helpers の `range(max(1, num_days - window_size + 1))` を
    `range(num_days - window_size + 1)` にすると赤くなる。
    """
    cap = 10
    staff = make_staff("p1", max_weekly_hours=float(cap), max_consecutive_days=7)
    res = solve_shift_schedule(
        hourly_request(
            [staff],
            days=days,
            demand={d: list(range(10, 18)) for d in range(days)},
            min_shift_hours=1,
            max_shift_hours=12,
        )
    )

    assert res.status != "INFEASIBLE"
    worked = gross_hours(res, "p1", range(days))
    # 対照群: 需要は 1日8時間ずつあるので上限まで使い切ろうとするはず
    assert worked > 0, "1件も割当がない（上界テストが空振りしている）"
    assert worked <= cap, f"期間{days}日で週上限{cap}hを超過して {worked}h 割り当てられた"


def test_short_period_cap_tracks_the_configured_value() -> None:
    """7日未満の期間でも上限値を上げれば割当が増える（定数返しの排除）。"""
    demand = {d: list(range(10, 18)) for d in range(3)}
    low = solve_shift_schedule(
        hourly_request(
            [make_staff("p1", max_weekly_hours=10.0, max_consecutive_days=7)],
            days=3,
            demand=demand,
            min_shift_hours=1,
            max_shift_hours=12,
        )
    )
    high = solve_shift_schedule(
        hourly_request(
            [make_staff("p1", max_weekly_hours=24.0, max_consecutive_days=7)],
            days=3,
            demand=demand,
            min_shift_hours=1,
            max_shift_hours=12,
        )
    )

    assert gross_hours(low, "p1", range(3)) <= 10
    assert gross_hours(high, "p1", range(3)) == 24, "上限を上げても割当が増えていない"


# --------------------------------------------------------------------------
# 最適性の主張 (is_proven_optimal)
#
# レスポンスの status は不足の有無だけで決まるため、制限時間切れで
# 打ち切った解も "OPTIMAL" と表示される。実際に最適性を証明できたかは
# is_proven_optimal でしか区別できない。
# --------------------------------------------------------------------------


def test_is_proven_optimal_is_true_for_a_trivial_problem() -> None:
    """小さな問題では最適性が証明される。"""
    res = solve_shift_schedule(
        hourly_request([make_staff("s1", max_weekly_hours=40.0)], demand={0: list(range(11, 15))})
    )

    assert res.status == "OPTIMAL"
    assert res.summary.is_proven_optimal is True


def test_is_proven_optimal_is_false_when_the_solver_cannot_prove_it(monkeypatch) -> None:
    """最適性を証明できなかった解を「最適解確定」と名乗らない。

    レスポンスの `status` は不足の有無だけで決まるため、制限時間で打ち切った解も
    "OPTIMAL" と表示される。実際に証明できたかは `is_proven_optimal` でしか
    区別できず、これを取り違えると同一入力で毎回違う解が全て「最適」と表示される。

    **なぜ実時間ではなく seam を使うか**: この分岐は「4秒の制限時間内に
    証明が終わらない規模」でしか自然には踏めず、規模を上げると解自体が
    見つからず INFEASIBLE になる（実測で同一入力が OPTIMAL /
    FEASIBLE_WITH_SHORTAGE / INFEASIBLE の3通りに揺れた）。
    実時間に依存させるとテストがフレーキーになるため、
    **解の中身は本物のまま**ステータスだけを FEASIBLE に差し替えて
    `is_proven_optimal = (solve_status == OPTIMAL)` の対応関係を固定する。

    変異: `is_proven_optimal=(solve_status == cp_model.OPTIMAL)` を
    `is_proven_optimal=True` にすると赤くなる。
    """
    from ortools.sat.python import cp_model

    real_solve = cp_model.CpSolver.Solve

    def solve_without_proving_optimality(self, model, *args, **kwargs):
        status = real_solve(self, model, *args, **kwargs)
        # 解は本物のまま「最適性は未証明」だけを模す
        return cp_model.FEASIBLE if status == cp_model.OPTIMAL else status

    monkeypatch.setattr(cp_model.CpSolver, "Solve", solve_without_proving_optimality)

    res = solve_shift_schedule(
        hourly_request([make_staff("s1", max_weekly_hours=40.0)], demand={0: list(range(11, 15))})
    )

    # 対照群: 解は実在し、不足も無い（＝status は OPTIMAL を名乗る）
    assert res.status == "OPTIMAL"
    assert res.summary.unfilled_requirements == []
    assert worked_hours(res, "s1") == [11, 12, 13, 14]
    # それでも「証明済み」ではない
    assert res.summary.is_proven_optimal is False, (
        "最適性を証明できていない解を「最適解確定」と報告している"
    )
