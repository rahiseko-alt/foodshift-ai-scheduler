from app.engine.time_utils import (
    build_hourly_requirements_from_shifts,
    calculate_interval_hours,
    calculate_interval_minutes,
    calculate_late_night_hours,
    is_shift_late_night,
    parse_time_to_minutes,
)


def test_parse_time_to_minutes():
    assert parse_time_to_minutes("00:00") == 0
    assert parse_time_to_minutes("09:15") == 555
    assert parse_time_to_minutes("9:15") == 555
    assert parse_time_to_minutes("10:15") == 615
    assert parse_time_to_minutes("14:45") == 885
    assert parse_time_to_minutes("22:15") == 1335
    assert parse_time_to_minutes("24:30") == 1470


def test_is_shift_late_night():
    # 22:00ジャスト終了は深夜外
    assert is_shift_late_night("17:00", "22:00") is False
    assert is_shift_late_night("17:45", "22:00") is False

    # 22:15終了は深夜内 (TV-2)
    assert is_shift_late_night("17:45", "22:15") is True

    # 深夜開始 (22:15〜02:45) (TV-3)
    assert is_shift_late_night("22:15", "02:45") is True

    # 早朝4時開始
    assert is_shift_late_night("04:30", "09:00") is True


def test_calculate_late_night_hours():
    # TV-1: 10:15〜14:45 -> 深夜 0.0h
    assert calculate_late_night_hours("10:15", "14:45") == 0.0

    # TV-2: 17:45〜22:15 -> 深夜 0.25h (22:00〜22:15)
    assert calculate_late_night_hours("17:45", "22:15") == 0.25

    # TV-3: 22:15〜02:45 -> 深夜 4.50h (22:15〜26:45 = 270分 = 4.5h)
    assert calculate_late_night_hours("22:15", "02:45") == 4.50

    # 21:45〜24:30 -> 深夜 2.50h (22:00〜24:30 = 150分 = 2.5h)
    assert calculate_late_night_hours("21:45", "24:30") == 2.50

    # 早朝跨ぎ 04:15〜09:00 -> 深夜 0.75h (04:15〜05:00 = 45分 = 0.75h)
    assert calculate_late_night_hours("04:15", "09:00") == 0.75


def test_calculate_interval_minutes_and_hours():
    # TV-4: 前日 22:15 終了 -> 翌日 09:15 開始 (660分 = 11.0h)
    assert calculate_interval_minutes("22:15", "09:15") == 660
    assert calculate_interval_hours("22:15", "09:15") == 11.0

    # TV-5: 前日 22:15 終了 -> 翌日 09:00 開始 (645分 = 10.75h)
    assert calculate_interval_minutes("22:15", "09:00") == 645
    assert calculate_interval_hours("22:15", "09:00") == 10.75

    # 前日 01:00 終了 (翌日1時) -> 翌日 12:00 開始 (660分 = 11.0h)
    assert calculate_interval_minutes("01:00", "12:00") == 660
    assert calculate_interval_hours("01:00", "12:00") == 11.0


class _FakeShift:
    def __init__(self, shift_id: str, start: str, end: str):
        self.id = shift_id
        self.start = start
        self.end = end


class _FakeRequirement:
    def __init__(self, day_offset: int, shift_id: str, min_staff: int):
        self.day_offset = day_offset
        self.shift_id = shift_id
        self.min_staff = min_staff


def _hours_for(shifts, requirements, day_offset=0):
    req_map = build_hourly_requirements_from_shifts(shifts, requirements)
    return sorted(h for (d, h) in req_map if d == day_offset)


def test_sub_hour_shift_does_not_explode_to_24_hours():
    """同一時内に収まるシフトが全24時間の需要にならない。

    旧実装は時単位で `e_h <= s_h` を判定していたため、09:00-09:45 が
    翌日跨ぎと誤判定され range(9, 33) すなわち全24時間に需要が乗っていた。
    """
    shifts = [_FakeShift("s", "09:00", "09:45")]
    requirements = [_FakeRequirement(0, "s", 2)]
    assert _hours_for(shifts, requirements) == [9]


def test_fractional_boundaries_are_covered():
    """端数のある開始・終了時刻でも、かかる時間帯が需要から脱落しない。"""
    shifts = [_FakeShift("s", "09:30", "17:30")]
    requirements = [_FakeRequirement(0, "s", 1)]
    # 09:30 開始なので時刻9から、17:30 終了なので時刻17まで対象
    assert _hours_for(shifts, requirements) == [9, 10, 11, 12, 13, 14, 15, 16, 17]


def test_overnight_shift_wraps_correctly():
    """日跨ぎシフトは翌日側の時間帯へ正しく回り込む。"""
    shifts = [_FakeShift("s", "22:00", "26:00")]
    requirements = [_FakeRequirement(0, "s", 1)]
    assert _hours_for(shifts, requirements) == [0, 1, 22, 23]


def test_overlapping_shifts_accumulate():
    """同一時間帯に重なる複数シフトの必要人数は加算される。"""
    shifts = [_FakeShift("a", "10:00", "14:00"), _FakeShift("b", "12:00", "16:00")]
    requirements = [_FakeRequirement(0, "a", 1), _FakeRequirement(0, "b", 2)]
    req_map = build_hourly_requirements_from_shifts(shifts, requirements)
    assert req_map[(0, 10)] == 1
    assert req_map[(0, 12)] == 3  # 重複区間
    assert req_map[(0, 15)] == 2


def test_unknown_shift_id_is_ignored():
    """存在しない shift_id を指す requirement は無視される。"""
    shifts = [_FakeShift("a", "10:00", "14:00")]
    requirements = [_FakeRequirement(0, "missing", 5)]
    assert build_hourly_requirements_from_shifts(shifts, requirements) == {}
