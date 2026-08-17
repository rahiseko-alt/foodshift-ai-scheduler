def parse_time_to_minutes(time_str: str) -> int:
    """HH:MM (または H:MM) 形式の文字列を0:00からの経過分数に変換する。

    例: "09:30" -> 570, "9:30" -> 570, "24:30" -> 1470
    """
    parts = time_str.strip().split(":")
    hours = int(parts[0])
    minutes = int(parts[1])
    return hours * 60 + minutes


def is_shift_late_night(start_str: str, end_str: str) -> bool:
    """シフトが22:00 (1320分) 以降または早朝5:00 (300分) 前にかかっているかを判定する。

    労働基準法第60条の年少者深夜業禁止（22:00〜05:00）に対応。
    """
    start_min = parse_time_to_minutes(start_str)
    end_min = parse_time_to_minutes(end_str)

    if end_min <= start_min:
        end_min += 24 * 60

    # 22:00 は 1320分、早朝05:00 は 300分 (翌日跨ぎ時 1740分)
    if start_min < 5 * 60:  # 早朝5時前開始
        return True
    return end_min > 22 * 60


def calculate_late_night_hours(start_str: str, end_str: str) -> float:
    """シフト内の22:00〜05:00（深夜帯）の実働時間（時間単位 / 0.25h精度）を算出する。

    例:
    - "17:45"〜"22:15" -> 0.25 時間 (22:00〜22:15)
    - "22:15"〜"02:45" ("26:45") -> 4.50 時間 (22:15〜26:45)
    - "04:00"〜"09:00" -> 1.00 時間 (04:00〜05:00)
    """
    start_min = parse_time_to_minutes(start_str)
    end_min = parse_time_to_minutes(end_str)

    if end_min <= start_min:
        end_min += 24 * 60

    # 深夜時間帯ウィンドウ: [0, 300] (0:00〜5:00), [1320, 1740] (22:00〜29:00/翌5:00), [2760, 3180]
    windows = [(0, 300), (1320, 1740), (2760, 3180)]
    total_late_min = 0

    for w_start, w_end in windows:
        overlap_start = max(start_min, w_start)
        overlap_end = min(end_min, w_end)
        if overlap_end > overlap_start:
            total_late_min += overlap_end - overlap_start

    return round(total_late_min / 60.0, 2)


def calculate_interval_minutes(end1_str: str, start2_str: str) -> int:
    """前日シフト終了時刻と翌日シフト開始時刻の間のインターバル（分数単位）を算出する。"""
    end1_min = parse_time_to_minutes(end1_str)
    # 前日シフトが跨ぎの場合（00:00〜05:00 の終了時刻は翌日跨ぎとみなす）
    if end1_min < 5 * 60:
        end1_min += 24 * 60

    start2_min = parse_time_to_minutes(start2_str)
    # 翌日の開始時刻は前日起点で 24*60 (1440分) 加算
    next_day_start_min = 24 * 60 + start2_min

    interval_min = next_day_start_min - end1_min
    return max(0, interval_min)


def calculate_interval_hours(end1_str: str, start2_str: str) -> float:
    """前日シフト終了時刻と翌日シフト開始時刻の間のインターバル（時間単位）を算出する。"""
    interval_min = calculate_interval_minutes(end1_str, start2_str)
    return round(interval_min / 60.0, 2)
