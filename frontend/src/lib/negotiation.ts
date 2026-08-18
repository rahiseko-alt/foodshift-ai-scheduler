/**
 * FoodShift 人手不足交渉支援 ＆ お願いLINE文面生成モジュール (negotiation.ts)
 *
 * スコアリング式:
 *   S(e) = 40 * A(e, d, s) + 30 * C(e, d) + 20 * R(e, s) + 10 * F(e)
 */

import { StaffMember, Shift, StaffAvailability, ScheduledShiftSlot } from './types';

function isLateNight(start: string, end: string, isLateFlag?: boolean): boolean {
  if (isLateFlag) return true;
  const parseHour = (t: string) => {
    const parts = t.split(':');
    return parseInt(parts[0], 10) + parseInt(parts[1] || '0', 10) / 60;
  };
  const s = parseHour(start);
  const e = parseHour(end);
  if (e > s) {
    return s < 5 || e > 22 || (s < 22 && e > 22);
  } else {
    // 日跨ぎ
    return true;
  }
}

export interface CandidateScore {
  staff: StaffMember;
  score: number;
  reasons: string[];
  currentWeeklyHours: number;
  maxWeeklyHours: number;
  currentDays: number;
  availabilityStatus: 'want' | 'available' | 'none';
  lineMessage: string;
}

export interface FindCandidatesOptions {
  day_offset: number;
  shift: Shift;
  shifts?: Shift[];
  dateFormatted: string; // 例: "9月5日(金)"
  staff_members: StaffMember[];
  availabilities: StaffAvailability[];
  currentSchedule: ScheduledShiftSlot[];
  required_roles?: Record<string, number>;
}

/**
 * 不足シフト枠に対する適格スタッフ候補をスコアリングしてTOP3を抽出
 */
export function findShortageCandidates(options: FindCandidatesOptions): CandidateScore[] {
  const {
    day_offset,
    shift,
    shifts = [shift],
    dateFormatted,
    staff_members,
    availabilities,
    currentSchedule,
    required_roles = {},
  } = options;

  const isLate = isLateNight(shift.start, shift.end, shift.is_late_night);
  const requiredRoleList = Object.keys(required_roles);

  // 当該日の各スタッフの割当状況
  const assignedStaffIdsToday = new Set<string>();
  for (const slot of currentSchedule) {
    if (slot.day_offset === day_offset) {
      for (const s of slot.assigned_staff) {
        assignedStaffIdsToday.add(s.id);
      }
    }
  }

  // スタッフごとの当週割当労働時間 & 出勤日数集計
  const staffHoursMap: Record<string, number> = {};
  const staffDaysMap: Record<string, number> = {};

  for (const slot of currentSchedule) {
    const shiftObj = shifts.find((sh) => sh.id === slot.shift_id);
    const slotHours = shiftObj?.hours || shift.hours || 0;
    for (const s of slot.assigned_staff) {
      staffHoursMap[s.id] = (staffHoursMap[s.id] || 0) + slotHours;
      staffDaysMap[s.id] = (staffDaysMap[s.id] || 0) + 1;
    }
  }

  const candidateScores: CandidateScore[] = [];

  for (const staff of staff_members) {
    // 非アクティブ（休職・退職）は除外
    if (staff.is_active === false) continue;

    // Hard除外1: 既に当日他のシフトに出勤している
    if (assignedStaffIdsToday.has(staff.id)) continue;

    // Hard除外2: 年少者（18歳未満）または母性保護対象で、深夜シフト（22:00〜05:00）にかかる
    if (isLate && (staff.is_minor || staff.is_maternity_protection || staff.is_pregnant_or_nursing)) continue;

    // 希望ステータス取得
    const avail = availabilities.find(
      (a) => a.staff_id === staff.id && a.day_offset === day_offset && a.shift_id === shift.id
    );

    // Hard除外3: 明示的な「不可 不可（unavailable）」申請
    if (avail && avail.status === 'unavailable') continue;

    const reasons: string[] = [];

    // 1. 出勤可能性 A(e, d, s) (重み: 40)
    let aScore = 0.5; // 未入力（none）は0.5
    let availStatus: 'want' | 'available' | 'none' = 'none';
    if (avail?.status === 'want') {
      aScore = 1.5;
      availStatus = 'want';
      reasons.push('希望 強く希望を出しています');
    } else if (avail?.status === 'available') {
      aScore = 1.0;
      availStatus = 'available';
      reasons.push('可 出勤可能で提出しています');
    } else {
      reasons.push('・希望未入力（調整枠）');
    }

    // 2. 余力キャパシティ C(e, d) (重み: 30)
    const currentHours = staffHoursMap[staff.id] || 0;
    const maxHours = staff.max_weekly_hours || 40;
    const remainingHours = Math.max(0, maxHours - currentHours);
    const capacityRatio = Math.min(1.0, remainingHours / maxHours);

    // シフト入ると週上限を超える場合は減点
    let cScore = capacityRatio;
    if (currentHours + shift.hours > maxHours) {
      cScore = 0.1;
      reasons.push(`週上限まで残り${remainingHours.toFixed(1)}h`);
    } else {
      reasons.push(`週残余力: ${remainingHours.toFixed(1)}h / 上限${maxHours}h`);
    }

    // 3. ロール適合 R(e, s) (重み: 20)
    let rScore = 0.5;
    if (requiredRoleList.length > 0) {
      const hasRequired = requiredRoleList.some((r) => staff.roles.includes(r));
      if (hasRequired) {
        rScore = 1.0;
        reasons.push(`必須ロール (${requiredRoleList.join(', ')}) を保有`);
      } else {
        rScore = 0.1;
      }
    } else {
      rScore = 0.8;
    }

    // 4. 公平性 F(e) (重み: 10)
    const currentDays = staffDaysMap[staff.id] || 0;
    const maxDays = staff.max_days_per_period || 7;
    const fScore = Math.max(0, 1.0 - currentDays / maxDays);

    // 総合スコア計算 (0〜100+)
    const totalScore = Math.round(40 * aScore + 30 * cScore + 20 * rScore + 10 * fScore);

    // お願いLINE文面作成
    const lineMessage = `${staff.name}さん、お疲れ様です！
${dateFormatted}の【${shift.name}】(${shift.start}〜${shift.end})が現在人手不足で困っていまして、出勤をお願いできないでしょうか？もし可能でしたらご連絡いただけますと大変助かります！よろしくお願いいたします。

━━━━━━━━━━━━━━
FoodShift AI シフト管理
━━━━━━━━━━━━━━`;

    candidateScores.push({
      staff,
      score: totalScore,
      reasons,
      currentWeeklyHours: currentHours,
      maxWeeklyHours: maxHours,
      currentDays,
      availabilityStatus: availStatus,
      lineMessage,
    });
  }

  // スコア降順ソート
  candidateScores.sort((a, b) => b.score - a.score);

  return candidateScores.slice(0, 3);
}
