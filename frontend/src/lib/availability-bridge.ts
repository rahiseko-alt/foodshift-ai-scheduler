/**
 * シフト枠ベースの希望を、1時間スロット単位の勤務可能時間へ変換する。
 *
 * 管理画面からの最適化は `hourly_availabilities` を読む経路に到達するが、
 * スタッフから届くLINE提出コードが運ぶのは枠ベースの `availabilities` だけ。
 * 変換が無いと、スタッフが「不可」と提出した日にもシフトが入れられる。
 */

import { AvailabilityStatus, Shift, StaffAvailability, StaffHourlyAvailability } from './types';

function hourFloor(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return Math.floor(h + (m || 0) / 60);
}

function hourCeil(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return Math.ceil(h + (m || 0) / 60);
}

/**
 * 1名分の枠ベース希望から、日ごとの勤務可能時間帯を組み立てる。
 *
 * - その日の全枠が「不可」なら終日不可
 * - それ以外は「不可でない枠」の範囲を勤務可能時間帯とする
 * - 1枠でも「希望」があればその日を希望日とする
 * - 年少者は深夜業禁止のため 22 時で頭打ちにする
 */
export function deriveHourlyAvailability(
  staffId: string,
  days: number,
  shifts: Shift[],
  availabilities: StaffAvailability[],
  isMinor: boolean
): StaffHourlyAvailability[] {
  const statusOf = (day: number, shiftId: string): AvailabilityStatus => {
    const hit = availabilities.find(
      (a) => a.staff_id === staffId && a.day_offset === day && a.shift_id === shiftId
    );
    return hit ? hit.status : 'available';
  };

  return Array.from({ length: days }, (_, d) => {
    const open = shifts.filter((sh) => statusOf(d, sh.id) !== 'unavailable');
    const wants = shifts.filter((sh) => statusOf(d, sh.id) === 'want');

    if (shifts.length > 0 && open.length === 0) {
      return {
        staff_id: staffId,
        day_offset: d,
        available_from: 0,
        available_to: 0,
        is_available: false,
        is_preferred: false,
      };
    }

    const from = open.length > 0 ? Math.min(...open.map((sh) => hourFloor(sh.start))) : 0;
    const to = open.length > 0 ? Math.max(...open.map((sh) => hourCeil(sh.end))) : 24;

    return {
      staff_id: staffId,
      day_offset: d,
      available_from: Math.max(0, Math.min(23, from)),
      available_to: Math.max(1, Math.min(isMinor ? 22 : 24, to)),
      is_available: true,
      is_preferred: wants.length > 0,
    };
  });
}
