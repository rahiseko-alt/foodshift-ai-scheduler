def parse_time_to_minutes(time_str: str) -> int:
    """HH:MM (または H:MM) 形式の文字列を0:00からの経過分数に変換する。

    例: "09:30" -> 570, "9:30" -> 570, "24:30" -> 1470
    """
    parts = time_str.strip().split(":")
    hours = int(parts[0])
    minutes = int(parts[1])
    return hours * 60 + minutes


def build_hourly_requirements_from_shifts(shifts, requirements) -> dict[tuple[int, int], int]:
    """固定シフト枠ベースの必要人数を、1時間スロット単位の必要人数へ変換する。

    旧実装は `int(shift.start.split(":")[0])` と時単位で比較していたため、
    `09:00-09:45` のように開始と終了が同じ時に収まるシフトでは
    `e_h <= s_h` が真になって翌日跨ぎと誤判定され、`range(9, 33)` すなわち
    **全24時間に必要人数が乗る**という破滅的な需要膨張を起こしていた。

    判定は必ず分単位で行い、そのあとで時間に落とす。
    シフトが少しでもかかる時間帯は必要人数の対象とする（切り上げ）。
    """
    req_map: dict[tuple[int, int], int] = {}
    shift_map = {s.id: s for s in shifts}
    for req in requirements:
        shift = shift_map.get(req.shift_id)
        if shift is None:
            continue
        start_min = parse_time_to_minutes(shift.start)
        end_min = parse_time_to_minutes(shift.end)
        # 翌日跨ぎの判定は「分」で行う（時単位だと同一時内シフトを誤判定する）
        if end_min <= start_min:
            end_min += 24 * 60
        start_hour = start_min // 60
        end_hour = -(-end_min // 60)  # 天井除算: 端数の時間帯も対象に含める
        # 1時間未満のシフトでも必ず1スロットは確保する。
        #
        # 注: 直前で `end_min <= start_min` なら 24時間を加算しているため
        # 常に `end_min > start_min` であり、天井除算の結果は必ず
        # `start_hour + 1` 以上になる。つまりこの max() は現状**到達不能**で、
        # 変異テストで消しても落ちるテストが存在しない（T-MINSLOT が生存）。
        # 上の2行の順序が入れ替わった場合に備えた防御として残すが、
        # 殺せる入力が無い以上ここを狙ったテストは書かない。
        end_hour = max(end_hour, start_hour + 1)
        for h in range(start_hour, end_hour):
            key = (req.day_offset, h % 24)
            req_map[key] = req_map.get(key, 0) + req.min_staff
    return req_map


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
