// バックエンド (Pydantic v2) スキーマと完全同期する型定義

export interface Period {
  start_date: string; // YYYY-MM-DD
  days: number;
}

export interface Shift {
  id: string;
  name: string;
  start: string; // HH:MM
  end: string; // HH:MM
  hours: number;
  is_late_night: boolean;
  break_minutes?: number; // 休憩時間 (分)
  min_interval_hours?: number; // 勤務間インターバル (時間)
}

export interface StaffMember {
  id: string;
  name: string;
  is_minor: boolean;
  birth_date?: string; // 生年月日 (YYYY-MM-DD)
  is_student_visa?: boolean; // 留学生フラグ (週28h上限)
  is_pregnant_or_nursing?: boolean; // 母性保護フラグ (妊婦・産後)
  is_active?: boolean; // 在籍中 / 退職・休職フラグ (デフォルト: true)
  age_verified?: boolean; // 年齢確認同意 (No. 204)
  roles: string[];
  hourly_wage: number;
  max_weekly_hours: number;
  target_weekly_hours: number;
  max_consecutive_days: number;
  min_days_per_period?: number;
  max_days_per_period?: number;
  ng_staff_ids?: string[]; // 相性NGスタッフID一覧
  preferred_partner_ids?: string[]; // 同時勤務希望スタッフID一覧
  annual_earnings_ytd?: number; // 今年の累計給与（円）
  tax_wall?: number; // 年収の壁（例: 1030000, 1300000）
}

export interface ShiftRequirement {
  day_offset: number;
  shift_id: string;
  min_staff: number;
  required_roles: Record<string, number>;
}

export type AvailabilityStatus = 'available' | 'want' | 'unavailable';

export interface StaffAvailability {
  staff_id: string;
  day_offset: number;
  shift_id: string;
  status: AvailabilityStatus;
}

export interface FixedAssignment {
  staff_id: string;
  day_offset: number;
  shift_id: string;
}

export interface ShiftOptimizeRequest {
  period: Period;
  shifts: Shift[];
  staff_members: StaffMember[];
  requirements: ShiftRequirement[];
  availabilities: StaffAvailability[];
  min_interval_hours?: number;
  fixed_assignments?: FixedAssignment[];
}

export interface AssignedStaff {
  id: string;
  name: string;
  assigned_role: string;
  hourly_wage: number;
  is_want_fulfilled: boolean;
}

export interface ScheduledShiftSlot {
  date: string;
  day_offset: number;
  shift_id: string;
  assigned_staff: AssignedStaff[];
}

export interface UnfilledRequirement {
  date: string;
  day_offset: number;
  shift_id: string;
  required_count: number;
  assigned_count: number;
  shortage: number;
  reason: string;
}

export interface ScheduleSummary {
  total_labor_cost: number;
  total_work_hours: number;
  wants_fulfillment_rate: number;
  max_staff_day_difference: number;
  unfilled_requirements: UnfilledRequirement[];
  total_break_hours?: number; // 総休憩時間
  deep_night_extra_cost?: number; // 22時以降深夜割増額 (25%)
  bottleneck_constraints?: string[]; // 制約ボトルネック分析
  projected_sales?: number; // 想定売上 (円)
  labor_cost_ratio?: number; // 想定人件費率 (%)
  sales_per_labor_hour?: number; // 人時売上 (円/人時)
}

export interface ShiftOptimizeResponse {
  status: 'OPTIMAL' | 'FEASIBLE_WITH_SHORTAGE' | 'INFEASIBLE' | 'ERROR';
  solve_time_ms: number;
  summary: ScheduleSummary;
  schedule: ScheduledShiftSlot[];
}
