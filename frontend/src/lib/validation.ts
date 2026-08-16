// フロントエンドUI防壁・バリデーションユーティリティ
// docs/DISASTER_CHECKLIST_300.md の現場誤用・入力ミス防御用

import { StaffMember, ShiftRequirement } from './types';

/**
 * 全角数字・全角記号を半角に変換し、カンマを除去して数値化する
 * No. 210: 時給に全角「１，２００」を入力などの事故を完全防止
 */
export function normalizeNumberInput(value: string | number, defaultValue: number = 0): number {
  if (typeof value === 'number') {
    return isNaN(value) ? defaultValue : value;
  }

  if (!value || typeof value !== 'string') {
    return defaultValue;
  }

  // 1. 全角数字 (０-９) を半角 (0-9) に変換
  let normalized = value.replace(/[０-９]/g, (ch) => {
    return String.fromCharCode(ch.charCodeAt(0) - 0xfee0);
  });

  // 2. 全角カンマ (，)・半角カンマ (,)・全角スペース・半角スペースを除去
  normalized = normalized.replace(/[，,\s]/g, '');

  // 3. 全角ピリオド (．) を半角ピリオド (.) に変換
  normalized = normalized.replace(/．/g, '.');

  // 4. 全角マイナス (ー, −, ―) を半角 (-) に変換
  normalized = normalized.replace(/[ー−―]/g, '-');

  const parsed = Number(normalized);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * 入力文字列から全角数字・カンマを半角整形した文字列を返す
 */
export function toHalfWidthNumberString(value: string): string {
  if (!value) return '';
  return value
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[，,]/g, '')
    .replace(/．/g, '.')
    .replace(/[ー−―]/g, '-')
    .trim();
}

/**
 * 時給バリデーション (No. 202: 800円〜10,000円)
 */
export const MIN_HOURLY_WAGE = 800;
export const MAX_HOURLY_WAGE = 10000;

export function validateHourlyWage(wage: number): { isValid: boolean; error?: string } {
  if (isNaN(wage) || wage < MIN_HOURLY_WAGE) {
    return {
      isValid: false,
      error: `時給は地域別最低賃金を考慮し、${MIN_HOURLY_WAGE}円以上で設定してください。`,
    };
  }
  if (wage > MAX_HOURLY_WAGE) {
    return {
      isValid: false,
      error: `時給は上限${MAX_HOURLY_WAGE.toLocaleString()}円以下で設定してください。`,
    };
  }
  return { isValid: true };
}

/**
 * 生年月日 (YYYY-MM-DD) から満年齢を正確に計算する (No. 204, No. 261)
 * 基準日時点での年齢（誕生日前は-1）
 */
export function calculateAge(birthDateStr: string, referenceDate: Date = new Date()): number | null {
  if (!birthDateStr || !/^\d{4}-\d{2}-\d{2}$/.test(birthDateStr)) {
    return null;
  }

  const [bYear, bMonth, bDay] = birthDateStr.split('-').map(Number);
  const refYear = referenceDate.getFullYear();
  const refMonth = referenceDate.getMonth() + 1; // 1-12
  const refDay = referenceDate.getDate();

  let age = refYear - bYear;
  if (refMonth < bMonth || (refMonth === bMonth && refDay < bDay)) {
    age -= 1;
  }

  return age >= 0 ? age : null;
}

/**
 * 生年月日から満18歳未満（年少者）かを自動判定
 */
export function isMinorFromBirthDate(birthDateStr: string, referenceDate: Date = new Date()): boolean {
  const age = calculateAge(birthDateStr, referenceDate);
  if (age === null) return false;
  return age < 18;
}

/**
 * スタッフ氏名の重複チェック (No. 211: 全員「アルバイト」と同名登録で混乱を防止)
 */
export function checkDuplicateStaffName(
  name: string,
  staffList: StaffMember[],
  currentStaffId?: string
): { isDuplicate: boolean; warning?: string } {
  const trimmed = name.trim().toLowerCase();
  if (!trimmed) return { isDuplicate: false };

  const duplicate = staffList.find(
    (s) => s.id !== currentStaffId && s.name.trim().toLowerCase() === trimmed
  );

  if (duplicate) {
    return {
      isDuplicate: true,
      warning: `同姓同名のスタッフ「${duplicate.name}」が既に登録されています。区別のため「山田(キッチン)」や「山田A」のように表記を分けることを推奨します。`,
    };
  }

  return { isDuplicate: false };
}

/**
 * 必要人数の合計チェック (No. 201: 必要人数が全員0名で全員休み事故防止)
 */
export function checkTotalRequiredStaff(requirements: ShiftRequirement[]): {
  totalRequired: number;
  isZero: boolean;
  warning?: string;
} {
  const total = requirements.reduce((sum, r) => sum + (r.min_staff || 0), 0);
  if (total === 0) {
    return {
      totalRequired: 0,
      isZero: true,
      warning: 'シフト期間中の必要人数が合計0名です。最低1枠以上に必要人数を設定してください。',
    };
  }
  return { totalRequired: total, isZero: false };
}

/**
 * 必須ロール保有者の存在チェック (No. 208: 必須資格ロール保有者0名による求解不能防止)
 */
export function checkMissingRequiredRoles(
  requirements: ShiftRequirement[],
  staffList: StaffMember[]
): { missingRoles: string[]; warnings: string[] } {
  const activeStaff = staffList.filter((s) => s.is_active !== false);
  const availableRoles = new Set<string>();
  activeStaff.forEach((s) => s.roles.forEach((r) => availableRoles.add(r)));

  const demandedRoles = new Set<string>();
  requirements.forEach((req) => {
    if (req.required_roles) {
      Object.entries(req.required_roles).forEach(([role, count]) => {
        if (count > 0) {
          demandedRoles.add(role);
        }
      });
    }
  });

  const missingRoles: string[] = [];
  const warnings: string[] = [];

  demandedRoles.forEach((role) => {
    if (!availableRoles.has(role)) {
      missingRoles.push(role);
      warnings.push(
        `必須ロール「${role}」を保有する在籍スタッフが0名です。スタッフマスタで該当ロールを割り当てるか、必要ロール設定を解除してください。`
      );
    }
  });

  return { missingRoles, warnings };
}

/**
 * 人時売上高のバリデーション (No. 252: 1,000円〜20,000円/h)
 */
export const MIN_SALES_PER_HOUR = 1000;
export const MAX_SALES_PER_HOUR = 20000;

export function validateSalesPerHour(sales: number): { isValid: boolean; error?: string } {
  if (sales < MIN_SALES_PER_HOUR || sales > MAX_SALES_PER_HOUR) {
    return {
      isValid: false,
      error: `人時売上高目標は ${MIN_SALES_PER_HOUR.toLocaleString()}円 〜 ${MAX_SALES_PER_HOUR.toLocaleString()}円 の範囲で設定してください。`,
    };
  }
  return { isValid: true };
}
