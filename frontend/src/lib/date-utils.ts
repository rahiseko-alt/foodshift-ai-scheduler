// 日付・曜日関連のフォーマットユーティリティ

export interface DateInfo {
  dateFormatted: string; // "9/1 (月)"
  shortDate: string; // "9/1"
  isoDate: string; // "2026-09-01"
  dayOfWeekNum: number; // 0: 日, 1: 月, ..., 6: 土
  dayName: string; // "月", "火", ...
  isSaturday: boolean;
  isSunday: boolean;
}

export function getDateInfo(startDateStr: string, dayOffset: number): DateInfo {
  const parts = startDateStr.split('-').map(Number);
  const year = parts[0] || 2026;
  const month = (parts[1] || 9) - 1;
  const day = parts[2] || 1;

  const date = new Date(year, month, day + dayOffset);
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const dayOfWeekNum = date.getDay();
  const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
  const dayName = dayNames[dayOfWeekNum];

  const yyyy = date.getFullYear();
  const mm = String(m).padStart(2, '0');
  const dd = String(d).padStart(2, '0');

  return {
    dateFormatted: `${m}/${d} (${dayName})`,
    shortDate: `${m}/${d}`,
    isoDate: `${yyyy}-${mm}-${dd}`,
    dayOfWeekNum,
    dayName,
    isSaturday: dayOfWeekNum === 6,
    isSunday: dayOfWeekNum === 0,
  };
}
