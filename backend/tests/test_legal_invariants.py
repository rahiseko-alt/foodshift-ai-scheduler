"""両ソルバー横断の法令不変条件テスト。

本プロジェクトには2つのソルバー経路がある:

* シフト枠ベース  : `constraints.py` / `solver.py`
* 1時間スロット   : `hourly_solver.py`

`solver.py` は `hourly_requirements` の有無で分岐するため、
管理画面からの実リクエストは常に後者へ到達する。
一方テストの大半は前者を検証しており、
「テストされている側のソルバーが本番で動いていない」状態を生んでいた。

このモジュールは同一シナリオを **両方のエンコーディングで** 構築し、
`solve_shift_schedule` 経由で実行して不変条件を検証する。
片方のソルバーにのみ制約が実装されている状態を構造的に検出することが目的。
"""

import pytest

from app.engine.solver import solve_shift_schedule
from app.schemas.scheduler import (
    HourlyRequirementSchema,
    PeriodSchema,
    ShiftOptimizeRequest,
    ShiftRequirementSchema,
    ShiftSchema,
    StaffMemberSchema,
)

SOLVER_MODES = ["shift", "hourly"]

# 完全に深夜帯(22:00〜05:00)の内側に収まる枠。
# 21:00 開始にすると 21:00〜22:00 は年少者でも適法なため、
# 「枠全体が違法」と言い切れる 22:00〜24:00 を対象にする
# （シフト枠ベースは枠単位、1時間スロットは時間単位で判定するため、
#   両者の粒度差を吸収して同一の期待値で検証できる）。
NIGHT_START_HOUR = 22
NIGHT_END_HOUR = 24


def build_request(
    staff: list[StaffMemberSchema],
    mode: str,
    *,
    days: int = 1,
    start_hour: int = NIGHT_START_HOUR,
    end_hour: int = NIGHT_END_HOUR,
    min_staff: int = 1,
    start_date: str = "2026-09-01",
) -> ShiftOptimizeRequest:
    """同一シナリオを shift / hourly いずれのエンコーディングでも構築する。"""
    period = PeriodSchema(start_date=start_date, days=days)
    if mode == "hourly":
        return ShiftOptimizeRequest(
            period=period,
            staff_members=staff,
            hourly_requirements=[
                HourlyRequirementSchema(day_offset=d, hour=h, min_staff=min_staff)
                for d in range(days)
                for h in range(start_hour, end_hour)
            ],
        )
    shift = ShiftSchema(
        id="slot",
        name="対象枠",
        start=f"{start_hour:02d}:00",
        end=f"{end_hour:02d}:00",
        hours=float(end_hour - start_hour),
        break_minutes=0,
    )
    return ShiftOptimizeRequest(
        period=period,
        staff_members=staff,
        shifts=[shift],
        requirements=[
            ShiftRequirementSchema(day_offset=d, shift_id="slot", min_staff=min_staff)
            for d in range(days)
        ],
    )


def _hour_range(start_time: str, end_time: str) -> set[int]:
    """'HH:MM'-'HH:MM' が占める時刻の集合を返す（日跨ぎは24で正規化）。"""
    start_h = int(start_time.split(":")[0])
    end_min = int(end_time.split(":")[0]) * 60 + int(end_time.split(":")[1])
    start_min = start_h * 60 + int(start_time.split(":")[1])
    if end_min <= start_min:
        end_min += 24 * 60
    end_h = -(-end_min // 60)  # 天井除算
    return {h % 24 for h in range(start_h, end_h)}


def night_assigned_staff_ids(response) -> set[str]:
    """深夜帯(22:00〜05:00)に実際に勤務が割り当てられたスタッフIDを返す。

    「そのスタッフが登場するか」ではなく「深夜時間に入っているか」で判定する。
    CP-SAT は `relative_gap_limit=0.05` の範囲で最適解を打ち切るため、
    人員不足ペナルティ(10000/時)に対して微小なコストの無意味な割当が
    解に残ることがある。単なる登場有無で判定すると、
    深夜業とは無関係な割当を拾ってテストがフレーキーになる。
    """
    ids: set[str] = set()
    for slot in response.hourly_schedule:
        if slot.hour >= 22 or slot.hour < 5:
            ids.update(slot.assigned_staff_ids)
    for shift in response.assigned_shifts:
        if any(h >= 22 or h < 5 for h in _hour_range(shift.start_time, shift.end_time)):
            ids.add(shift.staff_id)
    return ids


def all_assigned_staff_ids(response) -> set[str]:
    """時間帯を問わず、何らかの割当があるスタッフIDを返す（対照群の判定用）。"""
    ids: set[str] = set()
    for slot in response.hourly_schedule:
        ids.update(slot.assigned_staff_ids)
    for shift in response.assigned_shifts:
        ids.add(shift.staff_id)
    for slot in response.schedule:
        for member in slot.assigned_staff:
            ids.add(member.id)
    return ids


def make_staff(**overrides) -> StaffMemberSchema:
    base = {
        "id": "target",
        "name": "対象スタッフ",
        "roles": ["hall"],
        "hourly_wage": 1000,
        "max_consecutive_days": 7,
    }
    base.update(overrides)
    return StaffMemberSchema(**base)


# --------------------------------------------------------------------------
# Invariant 1: 年少者・母性保護対象の深夜業禁止（労基法 第60条 / 第64条の3）
# --------------------------------------------------------------------------


@pytest.mark.parametrize("mode", SOLVER_MODES)
def test_minor_flag_never_assigned_to_night_slot(mode: str) -> None:
    """is_minor=True のスタッフは深夜帯に一切割り当てられない。"""
    res = solve_shift_schedule(build_request([make_staff(is_minor=True)], mode))
    assert "target" not in night_assigned_staff_ids(res)


@pytest.mark.parametrize("mode", SOLVER_MODES)
def test_maternity_protection_never_assigned_to_night_slot(mode: str) -> None:
    """母性保護対象のスタッフは深夜帯に一切割り当てられない。"""
    res = solve_shift_schedule(build_request([make_staff(is_maternity_protection=True)], mode))
    assert "target" not in night_assigned_staff_ids(res)


@pytest.mark.parametrize("mode", SOLVER_MODES)
def test_birth_date_derived_minor_never_assigned_to_night_slot(mode: str) -> None:
    """is_minor=False でも生年月日から年少者と判定されれば深夜帯に入らない。"""
    res = solve_shift_schedule(
        build_request([make_staff(is_minor=False, birth_date="2010-01-15")], mode)
    )
    assert "target" not in night_assigned_staff_ids(res)


@pytest.mark.parametrize("mode", SOLVER_MODES)
@pytest.mark.parametrize("bad_birth_date", ["2010-13-01", "2010-02-30", "2010-00-15"])
def test_uninterpretable_birth_date_fails_closed(mode: str, bad_birth_date: str) -> None:
    """暦として存在しない生年月日は「安全側＝年少者」として扱われる (fail-closed)。

    正規表現パターン `^\\d{4}-\\d{2}-\\d{2}$` は暦上不正な日付を通してしまうため、
    エンジン層でも多層防御する。ここは スキーマ検証を意図的にバイパスして
    エンジン単体の fail-closed 挙動を検証する。
    """
    request = build_request([make_staff(is_minor=False)], mode)
    # スキーマ検証を経由せず、エンジンに直接不正値を渡す
    request.staff_members[0].birth_date = bad_birth_date

    res = solve_shift_schedule(request)

    assert "target" not in night_assigned_staff_ids(res)
    assert res.summary.compliance_warnings, "安全側フォールバック時は警告を必ず返すこと"
    assert bad_birth_date in res.summary.compliance_warnings[0]
    assert "target" in res.summary.compliance_warnings[0], "警告はスタッフIDを名指しすること"


# --------------------------------------------------------------------------
# フロントエンド互換のフィールド別名。
#
# 管理画面 (`admin/staff/page.tsx:238-239`) は `is_student_visa` /
# `is_pregnant_or_nursing` という名前で送信していたが、
# バックエンドは `is_foreign_student` / `is_maternity_protection` を期待しており、
# Pydantic の既定 extra="ignore" によって黙って捨てられていた。
# その結果、母性保護の深夜業禁止と留学生28時間制限が
# **本番経路で一度も発火していなかった**。
# --------------------------------------------------------------------------


@pytest.mark.parametrize("mode", SOLVER_MODES)
def test_legacy_pregnancy_field_name_still_blocks_night_work(mode: str) -> None:
    """旧名 `is_pregnant_or_nursing` でも母性保護の深夜業禁止が発火する。"""
    staff = StaffMemberSchema(
        id="target",
        name="対象スタッフ",
        roles=["hall"],
        hourly_wage=1000,
        max_consecutive_days=7,
        is_pregnant_or_nursing=True,
    )
    assert staff.is_maternity_protection is True, "旧名が正式フィールドに写像されること"

    res = solve_shift_schedule(build_request([staff], mode))
    assert "target" not in night_assigned_staff_ids(res)


def test_legacy_student_visa_field_name_is_mapped() -> None:
    """旧名 `is_student_visa` が留学生フラグに写像される。"""
    staff = StaffMemberSchema(
        id="s",
        name="留学生",
        roles=["hall"],
        hourly_wage=1000,
        max_weekly_hours=28.0,
        is_student_visa=True,
    )
    assert staff.is_foreign_student is True


def test_canonical_field_names_still_accepted() -> None:
    """正式名も従来どおり受理される（別名対応で壊していないこと）。"""
    staff = StaffMemberSchema(
        id="s",
        name="スタッフ",
        roles=["hall"],
        hourly_wage=1000,
        max_weekly_hours=28.0,
        is_foreign_student=True,
        is_maternity_protection=True,
    )
    assert staff.is_foreign_student is True
    assert staff.is_maternity_protection is True


# --------------------------------------------------------------------------
# 変異テスト (Counterfactual): 入力変更に出力が連動することを検証し、
# 「常に割当0を返す」等のインチキ実装を排除する (EXECUTION_PLAN §9)
# --------------------------------------------------------------------------


@pytest.mark.parametrize("mode", SOLVER_MODES)
def test_adult_is_assignable_to_night_slot(mode: str) -> None:
    """成人は深夜帯に割当可能。年少者テストが「常に0」で通るのを防ぐ対照群。"""
    res = solve_shift_schedule(
        build_request([make_staff(is_minor=False, birth_date="1990-05-05")], mode)
    )
    assert "target" in night_assigned_staff_ids(res)


@pytest.mark.parametrize("mode", SOLVER_MODES)
def test_valid_birth_date_produces_no_compliance_warning(mode: str) -> None:
    """正常な生年月日では警告が出ない（警告の常時出力を排除）。"""
    res = solve_shift_schedule(
        build_request([make_staff(is_minor=False, birth_date="1990-05-05")], mode)
    )
    assert res.summary.compliance_warnings == []
