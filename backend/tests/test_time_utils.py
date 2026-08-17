from app.engine.time_utils import (
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
