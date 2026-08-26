/**
 * FoodShift LINE提出データ コーデックモジュール (line-codec.ts)
 *
 * フォーマット仕様 (ADR-005):
 *   FS1|<staff_id>|<period_start>|<encoded_availability>|<checksum>
 *
 * 例:
 *   FS1|emp_001|2026-09-01|aABbCx0q2R|7f3a
 */

import { StaffAvailability, AvailabilityStatus } from './types';

// FS2 で日数をコード自身に埋め込むようにした。
// FS1 は日数を持たず、送信側 (Math.min(7, period.days)) と
// 受信側 (period.days) が食い違うと希望が日付ごとズレて取り込まれ、
// しかもエラーにならないという破損があったため。
const FORMAT_VERSION = 'FS2';
const LEGACY_FORMAT_VERSION = 'FS1';
// FS1 の送信側が使っていた日数の上限（後方互換のデコードに必要）
const LEGACY_MAX_DAYS = 7;
const BASE62_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

// 3状態マッピング (2bit: 00=unavailable, 01=available, 10=want, 11=reserved)
const STATUS_TO_BITS: Record<AvailabilityStatus, number> = {
  unavailable: 0,
  available: 1,
  want: 2,
};

const BITS_TO_STATUS: Record<number, AvailabilityStatus> = {
  0: 'unavailable',
  1: 'available',
  2: 'want',
};

/**
 * CRC-16-CCITT 簡易チェックサム計算 (4桁hex)
 */
export function calculateChecksum(text: string): string {
  let crc = 0xffff;
  for (let i = 0; i < text.length; i++) {
    crc ^= text.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }
  return crc.toString(16).padStart(4, '0').toLowerCase();
}

/**
 * BigIntをBase62文字列に変換
 */
function toBase62(num: bigint): string {
  if (num === BigInt(0)) return '0';
  let result = '';
  let n = num;
  const base = BigInt(BASE62_ALPHABET.length);
  while (n > BigInt(0)) {
    const rem = Number(n % base);
    result = BASE62_ALPHABET[rem] + result;
    n = n / base;
  }
  return result;
}

/**
 * Base62文字列をBigIntに復元
 */
function fromBase62(str: string): bigint {
  let result = BigInt(0);
  const base = BigInt(BASE62_ALPHABET.length);
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    const index = BASE62_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error(`無効なBase62文字が含まれています: ${char}`);
    }
    result = result * base + BigInt(index);
  }
  return result;
}

export interface EncodeSubmissionOptions {
  staff_id: string;
  period_start: string;
  days: number;
  shift_ids: string[];
  availabilities: StaffAvailability[];
}

/**
 * スタッフの希望入力リストをLINE提出コードにエンコード
 */
export function encodeSubmissionCode(options: EncodeSubmissionOptions): string {
  const { staff_id, period_start, days, shift_ids, availabilities } = options;

  // 1. スロット順（day_offset: 0..days-1, shift_id順）に2bitずつBigIntへパッキング
  let bitVector = BigInt(0);

  // staff_idに一致する希望をマッピング
  const staffAvails = availabilities.filter((a) => a.staff_id === staff_id);
  const availMap: Record<string, AvailabilityStatus> = {};
  for (const a of staffAvails) {
    availMap[`${a.day_offset}_${a.shift_id}`] = a.status;
  }

  for (let d = 0; d < days; d++) {
    for (const sId of shift_ids) {
      const status = availMap[`${d}_${sId}`] || 'unavailable';
      const bits = BigInt(STATUS_TO_BITS[status] ?? 0);
      bitVector = (bitVector << BigInt(2)) | bits;
    }
  }

  // 終端ビット（1）を付与して先行ゼロの消失を防ぐ
  bitVector = (bitVector << BigInt(1)) | BigInt(1);

  const encodedAvail = toBase62(bitVector);
  // 日数をコードに含めることで、受信側が別の日数で解釈することを構造的に防ぐ
  const rawPayload = `${FORMAT_VERSION}|${staff_id}|${period_start}|${days}|${encodedAvail}`;
  const checksum = calculateChecksum(rawPayload);

  return `${rawPayload}|${checksum}`;
}

export interface DecodedSubmission {
  version: string;
  staff_id: string;
  period_start: string;
  availabilities: StaffAvailability[];
  isValid: boolean;
  error?: string;
}

/**
 * LINE提出コードをパース＆デコード
 */
export function decodeSubmissionCode(
  code: string,
  days: number,
  shift_ids: string[]
): DecodedSubmission {
  const cleanCode = code.trim();
  const parts = cleanCode.split('|');

  const version = parts[0];
  const isLegacy = version === LEGACY_FORMAT_VERSION;
  const expectedParts = isLegacy ? 5 : 6;

  if (version !== FORMAT_VERSION && !isLegacy) {
    return {
      version,
      staff_id: '',
      period_start: '',
      availabilities: [],
      isValid: false,
      error: `非対応のバージョンです: ${version} (期待: ${FORMAT_VERSION})`,
    };
  }

  if (parts.length !== expectedParts) {
    return {
      version,
      staff_id: '',
      period_start: '',
      availabilities: [],
      isValid: false,
      error: `フォーマットが不正です（期待: ${expectedParts}要素, 実際: ${parts.length}要素）`,
    };
  }

  const staff_id = parts[1];
  const period_start = parts[2];
  const encodedAvail = isLegacy ? parts[3] : parts[4];
  const checksum = parts[expectedParts - 1];

  // 日数はコードに埋め込まれた値を最優先で使う。
  // FS1 は日数を持たないため、当時の送信側と同じ規則で復元する。
  let effectiveDays: number;
  if (isLegacy) {
    effectiveDays = Math.min(LEGACY_MAX_DAYS, days);
  } else {
    effectiveDays = Number(parts[3]);
    if (!Number.isInteger(effectiveDays) || effectiveDays <= 0) {
      return {
        version,
        staff_id,
        period_start,
        availabilities: [],
        isValid: false,
        error: `提出コードの日数が不正です: ${parts[3]}`,
      };
    }
  }

  // チェックサム検証
  const rawPayload = isLegacy
    ? `${version}|${staff_id}|${period_start}|${encodedAvail}`
    : `${version}|${staff_id}|${period_start}|${effectiveDays}|${encodedAvail}`;
  const expectedChecksum = calculateChecksum(rawPayload);
  if (checksum.toLowerCase() !== expectedChecksum) {
    return {
      version,
      staff_id,
      period_start,
      availabilities: [],
      isValid: false,
      error: `チェックサムが一致しません（破損または改ざんの可能性: 期待 ${expectedChecksum}, 実際 ${checksum}）`,
    };
  }

  try {
    let bitVector = fromBase62(encodedAvail);

    // 終端ビットの検証と除去
    if ((bitVector & BigInt(1)) !== BigInt(1)) {
      return {
        version,
        staff_id,
        period_start,
        availabilities: [],
        isValid: false,
        error: 'ビットベクトルの終端が不正です',
      };
    }
    bitVector = bitVector >> BigInt(1);

    // 後ろからビットを展開（LIFO）するためスタックに詰める
    const totalSlots = effectiveDays * shift_ids.length;
    const statusList: AvailabilityStatus[] = [];

    for (let i = 0; i < totalSlots; i++) {
      const bits = Number(bitVector & BigInt(3));
      const status = BITS_TO_STATUS[bits] || 'unavailable';
      statusList.unshift(status);
      bitVector = bitVector >> BigInt(2);
    }

    // 敵対検証指摘: 全ビット消費チェック（余剰ビットがある場合はシフト枠構成不一致）
    if (bitVector !== BigInt(0)) {
      return {
        version,
        staff_id,
        period_start,
        availabilities: [],
        isValid: false,
        error: `店長側のシフト枠定義 (${shift_ids.length}枠×${days}日) と提出コードの枠構成が一致しません。最新のシフト枠で再提出してください。`,
      };
    }

    const availabilities: StaffAvailability[] = [];
    let slotIdx = 0;
    for (let d = 0; d < days; d++) {
      for (const sId of shift_ids) {
        const status = statusList[slotIdx++] || 'unavailable';
        availabilities.push({
          staff_id,
          day_offset: d,
          shift_id: sId,
          status,
        });
      }
    }

    return {
      version,
      staff_id,
      period_start,
      availabilities,
      isValid: true,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      version,
      staff_id,
      period_start,
      availabilities: [],
      isValid: false,
      error: `デコード処理中にエラーが発生しました: ${msg}`,
    };
  }
}

/**
 * 複数行のテキスト（LINEトークやコピペ）から FS1|... の提出コードを全件抽出
 */
export function extractSubmissionCodesFromText(text: string): string[] {
  // FS2 は日数フィールドを1つ多く持つ。FS1 も引き続き抽出できるようにする
  // （抽出漏れは「コードが見つかりません」となり原因が分かりにくいため）。
  const regex =
    /FS2\|[a-zA-Z0-9_\-]+\|\d{4}-\d{2}-\d{2}\|\d+\|[a-zA-Z0-9]+\|[0-9a-fA-F]{4}|FS1\|[a-zA-Z0-9_\-]+\|\d{4}-\d{2}-\d{2}\|[a-zA-Z0-9]+\|[0-9a-fA-F]{4}/g;
  const matches = text.match(regex);
  return matches ? Array.from(new Set(matches)) : [];
}
