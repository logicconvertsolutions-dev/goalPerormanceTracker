'use client';

import type { QueuedAction } from './types';

const DB_NAME = 'performance-tracker-offline';
const DB_VERSION = 1;
const STORE_NAME = 'pending-actions';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const request = fn(tx.objectStore(STORE_NAME));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

export async function enqueueAction(action: QueuedAction): Promise<void> {
  await withStore('readwrite', (store) => store.put(action));
}

export async function listQueuedActions(): Promise<QueuedAction[]> {
  return withStore('readonly', (store) => store.getAll());
}

export async function removeQueuedAction(id: string): Promise<void> {
  await withStore('readwrite', (store) => store.delete(id));
}

export async function countQueuedActions(): Promise<number> {
  return withStore('readonly', (store) => store.count());
}
