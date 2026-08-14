def parse_time_to_minutes(time_str: str) -> int:
    """HH:MM 形式の文字列を0:00からの経過分数に変換する。

    例: "09:30" -> 570, "24:30" -> 1470
    """
    parts = time_str.strip().split(":")
    hours = int(parts[0])
    minutes = int(parts[1])
    return hours * 60 + minutes


def is_shift_late_night(start_str: str, end_str: str) -> bool:
    """シフトが22:00 (1320分) 以降にかかっているかを判定する。

    労働基準法第60条の年少者深夜業禁止（22:00〜05:00）に対応。
    """
    start_min = parse_time_to_minutes(start_str)
    end_min = parse_time_to_minutes(end_str)

    # 終了時刻が開始時刻より前、または24時を超えている場合は翌日跨ぎ
    if end_min < start_min:
        end_min += 24 * 60

    # 22:00 は 1320分
    late_night_start = 22 * 60  # 1320分

    # シフト時間帯 [start_min, end_min] が深夜帯 [1320, 1740] または [0, 300] と交差するか
    if start_min < 5 * 60:  # 早朝5時前開始
        return True
    return end_min > late_night_start


def calculate_late_night_hours(start_str: str, end_str: str) -> float:
    """シフト内の22:00〜05:00（深夜帯）の実働時間（時間単位）を算出する。

    例:
    - "17:00"〜"23:00" -> 1.0 時間 (22:00〜23:00)
    - "21:30"〜"24:30" ("00:30") -> 2.5 時間 (22:00〜24:30)
    - "04:00"〜"09:00" -> 1.0 時間 (04:00〜05:00)
    """
    start_min = parse_time_to_minutes(start_str)
    end_min = parse_time_to_minutes(end_str)

    if end_min < start_min:
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


def calculate_interval_hours(end1_str: str, start2_str: str) -> float:
    """前日シフト終了時刻と翌日シフト開始時刻の間のインターバル（時間単位）を算出する。

    前日を0:00〜24:00、翌日を24:00〜48:00として差分を計算。
    例:
    - 前日終了 23:00 (1380分)、翌日開始 09:00 (1440 + 540 = 1980分) -> 600分 = 10.0時間
    - 前日終了 01:00跨ぎ (1500分)、翌日開始 10:00 (1440 + 600 = 2040分) -> 540分 = 9.0時間
    """
    end1_min = parse_time_to_minutes(end1_str)
    # 前日シフトが跨ぎの場合（例: 24:30 や 01:00 で表記されている場合）、end1 が通常深夜帯
    # end1_str が 01:00 のような表記の場合、24*60 を加算する必要があるかを判定
    # 00:00〜05:00 の終了時刻は翌日跨ぎとみなす (1440加算)
    if end1_min < 5 * 60:
        end1_min += 24 * 60

    start2_min = parse_time_to_minutes(start2_str)
    # 翌日の開始時刻は前日起点で 24*60 (1440分) 加算
    next_day_start_min = 24 * 60 + start2_min

    interval_min = next_day_start_min - end1_min
    if interval_min < 0:
        return 0.0
    return round(interval_min / 60.0, 2)
