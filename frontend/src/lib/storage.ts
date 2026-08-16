import { ShiftOptimizeRequest, ShiftOptimizeResponse } from './types';
import { DEMO_IZAKAYA_DATA } from './mock-data';
import {
  isIndexedDBAvailable,
  getDbRequest,
  putDbRequest,
  getDbResponse,
  putDbResponse,
  saveDbSnapshot,
  getDbSnapshots,
  getDbSnapshot,
  deleteDbSnapshot,
  clearDbStoreData,
  StoredSnapshot,
} from './db';

export const DEFAULT_STORE_ID = 'store_default';

// 互換キー (旧形式)
const LEGACY_STORAGE_KEY_REQUEST = 'foodshift_request_data';
const LEGACY_STORAGE_KEY_RESPONSE = 'foodshift_last_response';
const CURRENT_STORE_KEY = 'foodshift_current_store_id';

export interface StorageMeta {
  store_id: string;
  version: number;
  updated_at: number; // Unix epoch ms
}

export interface StoreExportBundle {
  foodshift_version: string;
  schema_version: number;
  exported_at: string;
  store_id: string;
  store_name?: string;
  metadata: StorageMeta;
  request: ShiftOptimizeRequest;
  response: ShiftOptimizeResponse | null;
  snapshots?: StoredSnapshot[];
  checksum: string;
}

// 簡易チェックサム計算
function calculateChecksum(obj: unknown): string {
  const str = JSON.stringify(obj);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0; // Convert to 32bit integer
  }
  return `crc32_${Math.abs(hash).toString(16)}`;
}

// 店舗ID管理
export function getCurrentStoreId(): string {
  if (typeof window === 'undefined') return DEFAULT_STORE_ID;
  try {
    const saved = localStorage.getItem(CURRENT_STORE_KEY);
    return saved || DEFAULT_STORE_ID;
  } catch {
    return DEFAULT_STORE_ID;
  }
}

export function setCurrentStoreId(storeId: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(CURRENT_STORE_KEY, storeId);
  } catch (e) {
    console.error('Failed to set current store ID', e);
  }
}

function getRequestKey(storeId: string): string {
  return `foodshift_req_${storeId}`;
}

function getResponseKey(storeId: string): string {
  return `foodshift_res_${storeId}`;
}

function getMetaKey(storeId: string): string {
  return `foodshift_meta_${storeId}`;
}

// メタデータ読み込み
export function getStorageMeta(storeId: string = getCurrentStoreId()): StorageMeta {
  const defaultMeta: StorageMeta = {
    store_id: storeId,
    version: 1,
    updated_at: Date.now(),
  };
  if (typeof window === 'undefined') return defaultMeta;
  try {
    const raw = localStorage.getItem(getMetaKey(storeId));
    if (raw) {
      return JSON.parse(raw);
    }
  } catch {
    // fallback
  }
  return defaultMeta;
}

// メタデータ更新
function updateStorageMeta(storeId: string = getCurrentStoreId()): StorageMeta {
  const current = getStorageMeta(storeId);
  const next: StorageMeta = {
    store_id: storeId,
    version: current.version + 1,
    updated_at: Date.now(),
  };
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(getMetaKey(storeId), JSON.stringify(next));
    } catch (e) {
      console.warn('Failed to update storage metadata in localStorage', e);
    }
  }
  return next;
}

/**
 * リクエストデータの読み込み (同期・LocalStorage 即時復元 + IndexedDB フォールバック)
 */
export function loadSavedRequest(storeId: string = getCurrentStoreId()): ShiftOptimizeRequest {
  if (typeof window === 'undefined') return DEMO_IZAKAYA_DATA;
  try {
    // 1. 新キー (store_id 分離)
    const saved = localStorage.getItem(getRequestKey(storeId));
    if (saved) {
      return JSON.parse(saved);
    }

    // 2. 旧キー互換 (移行)
    if (storeId === DEFAULT_STORE_ID) {
      const legacy = localStorage.getItem(LEGACY_STORAGE_KEY_REQUEST);
      if (legacy) {
        const parsed = JSON.parse(legacy);
        // 新キーへ保存
        saveRequest(parsed, storeId);
        return parsed;
      }
    }
  } catch (e) {
    console.error('Failed to load request from localStorage', e);
  }

  // 非同期で IndexedDB からも同期試行
  if (isIndexedDBAvailable()) {
    getDbRequest(storeId).then((rec) => {
      if (rec && typeof window !== 'undefined') {
        localStorage.setItem(getRequestKey(storeId), JSON.stringify(rec.data));
      }
    }).catch(() => {});
  }

  return DEMO_IZAKAYA_DATA;
}

/**
 * リクエストデータの非同期読み込み (IndexedDB 優先)
 */
export async function loadSavedRequestAsync(
  storeId: string = getCurrentStoreId()
): Promise<{ data: ShiftOptimizeRequest; updated_at: number; version: number }> {
  if (isIndexedDBAvailable()) {
    try {
      const rec = await getDbRequest(storeId);
      if (rec) {
        return { data: rec.data, updated_at: rec.updated_at, version: rec.version };
      }
    } catch (e) {
      console.warn('IndexedDB load error, fallback to localStorage', e);
    }
  }

  const meta = getStorageMeta(storeId);
  const data = loadSavedRequest(storeId);
  return { data, updated_at: meta.updated_at, version: meta.version };
}

/**
 * リクエストデータの保存 (LocalStorage + IndexedDB 同時書き込み)
 */
export function saveRequest(data: ShiftOptimizeRequest, storeId: string = getCurrentStoreId()): void {
  if (typeof window === 'undefined') return;
  const meta = updateStorageMeta(storeId);

  // 1. LocalStorage
  try {
    localStorage.setItem(getRequestKey(storeId), JSON.stringify(data));
    // 旧キー互換も維持（単体テストやレガシーE2Eのため）
    if (storeId === DEFAULT_STORE_ID) {
      localStorage.setItem(LEGACY_STORAGE_KEY_REQUEST, JSON.stringify(data));
    }
  } catch (e) {
    console.warn('LocalStorage save failed (possibly QuotaExceededError), relying on IndexedDB', e);
  }

  // 2. IndexedDB (大容量・非同期永続化)
  if (isIndexedDBAvailable()) {
    putDbRequest(storeId, data, meta.version).catch((err) => {
      console.error('Failed to persist request to IndexedDB', err);
    });
  }
}

/**
 * 楽観的排他制御付き保存
 */
export async function saveRequestWithConflictCheck(
  data: ShiftOptimizeRequest,
  clientKnownVersion: number,
  storeId: string = getCurrentStoreId()
): Promise<{ success: boolean; conflict: boolean; currentVersion: number }> {
  const currentMeta = getStorageMeta(storeId);

  // バージョン不一致（他タブや別操作で更新されていた場合）
  if (currentMeta.version > clientKnownVersion) {
    return {
      success: false,
      conflict: true,
      currentVersion: currentMeta.version,
    };
  }

  saveRequest(data, storeId);
  const newMeta = getStorageMeta(storeId);
  return {
    success: true,
    conflict: false,
    currentVersion: newMeta.version,
  };
}

/**
 * 最適化レスポンスの読み込み (同期)
 */
export function loadSavedResponse(storeId: string = getCurrentStoreId()): ShiftOptimizeResponse | null {
  if (typeof window === 'undefined') return null;
  try {
    const saved = localStorage.getItem(getResponseKey(storeId));
    if (saved) {
      return JSON.parse(saved);
    }
    if (storeId === DEFAULT_STORE_ID) {
      const legacy = localStorage.getItem(LEGACY_STORAGE_KEY_RESPONSE);
      if (legacy) {
        const parsed = JSON.parse(legacy);
        saveResponse(parsed, storeId);
        return parsed;
      }
    }
  } catch (e) {
    console.error('Failed to load response from localStorage', e);
  }

  if (isIndexedDBAvailable()) {
    getDbResponse(storeId).then((rec) => {
      if (rec && typeof window !== 'undefined') {
        localStorage.setItem(getResponseKey(storeId), JSON.stringify(rec.data));
      }
    }).catch(() => {});
  }

  return null;
}

/**
 * 最適化レスポンスの保存
 */
export function saveResponse(data: ShiftOptimizeResponse, storeId: string = getCurrentStoreId()): void {
  if (typeof window === 'undefined') return;

  try {
    localStorage.setItem(getResponseKey(storeId), JSON.stringify(data));
    if (storeId === DEFAULT_STORE_ID) {
      localStorage.setItem(LEGACY_STORAGE_KEY_RESPONSE, JSON.stringify(data));
    }
  } catch (e) {
    console.warn('LocalStorage response save failed, relying on IndexedDB', e);
  }

  if (isIndexedDBAvailable()) {
    putDbResponse(storeId, data).catch((err) => {
      console.error('Failed to persist response to IndexedDB', err);
    });
  }
}

/**
 * 確定時の自動バックアップスナップショット保存
 */
export async function saveConfirmedSnapshot(
  label: string,
  request: ShiftOptimizeRequest,
  response: ShiftOptimizeResponse | null,
  storeId: string = getCurrentStoreId()
): Promise<StoredSnapshot | null> {
  if (!isIndexedDBAvailable()) return null;
  try {
    return await saveDbSnapshot(storeId, label, request, response);
  } catch (e) {
    console.error('Failed to save snapshot to IndexedDB', e);
    return null;
  }
}

/**
 * スナップショット履歴一覧の取得
 */
export async function listSnapshots(storeId: string = getCurrentStoreId()): Promise<StoredSnapshot[]> {
  if (!isIndexedDBAvailable()) return [];
  try {
    return await getDbSnapshots(storeId);
  } catch (e) {
    console.error('Failed to list snapshots', e);
    return [];
  }
}

/**
 * スナップショットからの復元
 */
export async function restoreSnapshot(
  snapshotId: string,
  storeId: string = getCurrentStoreId()
): Promise<{ request: ShiftOptimizeRequest; response: ShiftOptimizeResponse | null } | null> {
  if (!isIndexedDBAvailable()) return null;
  try {
    const snap = await getDbSnapshot(snapshotId);
    if (!snap) return null;

    saveRequest(snap.request, storeId);
    if (snap.response) {
      saveResponse(snap.response, storeId);
    }

    return {
      request: snap.request,
      response: snap.response,
    };
  } catch (e) {
    console.error('Failed to restore snapshot', e);
    return null;
  }
}

/**
 * スナップショット削除
 */
export async function removeSnapshot(snapshotId: string): Promise<void> {
  if (!isIndexedDBAvailable()) return;
  await deleteDbSnapshot(snapshotId);
}

/**
 * 店舗データ一括エクスポート
 */
export async function exportStoreBundle(storeId: string = getCurrentStoreId()): Promise<StoreExportBundle> {
  const req = loadSavedRequest(storeId);
  const res = loadSavedResponse(storeId);
  const meta = getStorageMeta(storeId);
  const snapshots = isIndexedDBAvailable() ? await getDbSnapshots(storeId, 10) : [];

  const partialBundle = {
    foodshift_version: '1.0.0',
    schema_version: 1,
    exported_at: new Date().toISOString(),
    store_id: storeId,
    metadata: meta,
    request: req,
    response: res,
    snapshots,
  };

  const checksum = calculateChecksum(partialBundle);

  return {
    ...partialBundle,
    checksum,
  };
}

/**
 * 店舗データ一括エクスポート (JSON ファイルダウンロード)
 */
export async function downloadStoreBackup(storeId: string = getCurrentStoreId()): Promise<void> {
  const bundle = await exportStoreBundle(storeId);
  const jsonStr = JSON.stringify(bundle, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const dateStr = new Date().toISOString().split('T')[0];
  const link = document.createElement('a');
  link.href = url;
  link.download = `foodshift_backup_${storeId}_${dateStr}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * インポートデータのスキーマ整合性バリデーション
 */
export function validateImportBundle(data: unknown): { valid: boolean; error?: string; bundle?: StoreExportBundle } {
  if (!data || typeof data !== 'object') {
    return { valid: false, error: 'JSONデータが無効または空です。' };
  }

  const obj = data as Partial<StoreExportBundle>;

  if (obj.foodshift_version === undefined || !obj.request) {
    return { valid: false, error: 'FoodShiftのバックアップ形式ではありません。' };
  }

  const req = obj.request;
  if (!req.period || !Array.isArray(req.shifts) || !Array.isArray(req.staff_members)) {
    return { valid: false, error: 'シフト定義またはスタッフ一覧スキーマが破損しています。' };
  }

  // 必須フィールドの簡易検査
  for (const staff of req.staff_members) {
    if (!staff.id || !staff.name || typeof staff.hourly_wage !== 'number') {
      return { valid: false, error: `スタッフ「${staff.name || staff.id}」のデータが不正です。` };
    }
  }

  for (const shift of req.shifts) {
    if (!shift.id || !shift.name || !shift.start || !shift.end) {
      return { valid: false, error: `シフト枠「${shift.name || shift.id}」のデータが不正です。` };
    }
  }

  return {
    valid: true,
    bundle: data as StoreExportBundle,
  };
}

/**
 * 店舗データ一括インポート・復元
 */
export async function importStoreBundle(
  bundle: StoreExportBundle,
  targetStoreId?: string
): Promise<{ success: boolean; store_id: string; error?: string }> {
  try {
    const storeId = targetStoreId || bundle.store_id || getCurrentStoreId();

    // 復元前に現在の状態を自動安全スナップショットとして保存
    const currentReq = loadSavedRequest(storeId);
    const currentRes = loadSavedResponse(storeId);
    if (isIndexedDBAvailable()) {
      await saveDbSnapshot(storeId, '📦 インポート前自動バックアップ', currentReq, currentRes);
    }

    // データ書き込み
    saveRequest(bundle.request, storeId);
    if (bundle.response) {
      saveResponse(bundle.response, storeId);
    }

    // スナップショットがあれば追加
    if (bundle.snapshots && isIndexedDBAvailable()) {
      for (const snap of bundle.snapshots) {
        await saveDbSnapshot(storeId, `[復元] ${snap.label}`, snap.request, snap.response);
      }
    }

    setCurrentStoreId(storeId);
    return { success: true, store_id: storeId };
  } catch (e) {
    console.error('importStoreBundle failed', e);
    return { success: false, store_id: targetStoreId || DEFAULT_STORE_ID, error: String(e) };
  }
}
