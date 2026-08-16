import { ShiftOptimizeRequest, ShiftOptimizeResponse } from './types';

export const DB_NAME = 'FoodShiftDB';
export const DB_VERSION = 1;

export interface StoreMetadata {
  id: string;
  name: string;
  created_at: number;
  updated_at: number;
}

export interface StoredRequestRecord {
  store_id: string;
  data: ShiftOptimizeRequest;
  updated_at: number;
  version: number;
}

export interface StoredResponseRecord {
  store_id: string;
  data: ShiftOptimizeResponse;
  updated_at: number;
  version: number;
}

export interface StoredSnapshot {
  id: string;
  store_id: string;
  label: string;
  created_at: string;
  timestamp: number;
  request: ShiftOptimizeRequest;
  response: ShiftOptimizeResponse | null;
}

export function isIndexedDBAvailable(): boolean {
  return typeof window !== 'undefined' && 'indexedDB' in window && window.indexedDB !== null;
}

let dbInstancePromise: Promise<IDBDatabase> | null = null;

export function openDB(): Promise<IDBDatabase> {
  if (!isIndexedDBAvailable()) {
    return Promise.reject(new Error('IndexedDB is not available in this environment.'));
  }

  if (dbInstancePromise) {
    return dbInstancePromise;
  }

  dbInstancePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // 1. 店舗マスタストア
      if (!db.objectStoreNames.contains('stores')) {
        db.createObjectStore('stores', { keyPath: 'id' });
      }

      // 2. シフト希望・リクエストデータストア (store_id ごと)
      if (!db.objectStoreNames.contains('requests')) {
        db.createObjectStore('requests', { keyPath: 'store_id' });
      }

      // 3. 最適化結果・確定レスポンスストア (store_id ごと)
      if (!db.objectStoreNames.contains('responses')) {
        db.createObjectStore('responses', { keyPath: 'store_id' });
      }

      // 4. バックアップ・履歴スナップショットストア
      if (!db.objectStoreNames.contains('snapshots')) {
        const snapshotStore = db.createObjectStore('snapshots', { keyPath: 'id' });
        snapshotStore.createIndex('by_store', 'store_id', { unique: false });
        snapshotStore.createIndex('by_timestamp', 'timestamp', { unique: false });
      }
    };

    request.onsuccess = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      db.onversionchange = () => {
        db.close();
        dbInstancePromise = null;
      };
      resolve(db);
    };

    request.onerror = (event) => {
      dbInstancePromise = null;
      reject((event.target as IDBOpenDBRequest).error);
    };

    request.onblocked = () => {
      console.warn('FoodShiftDB open blocked by existing connection.');
    };
  });

  return dbInstancePromise;
}

// 汎用ヘルパー
async function runTransaction<T>(
  storeName: string,
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => IDBRequest<T> | void
): Promise<T> {
  const db = await openDB();
  return new Promise<T>((resolve, reject) => {
    try {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      const req = callback(store);

      if (req) {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }

      tx.oncomplete = () => {
        if (!req) resolve(undefined as unknown as T);
      };
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(new Error('Transaction aborted'));
    } catch (err) {
      reject(err);
    }
  });
}

// --- 店舗操作 ---
export async function getStore(storeId: string): Promise<StoreMetadata | null> {
  try {
    const result = await runTransaction<StoreMetadata | undefined>('stores', 'readonly', (store) =>
      store.get(storeId)
    );
    return result || null;
  } catch (e) {
    console.error('getStore error:', e);
    return null;
  }
}

export async function getAllStores(): Promise<StoreMetadata[]> {
  try {
    const result = await runTransaction<StoreMetadata[]>('stores', 'readonly', (store) =>
      store.getAll()
    );
    return result || [];
  } catch (e) {
    console.error('getAllStores error:', e);
    return [];
  }
}

export async function putStore(storeMeta: StoreMetadata): Promise<void> {
  await runTransaction('stores', 'readwrite', (store) => store.put(storeMeta));
}

// --- Request データ操作 ---
export async function getDbRequest(storeId: string): Promise<StoredRequestRecord | null> {
  try {
    const result = await runTransaction<StoredRequestRecord | undefined>('requests', 'readonly', (store) =>
      store.get(storeId)
    );
    return result || null;
  } catch (e) {
    console.error('getDbRequest error:', e);
    return null;
  }
}

export async function putDbRequest(
  storeId: string,
  data: ShiftOptimizeRequest,
  version?: number
): Promise<{ updated_at: number; version: number }> {
  const now = Date.now();
  const existing = await getDbRequest(storeId);
  const nextVersion = version ?? ((existing?.version || 0) + 1);

  const record: StoredRequestRecord = {
    store_id: storeId,
    data,
    updated_at: now,
    version: nextVersion,
  };

  await runTransaction('requests', 'readwrite', (store) => store.put(record));
  return { updated_at: now, version: nextVersion };
}

// --- Response データ操作 ---
export async function getDbResponse(storeId: string): Promise<StoredResponseRecord | null> {
  try {
    const result = await runTransaction<StoredResponseRecord | undefined>('responses', 'readonly', (store) =>
      store.get(storeId)
    );
    return result || null;
  } catch (e) {
    console.error('getDbResponse error:', e);
    return null;
  }
}

export async function putDbResponse(
  storeId: string,
  data: ShiftOptimizeResponse,
  version?: number
): Promise<{ updated_at: number; version: number }> {
  const now = Date.now();
  const existing = await getDbResponse(storeId);
  const nextVersion = version ?? ((existing?.version || 0) + 1);

  const record: StoredResponseRecord = {
    store_id: storeId,
    data,
    updated_at: now,
    version: nextVersion,
  };

  await runTransaction('responses', 'readwrite', (store) => store.put(record));
  return { updated_at: now, version: nextVersion };
}

// --- スナップショット操作 ---
export async function saveDbSnapshot(
  storeId: string,
  label: string,
  request: ShiftOptimizeRequest,
  response: ShiftOptimizeResponse | null
): Promise<StoredSnapshot> {
  const timestamp = Date.now();
  const id = `snap_${storeId}_${timestamp}`;
  const nowStr = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });

  const snapshot: StoredSnapshot = {
    id,
    store_id: storeId,
    label,
    created_at: nowStr,
    timestamp,
    request,
    response,
  };

  await runTransaction('snapshots', 'readwrite', (store) => store.put(snapshot));
  return snapshot;
}

export async function getDbSnapshots(storeId: string, limit: number = 20): Promise<StoredSnapshot[]> {
  try {
    const db = await openDB();
    return new Promise<StoredSnapshot[]>((resolve, reject) => {
      const tx = db.transaction('snapshots', 'readonly');
      const store = tx.objectStore('snapshots');
      const index = store.index('by_store');
      const req = index.getAll(storeId);

      req.onsuccess = () => {
        const results = (req.result || []) as StoredSnapshot[];
        // 最新順（timestamp 降順）
        results.sort((a, b) => b.timestamp - a.timestamp);
        resolve(results.slice(0, limit));
      };
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.error('getDbSnapshots error:', e);
    return [];
  }
}

export async function getDbSnapshot(snapshotId: string): Promise<StoredSnapshot | null> {
  try {
    const result = await runTransaction<StoredSnapshot | undefined>('snapshots', 'readonly', (store) =>
      store.get(snapshotId)
    );
    return result || null;
  } catch (e) {
    console.error('getDbSnapshot error:', e);
    return null;
  }
}

export async function deleteDbSnapshot(snapshotId: string): Promise<void> {
  await runTransaction('snapshots', 'readwrite', (store) => store.delete(snapshotId));
}

export async function clearDbStoreData(storeId: string): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(['requests', 'responses', 'snapshots'], 'readwrite');
    tx.objectStore('requests').delete(storeId);
    tx.objectStore('responses').delete(storeId);

    // スナップショットの該当store削除
    const snapStore = tx.objectStore('snapshots');
    const snapIndex = snapStore.index('by_store');
    const req = snapIndex.openKeyCursor(IDBKeyRange.only(storeId));
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        snapStore.delete(cursor.primaryKey);
        cursor.continue();
      }
    };
  } catch (e) {
    console.error('clearDbStoreData error:', e);
  }
}
