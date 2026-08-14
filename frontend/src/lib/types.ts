// バックエンド (Pydantic v2) スキーマと完全一致する型定義

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
}

export interface StaffMember {
  id: string;
  name: string;
  is_minor: boolean;
  roles: string[];
  hourly_wage: number;
  max_weekly_hours: number;
  target_weekly_hours: number;
  max_consecutive_days: number;
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

export interface ShiftOptimizeRequest {
  period: Period;
  shifts: Shift[];
  staff_members: StaffMember[];
  requirements: ShiftRequirement[];
  availabilities: StaffAvailability[];
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
}

export interface ShiftOptimizeResponse {
  status: 'OPTIMAL' | 'FEASIBLE_WITH_SHORTAGE' | 'INFEASIBLE' | 'ERROR';
  solve_time_ms: number;
  summary: ScheduleSummary;
  schedule: ScheduledShiftSlot[];
}
