import { HourlyRequirement, ShiftOptimizeRequest, ShiftRequirement, StaffHourlyAvailability } from './types';

// 1時間単位の必要人数山谷（10時〜24時）
export const generateHourlyRequirements = (days: number): HourlyRequirement[] => {
  const reqs: HourlyRequirement[] = [];
  // 平日と休日の時間帯別必要人数パターン
  const weekdayPattern: Record<number, number> = {
    10: 2, 11: 3, 12: 5, 13: 4, 14: 2, // ランチ山谷
    15: 1, 16: 1, // アイドル
    17: 2, 18: 4, 19: 6, 20: 6, 21: 5, 22: 3, 23: 2, // ディナー山谷
  };
  const weekendPattern: Record<number, number> = {
    10: 3, 11: 5, 12: 7, 13: 6, 14: 4,
    15: 2, 16: 3,
    17: 4, 18: 6, 19: 8, 20: 8, 21: 6, 22: 4, 23: 2,
  };

  for (let d = 0; d < days; d++) {
    const isWeekend = (d % 7 === 4) || (d % 7 === 5); // 金・土
    const pattern = isWeekend ? weekendPattern : weekdayPattern;
    for (let h = 0; h < 24; h++) {
      const min_staff = pattern[h] || 0;
      if (min_staff > 0) {
        reqs.push({
          day_offset: d,
          hour: h,
          min_staff,
        });
      }
    }
  }
  return reqs;
};

// スタッフごとの出勤可能時間帯希望データ生成
export const generateHourlyAvailabilities = (days: number): StaffHourlyAvailability[] => {
  const avails: StaffHourlyAvailability[] = [];
  const staffPatterns: Record<string, { from: number; to: number; daysOff: number[] }> = {
    emp_01: { from: 10, to: 24, daysOff: [2, 9] }, // 社員店長 (水曜休)
    emp_02: { from: 10, to: 24, daysOff: [3, 10] }, // 社員副店長 (木曜休)
    emp_03: { from: 10, to: 16, daysOff: [0, 6, 7, 13] }, // フリーター昼
    emp_04: { from: 17, to: 24, daysOff: [1, 8] }, // フリーター夜
    emp_05: { from: 17, to: 23, daysOff: [2, 4, 9, 11] }, // 学生夜
    emp_06: { from: 18, to: 24, daysOff: [0, 3, 7, 10] }, // 学生夜
    emp_07: { from: 10, to: 15, daysOff: [5, 6, 12, 13] }, // パート主婦
    emp_08: { from: 10, to: 15, daysOff: [0, 6, 7, 13] }, // パート主婦
    emp_09: { from: 17, to: 22, daysOff: [1, 3, 8, 10] }, // 高校生 (22時まで)
    emp_10: { from: 17, to: 22, daysOff: [2, 4, 9, 11] }, // 高校生 (22時まで)
    emp_11: { from: 17, to: 24, daysOff: [3, 5, 10, 12] }, // 留学生 (週28h)
    emp_12: { from: 11, to: 16, daysOff: [1, 4, 8, 11] }, // シニア
    emp_13: { from: 18, to: 24, daysOff: [0, 2, 7, 9] }, // Wワーク
    emp_14: { from: 18, to: 24, daysOff: [1, 5, 8, 12] }, // 新人
    emp_15: { from: 17, to: 23, daysOff: [0, 4, 7, 11] }, // 新人
  };

  for (let d = 0; d < days; d++) {
    Object.entries(staffPatterns).forEach(([staffId, p]) => {
      const isOff = p.daysOff.includes(d);
      avails.push({
        staff_id: staffId,
        day_offset: d,
        available_from: p.from,
        available_to: p.to,
        is_available: !isOff,
        is_preferred: !isOff && (d % 3 === 0),
      });
    });
  }
  return avails;
};

// デモ用居酒屋（15人×14日×3シフト）プリセットデータ
export const DEMO_IZAKAYA_DATA: ShiftOptimizeRequest = {
  period: {
    start_date: '2026-09-01',
    days: 14,
  },
  shifts: [
    {
      id: 'morning',
      name: '仕込み・ランチ',
      start: '10:00',
      end: '15:00',
      hours: 5.0,
      is_late_night: false,
      break_minutes: 0,
      min_interval_hours: 11,
    },
    {
      id: 'dinner',
      name: 'ディナーピーク',
      start: '17:00',
      end: '22:00',
      hours: 5.0,
      is_late_night: false,
      break_minutes: 45,
      min_interval_hours: 11,
    },
    {
      id: 'late_night',
      name: '深夜・締め作業',
      start: '21:30',
      end: '24:30',
      hours: 3.0,
      is_late_night: true,
      break_minutes: 0,
      min_interval_hours: 11,
    },
  ],
  staff_members: [
    {
      id: 'emp_01',
      name: '佐藤 店長 (社員)',
      is_minor: false,
      roles: ['kitchen_leader', 'hall'],
      hourly_wage: 1500,
      max_weekly_hours: 45.0,
      target_weekly_hours: 40.0,
      max_consecutive_days: 6,
      min_days_per_period: 8,
      max_days_per_period: 12,
      annual_earnings_ytd: 2400000,
    },
    {
      id: 'emp_02',
      name: '田中 副店長 (社員)',
      is_minor: false,
      roles: ['kitchen_leader', 'hall_leader'],
      hourly_wage: 1400,
      max_weekly_hours: 45.0,
      target_weekly_hours: 40.0,
      max_consecutive_days: 6,
      min_days_per_period: 8,
      max_days_per_period: 12,
      annual_earnings_ytd: 2100000,
    },
    {
      id: 'emp_03',
      name: '高橋 (フリーター/キッチン)',
      is_minor: false,
      roles: ['kitchen_leader'],
      hourly_wage: 1250,
      max_weekly_hours: 40.0,
      target_weekly_hours: 35.0,
      max_consecutive_days: 5,
      min_days_per_period: 6,
      max_days_per_period: 10,
      annual_earnings_ytd: 1150000,
      tax_wall: 1300000,
    },
    {
      id: 'emp_04',
      name: '渡辺 (フリーター/ホール)',
      is_minor: false,
      roles: ['hall_leader', 'hall'],
      hourly_wage: 1200,
      max_weekly_hours: 35.0,
      target_weekly_hours: 30.0,
      max_consecutive_days: 5,
      min_days_per_period: 6,
      max_days_per_period: 10,
      annual_earnings_ytd: 950000,
      tax_wall: 1300000,
    },
    {
      id: 'emp_05',
      name: '伊藤 (大4/ホールリーダー)',
      is_minor: false,
      roles: ['hall_leader', 'hall'],
      hourly_wage: 1200,
      max_weekly_hours: 30.0,
      target_weekly_hours: 25.0,
      max_consecutive_days: 4,
      min_days_per_period: 4,
      max_days_per_period: 8,
      annual_earnings_ytd: 820000,
      tax_wall: 1030000,
    },
    {
      id: 'emp_06',
      name: '山本 (大3/キッチン)',
      is_minor: false,
      roles: ['kitchen'],
      hourly_wage: 1150,
      max_weekly_hours: 25.0,
      target_weekly_hours: 20.0,
      max_consecutive_days: 4,
      min_days_per_period: 3,
      max_days_per_period: 7,
      preferred_partner_ids: ['emp_07'],
      annual_earnings_ytd: 720000,
      tax_wall: 1030000,
    },
    {
      id: 'emp_07',
      name: '中村 (大3/ホール)',
      is_minor: false,
      roles: ['hall'],
      hourly_wage: 1150,
      max_weekly_hours: 25.0,
      target_weekly_hours: 20.0,
      max_consecutive_days: 4,
      min_days_per_period: 3,
      max_days_per_period: 7,
      preferred_partner_ids: ['emp_06'],
      annual_earnings_ytd: 680000,
      tax_wall: 1030000,
    },
    {
      id: 'emp_08',
      name: '小林 (大2/ホール)',
      is_minor: false,
      roles: ['hall'],
      hourly_wage: 1100,
      max_weekly_hours: 20.0,
      target_weekly_hours: 15.0,
      max_consecutive_days: 3,
      min_days_per_period: 2,
      max_days_per_period: 6,
      ng_staff_ids: ['emp_09'], // NGペア設定例
      annual_earnings_ytd: 590000,
      tax_wall: 1030000,
    },
    {
      id: 'emp_09',
      name: '加藤 (大2/キッチン)',
      is_minor: false,
      roles: ['kitchen'],
      hourly_wage: 1100,
      max_weekly_hours: 20.0,
      target_weekly_hours: 15.0,
      max_consecutive_days: 3,
      min_days_per_period: 2,
      max_days_per_period: 6,
      ng_staff_ids: ['emp_08'], // NGペア設定例
      annual_earnings_ytd: 620000,
      tax_wall: 1030000,
    },
    {
      id: 'emp_10',
      name: '吉田 (大1/ホール新人)',
      is_minor: false,
      roles: ['hall'],
      hourly_wage: 1100,
      max_weekly_hours: 15.0,
      target_weekly_hours: 12.0,
      max_consecutive_days: 3,
      min_days_per_period: 2,
      max_days_per_period: 5,
      annual_earnings_ytd: 380000,
      tax_wall: 1030000,
    },
    {
      id: 'emp_11',
      name: '山田 (大1/キッチン新人)',
      is_minor: false,
      roles: ['kitchen'],
      hourly_wage: 1100,
      max_weekly_hours: 15.0,
      target_weekly_hours: 12.0,
      max_consecutive_days: 3,
      min_days_per_period: 2,
      max_days_per_period: 5,
      annual_earnings_ytd: 410000,
      tax_wall: 1030000,
    },
    {
      id: 'emp_12',
      name: '佐々木 (主婦パート/昼)',
      is_minor: false,
      roles: ['kitchen', 'hall'],
      hourly_wage: 1150,
      max_weekly_hours: 20.0,
      target_weekly_hours: 15.0,
      max_consecutive_days: 4,
      min_days_per_period: 3,
      max_days_per_period: 6,
      annual_earnings_ytd: 840000,
      tax_wall: 1030000,
    },
    {
      id: 'emp_13',
      name: '松本 (主婦パート/昼)',
      is_minor: false,
      roles: ['kitchen'],
      hourly_wage: 1150,
      max_weekly_hours: 20.0,
      target_weekly_hours: 15.0,
      max_consecutive_days: 4,
      min_days_per_period: 3,
      max_days_per_period: 6,
      annual_earnings_ytd: 790000,
      tax_wall: 1030000,
    },
    {
      id: 'emp_14',
      name: '井上 (高校生/17歳)',
      is_minor: true, // 年少者: 深夜22時以降禁止
      roles: ['hall'],
      hourly_wage: 1050,
      max_weekly_hours: 15.0,
      target_weekly_hours: 10.0,
      max_consecutive_days: 3,
      min_days_per_period: 2,
      max_days_per_period: 4,
      annual_earnings_ytd: 450000,
      tax_wall: 1030000,
    },
    {
      id: 'emp_15',
      name: '木村 (高校生/16歳)',
      is_minor: true, // 年少者: 深夜22時以降禁止
      roles: ['hall'],
      hourly_wage: 1050,
      max_weekly_hours: 15.0,
      target_weekly_hours: 10.0,
      max_consecutive_days: 3,
      min_days_per_period: 2,
      max_days_per_period: 4,
      annual_earnings_ytd: 380000,
      tax_wall: 1030000,
    },
  ],
  requirements: Array.from({ length: 14 }, (_, day_offset): ShiftRequirement[] => [
    {
      day_offset,
      shift_id: 'morning',
      min_staff: 2,
      required_roles: { kitchen: 1 },
    },
    {
      day_offset,
      shift_id: 'dinner',
      min_staff: day_offset % 7 >= 4 ? 4 : 3, // 金土日は4名
      required_roles: { kitchen_leader: 1, hall: 1 },
    },
    {
      day_offset,
      shift_id: 'late_night',
      min_staff: 2,
      required_roles: {},
    },
  ]).flat(),
  availabilities: [
    // 高校生は深夜不可、ランチやディナー希望
    { staff_id: 'emp_14', day_offset: 0, shift_id: 'dinner', status: 'want' },
    { staff_id: 'emp_14', day_offset: 0, shift_id: 'late_night', status: 'unavailable' },
    { staff_id: 'emp_15', day_offset: 1, shift_id: 'dinner', status: 'want' },
    { staff_id: 'emp_15', day_offset: 1, shift_id: 'late_night', status: 'unavailable' },
    // 主婦パートはランチ希望
    { staff_id: 'emp_12', day_offset: 0, shift_id: 'morning', status: 'want' },
    { staff_id: 'emp_13', day_offset: 1, shift_id: 'morning', status: 'want' },
  ],
};
