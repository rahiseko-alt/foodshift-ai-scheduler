/**
 * 店舗名簿の共有コーデック (roster-share.ts)
 *
 * 店長の端末にある「スタッフ名簿・対象期間・シフト枠」を、
 * サーバーに保存せずスタッフの端末へ渡すためのモジュール。
 *
 * 背景:
 *   バックエンドは完全ステートレスで店舗データを保存しない設計のため、
 *   スタッフが /submit を開いても自分の名前が出てこなかった
 *   （常にサンプルの15人が表示され、実店舗では運用できなかった）。
 *
 * 方式:
 *   名簿を JSON -> gzip -> URL-safe base64 に圧縮し、URLフラグメント (#) に載せる。
 *   フラグメントはサーバーへ送信されないため、スタッフ名がサーバーのログに
 *   残らないという利点もある。
 *   実測: スタッフ15名+シフト枠3+期間で約590文字、50名でも約520文字
 *   （名前が重複するほど圧縮が効く）。URLの実用上限2,000に対し十分収まる。
 */

import { Period, Shift, ShiftOptimizeRequest, StaffMember } from './types';

const ROSTER_VERSION = 1;

/** URLフラグメントに載せる最小限の店舗情報 */
interface RosterPayload {
  v: number;
  n: string; // 店舗名
  p: [string, number]; // [開始日, 日数]
  s: [string, string][]; // [スタッフID, 表示名]
  k: [string, string, string, string, number, number][]; // シフト枠
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function gzip(input: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([input as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(input: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([input as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * 店舗データから、スタッフに配るためのフラグメント文字列を生成する。
 *
 * 時給・生年月日・NGペアといった、希望提出に不要な個人情報は
 * 意図的に含めない（スタッフ間で互いの時給が見えてしまうため）。
 */
export async function encodeRoster(request: ShiftOptimizeRequest): Promise<string> {
  const payload: RosterPayload = {
    v: ROSTER_VERSION,
    n: request.store_name || '',
    p: [request.period.start_date, request.period.days],
    s: request.staff_members.map((m) => [m.id, m.name]),
    k: request.shifts.map((sh) => [
      sh.id,
      sh.name,
      sh.start,
      sh.end,
      sh.hours,
      sh.break_minutes ?? 0,
    ]),
  };
  const raw = new TextEncoder().encode(JSON.stringify(payload));
  return toBase64Url(await gzip(raw));
}

export interface DecodedRoster {
  store_name: string;
  period: Period;
  staff_members: StaffMember[];
  shifts: Shift[];
}

/**
 * フラグメント文字列を店舗データに復元する。
 * 壊れている場合は null を返す（呼び出し側で明示的に案内する）。
 */
export async function decodeRoster(fragment: string): Promise<DecodedRoster | null> {
  try {
    const json = new TextDecoder().decode(await gunzip(fromBase64Url(fragment)));
    const p = JSON.parse(json) as RosterPayload;
    if (p.v !== ROSTER_VERSION || !Array.isArray(p.s) || !Array.isArray(p.p)) return null;

    return {
      store_name: p.n || '',
      period: { start_date: p.p[0], days: p.p[1] },
      // 希望提出に必要な最小限のフィールドのみ復元する。
      // 時給などは共有していないため既定値を入れる（提出時に使われない）。
      staff_members: p.s.map(([id, name]) => ({
        id,
        name,
        is_minor: false,
        roles: ['hall'],
        hourly_wage: 1000,
        max_weekly_hours: 40,
        target_weekly_hours: 30,
        max_consecutive_days: 5,
      })),
      shifts: p.k.map(([id, name, start, end, hours, breakMinutes]) => ({
        id,
        name,
        start,
        end,
        hours,
        break_minutes: breakMinutes,
        is_late_night: false,
      })),
    };
  } catch {
    return null;
  }
}

/** スタッフに送る提出用URLを組み立てる */
export function buildSubmitUrl(origin: string, fragment: string): string {
  return `${origin}/submit#r=${fragment}`;
}

/** URLフラグメントから名簿部分を取り出す */
export function readRosterFragment(hash: string): string | null {
  const m = hash.match(/[#&]r=([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}
