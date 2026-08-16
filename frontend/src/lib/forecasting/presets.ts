import { BusinessTypeProfile, BusinessType } from './types';

// 24時間分布ヘルパー（比率合計を1.0に正規化）
function normalizeDistribution(raw: Record<number, number>): Record<number, number> {
  const result: Record<number, number> = {};
  let total = 0;
  for (let h = 0; h < 24; h++) {
    const val = raw[h] || 0;
    result[h] = val;
    total += val;
  }
  if (total > 0) {
    for (let h = 0; h < 24; h++) {
      result[h] = Number((result[h] / total).toFixed(4));
    }
  }
  return result;
}

// 1. 居酒屋（夕方〜深夜ピーク、週末は昼呑みや宴会も増加）
export const IZAKAYA_PROFILE: BusinessTypeProfile = {
  id: 'izakaya',
  name: '🏮 居酒屋・大衆酒場',
  description: '18〜22時のディナー・アルコール主体の業態。週末は客単価・予約宴会比率が急上昇。',
  presets: {
    weekday_lunch: { customers: 20, avg_spend: 950 },
    weekday_dinner: { customers: 85, avg_spend: 3800 },
    weekend_lunch: { customers: 35, avg_spend: 1400 },
    weekend_dinner: { customers: 140, avg_spend: 4200 },
  },
  weekday_hourly_distribution: normalizeDistribution({
    11: 0.05,
    12: 0.12,
    13: 0.05,
    14: 0.02,
    17: 0.06,
    18: 0.16,
    19: 0.22,
    20: 0.18,
    21: 0.10,
    22: 0.04,
  }),
  weekend_hourly_distribution: normalizeDistribution({
    12: 0.06,
    13: 0.08,
    14: 0.05,
    15: 0.04,
    16: 0.05,
    17: 0.10,
    18: 0.18,
    19: 0.20,
    20: 0.14,
    21: 0.08,
    22: 0.02,
  }),
  default_target_labor_productivity: 5800, // 目標人時売上高 (円)
  fixed_labor_settings: {
    prep_hours: 2.0, // 開店前仕込み (人時)
    closing_hours: 1.5, // 締め作業 (人時)
    min_operating_staff: 2, // 2名体制（防犯・ホールキッチン分離）
    labor_minutes_per_reserved_guest: 5, // 予約客1名あたり5分の事前セッティング工数
  },
  open_hour: 11,
  close_hour: 23,
};

// 2. ラーメン店（回転率重視、昼と夜の2山ピーク）
export const RAMEN_PROFILE: BusinessTypeProfile = {
  id: 'ramen',
  name: '🍜 ラーメン・中華麺',
  description: '12時台と19時台の2大ピーク。高回転・一定単価で少人数高生産性オペレーション。',
  presets: {
    weekday_lunch: { customers: 95, avg_spend: 980 },
    weekday_dinner: { customers: 75, avg_spend: 1050 },
    weekend_lunch: { customers: 130, avg_spend: 1020 },
    weekend_dinner: { customers: 110, avg_spend: 1100 },
  },
  weekday_hourly_distribution: normalizeDistribution({
    11: 0.08,
    12: 0.25,
    13: 0.18,
    14: 0.06,
    18: 0.10,
    19: 0.16,
    20: 0.11,
    21: 0.06,
  }),
  weekend_hourly_distribution: normalizeDistribution({
    11: 0.10,
    12: 0.22,
    13: 0.20,
    14: 0.10,
    15: 0.04,
    18: 0.10,
    19: 0.14,
    20: 0.07,
    21: 0.03,
  }),
  default_target_labor_productivity: 6500,
  fixed_labor_settings: {
    prep_hours: 2.5, // スープ仕込み等
    closing_hours: 1.0,
    min_operating_staff: 2,
    labor_minutes_per_reserved_guest: 0,
  },
  open_hour: 11,
  close_hour: 22,
};

// 3. カフェ・ベーカリー（昼前後〜アフタヌーンティーピーク、夜は落ち着く）
export const CAFE_PROFILE: BusinessTypeProfile = {
  id: 'cafe',
  name: '☕ カフェ・喫茶',
  description: '11〜16時の昼・カフェタイムが主力。平日・休日の客層変化（ビジネス⇄ファミリー/カップル）。',
  presets: {
    weekday_lunch: { customers: 80, avg_spend: 850 },
    weekday_dinner: { customers: 30, avg_spend: 920 },
    weekend_lunch: { customers: 140, avg_spend: 1100 },
    weekend_dinner: { customers: 55, avg_spend: 1050 },
  },
  weekday_hourly_distribution: normalizeDistribution({
    8: 0.06,
    9: 0.07,
    10: 0.06,
    11: 0.10,
    12: 0.18,
    13: 0.15,
    14: 0.13,
    15: 0.11,
    16: 0.08,
    17: 0.04,
    18: 0.02,
  }),
  weekend_hourly_distribution: normalizeDistribution({
    9: 0.05,
    10: 0.08,
    11: 0.12,
    12: 0.17,
    13: 0.16,
    14: 0.15,
    15: 0.13,
    16: 0.08,
    17: 0.04,
    18: 0.02,
  }),
  default_target_labor_productivity: 5000,
  fixed_labor_settings: {
    prep_hours: 1.5, // ベーキング・仕込み
    closing_hours: 1.0,
    min_operating_staff: 2,
    labor_minutes_per_reserved_guest: 3,
  },
  open_hour: 8,
  close_hour: 19,
};

// 4. ファミリーレストラン（昼・夜ともに大型需要、週末は終日高稼働）
export const FAMILY_RESTAURANT_PROFILE: BusinessTypeProfile = {
  id: 'family_restaurant',
  name: '🍽️ ファミリーレストラン',
  description: 'ランチ・ディナーともに高い客席稼働。週末は家族連れでの団体利用が急増。',
  presets: {
    weekday_lunch: { customers: 110, avg_spend: 1150 },
    weekday_dinner: { customers: 125, avg_spend: 1650 },
    weekend_lunch: { customers: 190, avg_spend: 1400 },
    weekend_dinner: { customers: 210, avg_spend: 1850 },
  },
  weekday_hourly_distribution: normalizeDistribution({
    10: 0.03,
    11: 0.08,
    12: 0.20,
    13: 0.14,
    14: 0.06,
    17: 0.08,
    18: 0.16,
    19: 0.15,
    20: 0.07,
    21: 0.03,
  }),
  weekend_hourly_distribution: normalizeDistribution({
    10: 0.04,
    11: 0.11,
    12: 0.19,
    13: 0.16,
    14: 0.08,
    15: 0.04,
    16: 0.05,
    17: 0.10,
    18: 0.12,
    19: 0.08,
    20: 0.03,
  }),
  default_target_labor_productivity: 5400,
  fixed_labor_settings: {
    prep_hours: 2.0,
    closing_hours: 1.5,
    min_operating_staff: 3, // ホール2＋キッチン1以上
    labor_minutes_per_reserved_guest: 4,
  },
  open_hour: 10,
  close_hour: 22,
};

export const BUSINESS_PROFILES: Record<BusinessType, BusinessTypeProfile> = {
  izakaya: IZAKAYA_PROFILE,
  ramen: RAMEN_PROFILE,
  cafe: CAFE_PROFILE,
  family_restaurant: FAMILY_RESTAURANT_PROFILE,
  custom: {
    ...IZAKAYA_PROFILE,
    id: 'custom',
    name: '⚙️ カスタム設定',
    description: '店舗独自の4値および客数分布を自由に設定します。',
  },
};

export function getProfileByType(type: BusinessType): BusinessTypeProfile {
  return BUSINESS_PROFILES[type] || IZAKAYA_PROFILE;
}
