// 日付・曜日関連のフォーマットユーティリティ ＆ 営業日正規化ロジック

export interface DateInfo {
  dateFormatted: string; // "9/1 (月)"
  shortDate: string; // "9/1"
  isoDate: string; // "2026-09-01"
  dayOfWeekNum: number; // 0: 日, 1: 月, ..., 6: 土
  dayName: string; // "月", "火", ...
  isSaturday: boolean;
  isSunday: boolean;
}

/** 飲食店・深夜営業の標準締め時刻 (朝 05:00 前のシフトは前営業日扱い) */
export const BUSINESS_DAY_CUTOFF_HOUR = 5;

/**
 * 開始日とオフセットから DateInfo を生成する
 */
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

/**
 * 営業日締め時刻（Cutoff: 05:00）を考慮した営業日を計算する
 * 例: 9/2 02:30 の勤務は 9/1 の営業日（前日）として正規化
 */
export function getBusinessDate(date: Date, cutoffHour: number = BUSINESS_DAY_CUTOFF_HOUR): Date {
  const normalized = new Date(date.getTime());
  if (normalized.getHours() < cutoffHour) {
    // 締め時刻より前（例: 00:00〜04:59）は前日の営業日
    normalized.setDate(normalized.getDate() - 1);
  }
  return normalized;
}

/**
 * 日時文字列またはDateから営業日 (YYYY-MM-DD) を返却する
 */
export function formatBusinessDate(date: Date, cutoffHour: number = BUSINESS_DAY_CUTOFF_HOUR): string {
  const bDate = getBusinessDate(date, cutoffHour);
  const yyyy = bDate.getFullYear();
  const mm = String(bDate.getMonth() + 1).padStart(2, '0');
  const dd = String(bDate.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * 開始日 (YYYY-MM-DD) と開始時刻 (HH:MM) から実営業日 (YYYY-MM-DD) を正規化する
 */
export function normalizeBusinessDateString(
  dateStr: string,
  timeStr: string = '12:00',
  cutoffHour: number = BUSINESS_DAY_CUTOFF_HOUR
): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hour, minute] = timeStr.split(':').map(Number);
  const date = new Date(year, (month || 1) - 1, day || 1, hour || 0, minute || 0);
  return formatBusinessDate(date, cutoffHour);
}
