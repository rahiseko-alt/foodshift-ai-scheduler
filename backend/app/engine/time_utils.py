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
