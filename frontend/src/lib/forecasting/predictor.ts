import {
  BusinessTypeProfile,
  CalendarModifier,
  DailyForecast,
  ForecastRequest,
  ForecastResult,
  HourlyForecast,
  ReservationInput,
  SalesRecord,
} from './types';
import { getProfileByType } from './presets';

const DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

// カレンダー属性の判定ヘルパー
export function evaluateCalendarModifier(
  dateStr: string,
  weather?: 'sunny' | 'cloudy' | 'rainy' | 'storm'
): CalendarModifier {
  const d = new Date(dateStr);
  const dayOfWeek = d.getDay(); // 0: Sun, 6: Sat
  const dayOfMonth = d.getDate();
  const month = d.getMonth() + 1; // 1-12

  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  // 五十日 (5, 10, 15, 20, 25, 30) or 給料日(25日)
  const isPayday = dayOfMonth === 25;
  const isGotobi = [5, 10, 15, 20, 25, 30].includes(dayOfMonth);
  const isPaydayOrGotobi = isPayday || isGotobi;

  // 金曜・土曜は休前日扱い
  const isDayBeforeHoliday = dayOfWeek === 5 || dayOfWeek === 6;

  // 簡易的な連休・季節特需判定 (GW: 4/29-5/6, お盆: 8/12-8/16, 年末年始: 12/28-1/4)
  let isConsecutiveHoliday = false;
  if (
    (month === 4 && dayOfMonth >= 29) ||
    (month === 5 && dayOfMonth <= 6) ||
    (month === 8 && dayOfMonth >= 12 && dayOfMonth <= 16) ||
    (month === 12 && dayOfMonth >= 28) ||
    (month === 1 && dayOfMonth <= 4)
  ) {
    isConsecutiveHoliday = true;
  }

  // 天候係数
  let weatherMultiplier = 1.0;
  if (weather === 'cloudy') weatherMultiplier = 0.98;
  else if (weather === 'rainy') weatherMultiplier = 0.85;
  else if (weather === 'storm') weatherMultiplier = 0.60;

  // 総合補正倍率の計算
  let salesMultiplier = 1.0;

  // 給料日・五十日ブースト
  if (isPayday) {
    salesMultiplier *= 1.18; // 給料日は+18%
  } else if (isGotobi) {
    salesMultiplier *= 1.05; // 五十日は+5%
  }

  // 休前日夜需要ブースト
  if (isDayBeforeHoliday) {
    salesMultiplier *= 1.10;
  }

  // 連休ブースト
  if (isConsecutiveHoliday) {
    salesMultiplier *= 1.15;
  }

  // 天候補正適用
  salesMultiplier *= weatherMultiplier;

  return {
    is_weekend: isWeekend,
    is_payday_or_gotobi: isPaydayOrGotobi,
    is_day_before_holiday: isDayBeforeHoliday,
    is_consecutive_holiday: isConsecutiveHoliday,
    weather_multiplier: weatherMultiplier,
    total_sales_multiplier: Math.max(0.1, Number(salesMultiplier.toFixed(3))),
  };
}

// 4週同曜日 加重移動平均（WMA）＆ 外れ値クリッピング
export function calculateWeightedMovingAverage(
  historicalSales: SalesRecord[],
  targetDayOfWeek: number
): { wmaSales: number; wmaCustomers: number; validWeeksCount: number } {
  // 同曜日の実績を日付降順（新しい順）で抽出
  const sameDayRecords = historicalSales
    .filter((r) => {
      const d = new Date(r.date);
      return d.getDay() === targetDayOfWeek;
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 4); // 直近最大4週

  if (sameDayRecords.length === 0) {
    return { wmaSales: 0, wmaCustomers: 0, validWeeksCount: 0 };
  }

  // 外れ値フィルタリング・クリッピング
  const rawSales = sameDayRecords.map((r) => r.total_sales);
  const avgSales = rawSales.reduce((a, b) => a + b, 0) / rawSales.length;

  const weights = [0.4, 0.3, 0.2, 0.1];
  let totalWeight = 0;
  let weightedSalesSum = 0;
  let weightedCustSum = 0;

  sameDayRecords.forEach((record, index) => {
    let sales = record.total_sales;
    let cust = record.customer_count;

    // 外れ値判定 (手動フラグ or 平均から±60%超または悪天候)
    const isAbnormal =
      record.is_outlier ||
      record.weather === 'storm' ||
      sales > avgSales * 1.6 ||
      sales < avgSales * 0.4;

    if (isAbnormal) {
      // 平均値の±30%以内にクリッピングして正規化
      sales = Math.max(avgSales * 0.7, Math.min(avgSales * 1.3, sales));
      cust = Math.max(1, Math.round((sales / (record.total_sales || 1)) * cust));
    }

    const w = weights[index] || 0.1;
    totalWeight += w;
    weightedSalesSum += sales * w;
    weightedCustSum += cust * w;
  });

  const normalizedWmaSales = totalWeight > 0 ? weightedSalesSum / totalWeight : 0;
  const normalizedWmaCust = totalWeight > 0 ? weightedCustSum / totalWeight : 0;

  return {
    wmaSales: Math.max(0, Math.round(normalizedWmaSales)),
    wmaCustomers: Math.max(0, Math.round(normalizedWmaCust)),
    validWeeksCount: sameDayRecords.length,
  };
}

// 単一日の売上・客数および24時間需要予測を計算
export function predictDayDemand(
  profile: BusinessTypeProfile,
  dateStr: string,
  dayOffset: number,
  historicalSales: SalesRecord[] = [],
  dayReservations: ReservationInput[] = [],
  targetLaborProductivity?: number,
  weather?: 'sunny' | 'cloudy' | 'rainy' | 'storm',
  averageHourlyWage: number = 1150
): DailyForecast {
  const d = new Date(dateStr);
  const dayOfWeek = d.getDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  const calendarMod = evaluateCalendarModifier(dateStr, weather);

  // 1. 4値プリセット（Prior）の計算
  const lunchPreset = isWeekend ? profile.presets.weekend_lunch : profile.presets.weekday_lunch;
  const dinnerPreset = isWeekend ? profile.presets.weekend_dinner : profile.presets.weekday_dinner;

  const priorSales =
    lunchPreset.customers * lunchPreset.avg_spend + dinnerPreset.customers * dinnerPreset.avg_spend;
  const priorCustomers = lunchPreset.customers + dinnerPreset.customers;

  // 2. 過去実績からの尤度（Likelihood）
  const { wmaSales, wmaCustomers, validWeeksCount } = calculateWeightedMovingAverage(
    historicalSales,
    dayOfWeek
  );

  // 3. 階層ベイズ更新 (実績数に応じたPriorとLikelihoodのブレンド)
  // 実績が0件ならPrior 100%, 4件揃えば実績 85% + Prior 15%
  const actualWeight = Math.min(0.85, validWeeksCount * 0.2125);
  const priorWeight = 1 - actualWeight;

  const blendedBaseSales =
    validWeeksCount > 0 ? wmaSales * actualWeight + priorSales * priorWeight : priorSales;
  const blendedBaseCust =
    validWeeksCount > 0 ? wmaCustomers * actualWeight + priorCustomers * priorWeight : priorCustomers;

  // 4. カレンダー4属性 & 天候補正適用
  const adjustedTotalSales = Math.max(0, Math.round(blendedBaseSales * calendarMod.total_sales_multiplier));
  const adjustedTotalCust = Math.max(0, Math.round(blendedBaseCust * calendarMod.total_sales_multiplier));

  // 5. トップダウン時間分解 (24時間スロット)
  const hourlyDist = isWeekend
    ? profile.weekend_hourly_distribution
    : profile.weekday_hourly_distribution;

  const targetLp = targetLaborProductivity || profile.default_target_labor_productivity;

  const hourlyForecasts: HourlyForecast[] = [];
  let dayTotalLaborHours = 0;

  for (let h = 0; h < 24; h++) {
    const ratio = hourlyDist[h] || 0;
    const isOperatingHour = h >= profile.open_hour && h < profile.close_hour;

    // 時間帯フリー客予測
    const baseHourSales = Math.round(adjustedTotalSales * ratio);
    const baseHourCustomers = Math.round(adjustedTotalCust * ratio);

    // 確定予約の集約
    const hourRes = dayReservations.filter((r) => r.hour === h);
    const reservedCust = hourRes.reduce((sum, r) => sum + r.guest_count, 0);
    const reservedSales = hourRes.reduce(
      (sum, r) => sum + r.guest_count * (r.course_price || dinnerPreset.avg_spend),
      0
    );

    const hourSales = Math.max(0, baseHourSales + reservedSales);
    const hourCustomers = Math.max(0, baseHourCustomers + reservedCust);

    // 2層構造の必要人数マッピング
    // Layer 1: 固定アンカー人数
    let fixedStaff = 0;
    // 開店前1時間の仕込み
    if (h === Math.max(0, profile.open_hour - 1) && profile.fixed_labor_settings.prep_hours > 0) {
      fixedStaff = Math.max(fixedStaff, Math.ceil(profile.fixed_labor_settings.prep_hours));
    }
    // 閉店後1時間の締め
    if (h === profile.close_hour && profile.fixed_labor_settings.closing_hours > 0) {
      fixedStaff = Math.max(fixedStaff, Math.ceil(profile.fixed_labor_settings.closing_hours));
    }
    // 営業時間中の最低防犯枠
    if (isOperatingHour) {
      fixedStaff = Math.max(fixedStaff, profile.fixed_labor_settings.min_operating_staff);
    }

    // Layer 2: 売上・予約変動枠
    let variableStaff = 0;
    if (isOperatingHour && hourSales > 0) {
      // 売上基準の必要工数 (人時)
      const salesLaborHours = hourSales / targetLp;
      // 確定予約客あたりの追加工数
      const reservationExtraHours =
        (reservedCust * (profile.fixed_labor_settings.labor_minutes_per_reserved_guest || 0)) / 60;

      const totalNeededLaborHours = salesLaborHours + reservationExtraHours;
      // 固定アンカー枠でカバーしきれない分が変動枠
      variableStaff = Math.max(0, Number((totalNeededLaborHours - fixedStaff).toFixed(1)));
    }

    const recommendedStaff = Math.max(
      0,
      isOperatingHour || fixedStaff > 0 ? Math.ceil(fixedStaff + variableStaff) : 0
    );

    dayTotalLaborHours += recommendedStaff;

    hourlyForecasts.push({
      hour: h,
      predicted_sales: hourSales,
      predicted_customers: hourCustomers,
      free_customers: baseHourCustomers,
      reserved_customers: reservedCust,
      fixed_staff: fixedStaff,
      variable_staff: variableStaff,
      recommended_staff: recommendedStaff,
    });
  }

  // 想定人件費 & 人件費率
  const estimatedLaborCost = Math.round(dayTotalLaborHours * averageHourlyWage);
  const estimatedLaborCostRatio =
    adjustedTotalSales > 0
      ? Number(((estimatedLaborCost / adjustedTotalSales) * 100).toFixed(1))
      : 0;

  return {
    date: dateStr,
    day_offset: dayOffset,
    day_of_week: dayOfWeek,
    day_of_week_label: DAY_LABELS[dayOfWeek],
    total_sales: adjustedTotalSales,
    total_customers: adjustedTotalCust,
    target_labor_productivity: targetLp,
    total_recommended_labor_hours: dayTotalLaborHours,
    estimated_labor_cost: estimatedLaborCost,
    estimated_labor_cost_ratio: estimatedLaborCostRatio,
    modifiers: calendarMod,
    hourly: hourlyForecasts,
  };
}

// 期間全体の予測実行
export function generateDemandForecast(request: ForecastRequest): ForecastResult {
  const profile = request.business_profile || getProfileByType('izakaya');
  const startDate = new Date(request.start_date);
  const days = request.days || 7;

  const dailyForecasts: DailyForecast[] = [];

  for (let i = 0; i < days; i++) {
    const targetDate = new Date(startDate);
    targetDate.setDate(startDate.getDate() + i);
    const dateStr = targetDate.toISOString().split('T')[0];

    const dayRes = (request.reservations || []).filter((r) => r.date === dateStr);
    const weather = request.weather_forecast?.[dateStr] || 'sunny';

    const dayForecast = predictDayDemand(
      profile,
      dateStr,
      i,
      request.historical_sales || [],
      dayRes,
      request.target_labor_productivity,
      weather,
      request.average_hourly_wage
    );
    dailyForecasts.push(dayForecast);
  }

  const totalSales = dailyForecasts.reduce((sum, d) => sum + d.total_sales, 0);
  const totalCustomers = dailyForecasts.reduce((sum, d) => sum + d.total_customers, 0);
  const totalLaborHours = dailyForecasts.reduce(
    (sum, d) => sum + d.total_recommended_labor_hours,
    0
  );

  const avgLp = totalLaborHours > 0 ? Math.round(totalSales / totalLaborHours) : 0;
  const totalLaborCost = dailyForecasts.reduce((sum, d) => sum + d.estimated_labor_cost, 0);
  const avgCostRatio =
    totalSales > 0 ? Number(((totalLaborCost / totalSales) * 100).toFixed(1)) : 0;

  // ピーク時間帯の抽出
  let peakHourSales = 0;
  let peakHourLabel = '19:00';
  dailyForecasts.forEach((d) => {
    d.hourly.forEach((h) => {
      if (h.predicted_sales > peakHourSales) {
        peakHourSales = h.predicted_sales;
        peakHourLabel = `${d.day_of_week_label}曜 ${h.hour}:00`;
      }
    });
  });

  return {
    business_type: profile.id,
    start_date: request.start_date,
    days,
    daily_forecasts: dailyForecasts,
    summary: {
      total_sales: totalSales,
      total_customers: totalCustomers,
      total_labor_hours: totalLaborHours,
      average_labor_productivity: avgLp,
      average_labor_cost_ratio: avgCostRatio,
      peak_hour_sales: peakHourSales,
      peak_hour_label: peakHourLabel,
    },
  };
}
