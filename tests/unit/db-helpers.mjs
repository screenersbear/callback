// Shared setup for the js/db.js tests: a brand new in-memory IndexedDB and a
// freshly loaded db.js (it keeps its connection in a module variable) per test.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { vi } from 'vitest';

export function resetIndexedDB() {
  globalThis.indexedDB = new IDBFactory();
}

// Loads db.js again without its old connection, keeping the current database.
export async function loadDb() {
  vi.resetModules();
  return import('../../js/db.js');
}

export async function freshDb() {
  resetIndexedDB();
  return loadDb();
}

export function req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

// Opens the 'callback' database directly, outside db.js. With `upgrade`,
// builds an older layout first (for migration tests).
export function rawOpen(version, upgrade) {
  return new Promise((resolve, reject) => {
    const r = version === undefined ? indexedDB.open('callback') : indexedDB.open('callback', version);
    r.onupgradeneeded = () => upgrade && upgrade(r.result, r.transaction);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

// Every record of a store exactly as saved (no defaults filled in).
export async function rawAll(store) {
  const db = await rawOpen();
  try {
    return await req(db.transaction(store).objectStore(store).getAll());
  } finally {
    db.close();
  }
}

// Writes records exactly as given, skipping db.js's stamping.
export async function rawPut(store, records) {
  const db = await rawOpen();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      for (const r of records) tx.objectStore(store).put(r);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

// Only Date is faked: fake-indexeddb still needs real timers to run.
export function pinClock(iso) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(iso));
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
