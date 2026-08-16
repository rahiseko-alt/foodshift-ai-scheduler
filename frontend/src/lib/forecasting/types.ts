// 売上・需要予測エンジン 型定義

export type BusinessType = 'izakaya' | 'ramen' | 'cafe' | 'family_restaurant' | 'custom';

export type DaypartType = 'weekday_lunch' | 'weekday_dinner' | 'weekend_lunch' | 'weekend_dinner';

export interface DaypartMetric {
  customers: number; // 想定客数 (人)
  avg_spend: number; // 客単価 (円)
}

export interface FourValuePreset {
  weekday_lunch: DaypartMetric;
  weekday_dinner: DaypartMetric;
  weekend_lunch: DaypartMetric;
  weekend_dinner: DaypartMetric;
}

export interface BusinessTypeProfile {
  id: BusinessType;
  name: string;
  description: string;
  presets: FourValuePreset;
  // 0時〜23時の客数分布比率 (合計1.0)
  weekday_hourly_distribution: Record<number, number>;
  weekend_hourly_distribution: Record<number, number>;
  default_target_labor_productivity: number; // 目標人時売上高 (円/人時, 例: 5500)
  fixed_labor_settings: {
    prep_hours: number; // 開店前仕込み時間 (人時)
    closing_hours: number; // 閉店後締め時間 (人時)
    min_operating_staff: number; // 営業中最低防犯人数 (例: 2人)
    labor_minutes_per_reserved_guest: number; // 確定予約客1人あたりの追加工数 (分)
  };
  open_hour: number; // 営業開始時刻 (0-23)
  close_hour: number; // 営業終了時刻 (0-23)
}

export interface SalesRecord {
  date: string; // YYYY-MM-DD
  total_sales: number;
  customer_count: number;
  hourly_sales?: Record<number, number>;
  hourly_customers?: Record<number, number>;
  weather?: 'sunny' | 'cloudy' | 'rainy' | 'storm';
  is_outlier?: boolean;
  notes?: string;
}

export interface ReservationInput {
  date: string; // YYYY-MM-DD
  hour: number; // 0-23
  guest_count: number; // 予約人数
  course_price?: number; // コース単価（任意）
}

export interface HourlyForecast {
  hour: number; // 0-23
  predicted_sales: number; // 予測売上 (円)
  predicted_customers: number; // 予測総客数 (人)
  free_customers: number; // フリー客数 (人)
  reserved_customers: number; // 予約客数 (人)
  fixed_staff: number; // 固定アンカー人数 (仕込み/締め/最低防犯)
  variable_staff: number; // 変動人数 (売上・客数工数から算出)
  recommended_staff: number; // 推奨必要人数 (fixed + variable)
}

export interface CalendarModifier {
  is_weekend: boolean;
  is_payday_or_gotobi: boolean; // 給料日(25日)・五十日(5/10/15/20/30)
  is_day_before_holiday: boolean; // 祝日前日 / 金曜土曜
  is_consecutive_holiday: boolean; // 3連休以上・GW・お盆
  weather_multiplier: number; // 天候影響係数 (晴れ: 1.0, 雨: 0.85 など)
  total_sales_multiplier: number; // 総合補正倍率
}

export interface DailyForecast {
  date: string; // YYYY-MM-DD
  day_offset: number;
  day_of_week: number; // 0: 日, 1: 月, ..., 6: 土
  day_of_week_label: string; // '月', '火', ...
  total_sales: number;
  total_customers: number;
  target_labor_productivity: number; // 設定された目標人時売上高 (円)
  total_recommended_labor_hours: number; // 総必要人時 (時間)
  estimated_labor_cost: number; // 想定人件費 (平均時給換算)
  estimated_labor_cost_ratio: number; // 想定人件費率 (%)
  modifiers: CalendarModifier;
  hourly: HourlyForecast[];
}

export interface ForecastRequest {
  business_profile: BusinessTypeProfile;
  start_date: string; // YYYY-MM-DD
  days: number;
  historical_sales?: SalesRecord[]; // 過去実績 (4週分等)
  reservations?: ReservationInput[]; // 確定予約
  target_labor_productivity?: number; // 目標人時売上高 (未指定時はプロファイルデフォルト)
  average_hourly_wage?: number; // 人件費計算用平均時給 (デフォルト: 1150円)
  weather_forecast?: Record<string, 'sunny' | 'cloudy' | 'rainy' | 'storm'>;
}

export interface ForecastResult {
  business_type: BusinessType;
  start_date: string;
  days: number;
  daily_forecasts: DailyForecast[];
  summary: {
    total_sales: number;
    total_customers: number;
    total_labor_hours: number;
    average_labor_productivity: number;
    average_labor_cost_ratio: number;
    peak_hour_sales: number;
    peak_hour_label: string;
  };
}

export interface ShiftSlotLaborRequirement {
  day_offset: number;
  shift_id: string;
  shift_name: string;
  start_hour: number;
  end_hour: number;
  calculated_min_staff: number;
  peak_hour_staff: number;
  average_hour_staff: number;
  forecast_sales_in_slot: number;
}
