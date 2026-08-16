import { Shift, ShiftRequirement, ShiftOptimizeRequest } from '../types';
import { DailyForecast, ForecastResult, ShiftSlotLaborRequirement } from './types';

// 時刻文字列 "10:00" -> 10 (hour)
function parseHour(timeStr: string): number {
  const parts = timeStr.split(':');
  return parseInt(parts[0], 10) || 0;
}

// 1時間粒度の予測結果を、店舗で定義されたシフト枠（早番/遅番/通し等）へ集約
export function mapForecastToSlotRequirements(
  dailyForecasts: DailyForecast[],
  shifts: Shift[]
): ShiftSlotLaborRequirement[] {
  const results: ShiftSlotLaborRequirement[] = [];

  dailyForecasts.forEach((daily) => {
    shifts.forEach((shift) => {
      let startH = parseHour(shift.start);
      let endH = parseHour(shift.end);

      // 日跨ぎシフトの場合 (例: 22:00〜06:00)
      if (endH <= startH) {
        endH += 24;
      }

      // シフト枠に含まれる時間の予測データを抽出
      const slotHourlyForecasts = daily.hourly.filter((h) => {
        const hour = h.hour;
        // 翌朝時間帯の対応
        return hour >= startH && hour < endH;
      });

      if (slotHourlyForecasts.length === 0) {
        // シフト枠外または時間ゼロ
        results.push({
          day_offset: daily.day_offset,
          shift_id: shift.id,
          shift_name: shift.name,
          start_hour: startH,
          end_hour: endH,
          calculated_min_staff: 1,
          peak_hour_staff: 1,
          average_hour_staff: 1,
          forecast_sales_in_slot: 0,
        });
        return;
      }

      const staffCounts = slotHourlyForecasts.map((h) => h.recommended_staff);
      const totalSlotSales = slotHourlyForecasts.reduce((sum, h) => sum + h.predicted_sales, 0);

      const peakStaff = Math.max(...staffCounts);
      const avgStaff = staffCounts.reduce((sum, c) => sum + c, 0) / staffCounts.length;

      // 推奨人数の算出ロジック:
      // ピーク時間帯（売上が平均以上の時間帯）の必要人数を適切にカバーするため、
      // 80パーセンタイルまたは平均と最大値の加重合成（0.7 * peak + 0.3 * avg）を天井丸め
      const blendedStaff = Math.ceil(peakStaff * 0.7 + avgStaff * 0.3);
      const calculatedMinStaff = Math.max(1, blendedStaff);

      results.push({
        day_offset: daily.day_offset,
        shift_id: shift.id,
        shift_name: shift.name,
        start_hour: startH,
        end_hour: endH,
        calculated_min_staff: calculatedMinStaff,
        peak_hour_staff: peakStaff,
        average_hour_staff: Number(avgStaff.toFixed(1)),
        forecast_sales_in_slot: totalSlotSales,
      });
    });
  });

  return results;
}

// 既存の ShiftRequirement[] の役割構成比率（ホール/キッチン等）を維持しながら
// 予測結果の必要人数へ更新した ShiftRequirement[] を生成
export function generateUpdatedRequirements(
  forecastResult: ForecastResult,
  currentShifts: Shift[],
  existingRequirements: ShiftRequirement[] = []
): ShiftRequirement[] {
  const slotLaborReqs = mapForecastToSlotRequirements(
    forecastResult.daily_forecasts,
    currentShifts
  );

  const updatedRequirements: ShiftRequirement[] = [];

  slotLaborReqs.forEach((slotReq) => {
    // 既存の該当要件から役割比率を参照
    const existing = existingRequirements.find(
      (r) => r.day_offset === slotReq.day_offset && r.shift_id === slotReq.shift_id
    );

    const targetCount = slotReq.calculated_min_staff;
    const requiredRoles: Record<string, number> = {};

    if (existing && Object.keys(existing.required_roles).length > 0) {
      const totalExisting = Object.values(existing.required_roles).reduce((a, b) => a + b, 0);
      if (totalExisting > 0) {
        let assignedSum = 0;
        const roleEntries = Object.entries(existing.required_roles);

        roleEntries.forEach(([role, count], idx) => {
          if (idx === roleEntries.length - 1) {
            // 最後の役割で端数調整
            requiredRoles[role] = Math.max(0, targetCount - assignedSum);
          } else {
            const roleCount = Math.round((count / totalExisting) * targetCount);
            requiredRoles[role] = roleCount;
            assignedSum += roleCount;
          }
        });
      } else {
        requiredRoles['hall'] = Math.ceil(targetCount / 2);
        requiredRoles['kitchen'] = Math.max(0, targetCount - requiredRoles['hall']);
      }
    } else {
      // デフォルト: ホール半数、キッチン半数
      const hallCount = Math.ceil(targetCount / 2);
      requiredRoles['hall'] = hallCount;
      requiredRoles['kitchen'] = Math.max(0, targetCount - hallCount);
    }

    updatedRequirements.push({
      day_offset: slotReq.day_offset,
      shift_id: slotReq.shift_id,
      min_staff: targetCount,
      required_roles: requiredRoles,
    });
  });

  return updatedRequirements;
}

// ShiftOptimizeRequest 全体に予測売上・必要人数を反映
export function applyForecastToOptimizeRequest(
  currentRequest: ShiftOptimizeRequest,
  forecastResult: ForecastResult
): ShiftOptimizeRequest {
  const updatedReqs = generateUpdatedRequirements(
    forecastResult,
    currentRequest.shifts,
    currentRequest.requirements
  );

  return {
    ...currentRequest,
    requirements: updatedReqs,
  };
}
