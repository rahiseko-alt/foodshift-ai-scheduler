/**
 * 最適化レスポンスの表示用正規化。
 *
 * バックエンドには2つの求解経路があり、返す形が異なる:
 *   - シフト枠ベース : schedule に割当が入る
 *   - 1時間スロット  : schedule は常に空で、割当は assigned_shifts に入る
 *
 * 管理画面からの最適化は必ず後者に到達するため、`response.schedule` を
 * 読んでいる画面（枠別マトリクス・CSV出力・代打候補の当日出勤判定）は
 * **本番では常に空**を見ていた。表示側で経路を意識しなくて済むよう、
 * 受信時に一度だけ schedule を組み立てる。
 */

import {
  AssignedShiftTime,
  ScheduledShiftSlot,
  Shift,
  ShiftOptimizeRequest,
  ShiftOptimizeResponse,
  StaffMember,
} from './types';

function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + (m || 0);
}

/** 2つの時間帯が少しでも重なるか（日跨ぎは +24h して比較） */
function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  let a1 = toMinutes(aStart);
  let a2 = toMinutes(aEnd);
  let b1 = toMinutes(bStart);
  let b2 = toMinutes(bEnd);
  if (a2 <= a1) a2 += 24 * 60;
  if (b2 <= b1) b2 += 24 * 60;
  // 一方だけが日跨ぎの場合に備えて両方向で判定する
  const hit = (s1: number, e1: number, s2: number, e2: number) => s1 < e2 && s2 < e1;
  return hit(a1, a2, b1, b2) || hit(a1 + 1440, a2 + 1440, b1, b2) || hit(a1, a2, b1 + 1440, b2 + 1440);
}

/**
 * assigned_shifts（実際の出退勤時刻）から、シフト枠ごとの割当表を組み立てる。
 * 出退勤時刻がその枠の時間帯に重なっていれば、その枠に配置されているとみなす。
 */
export function buildScheduleFromAssignedShifts(
  shifts: Shift[],
  staffMembers: StaffMember[],
  assignedShifts: AssignedShiftTime[]
): ScheduledShiftSlot[] {
  const staffById = new Map(staffMembers.map((s) => [s.id, s]));
  const byKey = new Map<string, ScheduledShiftSlot>();

  for (const a of assignedShifts) {
    for (const sh of shifts) {
      if (!overlaps(a.start_time, a.end_time, sh.start, sh.end)) continue;

      const key = `${a.day_offset}_${sh.id}`;
      let slot = byKey.get(key);
      if (!slot) {
        slot = {
          date: a.date,
          day_offset: a.day_offset,
          shift_id: sh.id,
          assigned_staff: [],
        };
        byKey.set(key, slot);
      }
      if (slot.assigned_staff.some((s) => s.id === a.staff_id)) continue;

      const member = staffById.get(a.staff_id);
      slot.assigned_staff.push({
        id: a.staff_id,
        name: a.name || member?.name || a.staff_id,
        assigned_role: member?.roles?.[0] || '',
        hourly_wage: a.hourly_wage,
        is_want_fulfilled: false,
      });
    }
  }

  return Array.from(byKey.values()).sort(
    (x, y) => x.day_offset - y.day_offset || x.shift_id.localeCompare(y.shift_id)
  );
}

/**
 * 表示側が経路を意識しなくて済むよう schedule を補完する。
 * すでに schedule が入っている場合はそのまま返す。
 */
export function normalizeOptimizeResponse(
  request: ShiftOptimizeRequest,
  response: ShiftOptimizeResponse
): ShiftOptimizeResponse {
  if (response.schedule && response.schedule.length > 0) return response;
  const assigned = response.assigned_shifts || [];
  if (assigned.length === 0) return response;

  return {
    ...response,
    schedule: buildScheduleFromAssignedShifts(request.shifts, request.staff_members, assigned),
  };
}
