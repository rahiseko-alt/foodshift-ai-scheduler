import {
  ScheduleSummary,
  Shift,
  ShiftOptimizeRequest,
  ShiftOptimizeResponse,
  StaffMember,
  UnfilledRequirement,
} from './types';

// 深夜時間（22:00〜05:00）にかかる時間数を計算
export function calculateLateNightHours(start: string, end: string): number {
  const [sH, sM] = start.split(':').map(Number);
  const [eH, eM] = end.split(':').map(Number);
  let sMin = sH * 60 + sM;
  let eMin = eH * 60 + eM;
  if (eMin <= sMin) {
    eMin += 24 * 60; // 翌日跨ぎ
  }

  // 深夜枠: 22:00 (1320分) 〜 29:00 (1740分 / 翌05:00)
  const lateStartMin = 22 * 60;
  const lateEndMin = 29 * 60;

  const overlapStart = Math.max(sMin, lateStartMin);
  const overlapEnd = Math.min(eMin, lateEndMin);

  if (overlapEnd > overlapStart) {
    return (overlapEnd - overlapStart) / 60.0;
  }
  return 0.0;
}

// レスポンスサマリーの再計算（手動アサイン変更時）
export function recalculateScheduleSummary(
  request: ShiftOptimizeRequest,
  schedule: ShiftOptimizeResponse['schedule'],
  projectedSales = 2400000
): ScheduleSummary {
  let totalLaborCost = 0;
  let totalWorkHours = 0;
  let totalBreakHours = 0;
  let deepNightExtraCost = 0;

  const staffDaysCount = new Map<string, number>();
  for (const st of request.staff_members) {
    staffDaysCount.set(st.id, 0);
  }

  let totalWantsCount = 0;
  let fulfilledWantsCount = 0;

  // 希望数カウント
  for (const a of request.availabilities) {
    if (a.status === 'want') {
      totalWantsCount++;
    }
  }

  const shiftMap = new Map<string, Shift>();
  for (const s of request.shifts) {
    shiftMap.set(s.id, s);
  }

  const staffMap = new Map<string, StaffMember>();
  for (const st of request.staff_members) {
    staffMap.set(st.id, st);
  }

  // アサイン集計
  for (const slot of schedule) {
    const shift = shiftMap.get(slot.shift_id);
    if (!shift) continue;

    const breakHours = (shift.break_minutes || 0) / 60.0;
    const actualWorkHours = Math.max(0, shift.hours - breakHours);
    const lateHours = calculateLateNightHours(shift.start, shift.end);

    for (const ast of slot.assigned_staff) {
      const staffObj = staffMap.get(ast.id);
      const baseWage = staffObj ? staffObj.hourly_wage : ast.hourly_wage;
      const baseCost = Math.round(actualWorkHours * baseWage);
      const extraCost = Math.round(lateHours * baseWage * 0.25); // 深夜25%割増

      totalLaborCost += baseCost + extraCost;
      totalWorkHours += actualWorkHours;
      totalBreakHours += breakHours;
      deepNightExtraCost += extraCost;

      staffDaysCount.set(ast.id, (staffDaysCount.get(ast.id) || 0) + 1);

      if (ast.is_want_fulfilled) {
        fulfilledWantsCount++;
      }
    }
  }

  // 不足計算
  const unfilledRequirements: UnfilledRequirement[] = [];
  for (const req of request.requirements) {
    const slot = schedule.find(
      (s) => s.day_offset === req.day_offset && s.shift_id === req.shift_id
    );
    const assignedCount = slot ? slot.assigned_staff.length : 0;
    if (assignedCount < req.min_staff) {
      const shortage = req.min_staff - assignedCount;
      unfilledRequirements.push({
        date: slot?.date || `Day ${req.day_offset + 1}`,
        day_offset: req.day_offset,
        shift_id: req.shift_id,
        required_count: req.min_staff,
        assigned_count: assignedCount,
        shortage,
        reason: '手動割当不足またはスタッフ希望不一致',
      });
    }
  }

  // 出勤日数格差
  const counts = Array.from(staffDaysCount.values());
  const maxDays = counts.length > 0 ? Math.max(...counts) : 0;
  const minDays = counts.length > 0 ? Math.min(...counts) : 0;
  const maxStaffDayDifference = maxDays - minDays;

  // 希望充足率
  const wantsFulfillmentRate =
    totalWantsCount > 0 ? fulfilledWantsCount / totalWantsCount : 1.0;

  // 人時売上・人件費率
  const laborCostRatio =
    projectedSales > 0 ? Math.round((totalLaborCost / projectedSales) * 1000) / 10 : 0;
  const salesPerLaborHour =
    totalWorkHours > 0 ? Math.round(projectedSales / totalWorkHours) : 0;

  return {
    total_labor_cost: totalLaborCost,
    total_work_hours: Math.round(totalWorkHours * 10) / 10,
    wants_fulfillment_rate: Math.round(wantsFulfillmentRate * 100) / 100,
    max_staff_day_difference: maxStaffDayDifference,
    unfilled_requirements: unfilledRequirements,
    total_break_hours: Math.round(totalBreakHours * 10) / 10,
    deep_night_extra_cost: deepNightExtraCost,
    projected_sales: projectedSales,
    labor_cost_ratio: laborCostRatio,
    sales_per_labor_hour: salesPerLaborHour,
  };
}
