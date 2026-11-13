// Opening the database (js/db.js): the stores and indexes it makes, the
// upgrade from older layouts, and what happens when opening goes wrong.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { freshDb, loadDb, resetIndexedDB, rawOpen, rawAll } from './db-helpers.mjs';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const LAYOUT = {
  people: ['id', ['organizationId']],
  organizations: ['id', []],
  circles: ['id', []],
  touchpoints: ['id', ['personId']],
  news: ['id', ['personId']],
  openLoops: ['id', ['personId']],
  ideas: ['id', []],
  weeks: ['id', ['weekStart']],
  settings: ['id', []],
  tombstones: ['id', []],
  meta: ['key', []],
};

describe('opening a new database', () => {
  it('makes every store with its key and indexes at version 5', async () => {
    const db = await freshDb();
    await db.getPeople();
    const raw = await rawOpen();
    try {
      expect(raw.version).toBe(5);
      expect([...raw.objectStoreNames].sort()).toEqual(Object.keys(LAYOUT).sort());
      const tx = raw.transaction(Object.keys(LAYOUT));
      for (const [name, [keyPath, indexes]] of Object.entries(LAYOUT)) {
        const s = tx.objectStore(name);
        expect(s.keyPath, name).toBe(keyPath);
        expect([...s.indexNames], name).toEqual(indexes);
        for (const i of indexes) expect(s.index(i).keyPath).toBe(i);
      }
    } finally {
      raw.close();
    }
  });
  it('starts empty', async () => {
    const db = await freshDb();
    expect(await db.getPeople()).toEqual([]);
    expect(await db.getOrganizations()).toEqual([]);
    expect(await db.getMeta('installedAt')).toBeUndefined();
  });
  it('opens once and reuses the connection', async () => {
    const db = await freshDb();
    const open = vi.spyOn(indexedDB, 'open');
    await Promise.all([db.getPeople(), db.getCircles()]);
    await db.getNews();
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith('callback', 5);
  });
});

describe('upgrading an older database', () => {
  it('fills relationship defaults on version 1 people without touching updatedAt', async () => {
    resetIndexedDB();
    const old = await rawOpen(1, (raw) => {
      const s = raw.createObjectStore('people', { keyPath: 'id' });
      s.createIndex('organizationId', 'organizationId');
      s.put({ id: 'p1', name: 'Test Person', updatedAt: '2020-01-01T00:00:00.000Z' });
      s.put({ id: 'p2', name: 'Second Person', relationshipType: 'industry', updatedAt: '2020-01-02T00:00:00.000Z' });
      s.put({ id: 'p3', name: 'Third Person', updatedAt: '2020-01-03T00:00:00.000Z' });
      raw.createObjectStore('touchpoints', { keyPath: 'id' }).createIndex('personId', 'personId');
    });
    old.close();
    const db = await loadDb();
    await db.getPeople();
    const people = await rawAll('people');
    expect(people[0]).toMatchObject({ id: 'p1', relationshipType: 'prospect', relationshipTypes: ['prospect'], birthday: null, updatedAt: '2020-01-01T00:00:00.000Z' });
    // Someone who already had a type is left exactly as saved.
    expect(people[1]).toEqual({ id: 'p2', name: 'Second Person', relationshipType: 'industry', updatedAt: '2020-01-02T00:00:00.000Z' });
    // Every old person is upgraded, not just the first.
    expect(people[2]).toMatchObject({ id: 'p3', relationshipType: 'prospect', updatedAt: '2020-01-03T00:00:00.000Z' });
  });
  it('keeps existing stores and their records and adds the missing ones', async () => {
    resetIndexedDB();
    const old = await rawOpen(1, (raw) => {
      raw.createObjectStore('people', { keyPath: 'id' }).createIndex('organizationId', 'organizationId');
      raw.createObjectStore('organizations', { keyPath: 'id' }).put({ id: 'o1', name: 'Test Org' });
    });
    old.close();
    const db = await loadDb();
    expect(await db.getOrganizations()).toEqual([{ id: 'o1', name: 'Test Org' }]);
    expect(await db.getIdeas()).toEqual([]);
    await db.setMeta('k', 1);
    expect(await db.getMeta('k')).toBe(1);
  });
  it('does not rewrite people when upgrading from version 2 or later', async () => {
    resetIndexedDB();
    const old = await rawOpen(2, (raw) => {
      raw.createObjectStore('people', { keyPath: 'id' }).put({ id: 'p1', name: 'Test Person' });
    });
    old.close();
    const db = await loadDb();
    await db.getCircles();
    expect(await rawAll('people')).toEqual([{ id: 'p1', name: 'Test Person' }]);
    // Defaults still come back on reading.
    expect((await db.getPerson('p1')).relationshipType).toBe('prospect');
  });
  it('upgrades a version 1 database that had no people store', async () => {
    resetIndexedDB();
    const old = await rawOpen(1, (raw) => raw.createObjectStore('ideas', { keyPath: 'id' }).put({ id: 'i1', text: 'Send a postcard' }));
    old.close();
    const db = await loadDb();
    expect(await db.getIdeas()).toEqual([{ id: 'i1', text: 'Send a postcard' }]);
    expect(await db.getPeople()).toEqual([]);
  });
  it('waits for an older copy in another tab to let go', async () => {
    resetIndexedDB();
    const other = await rawOpen(1, (raw) => raw.createObjectStore('people', { keyPath: 'id' }));
    // This older copy ignores versionchange, so the upgrade is blocked until it closes.
    const blocked = vi.fn();
    const db = await loadDb();
    const realOpen = indexedDB.open.bind(indexedDB);
    vi.spyOn(indexedDB, 'open').mockImplementation((...args) => {
      const r = realOpen(...args);
      r.addEventListener('blocked', blocked);
      return r;
    });
    const people = db.getPeople();
    await vi.waitFor(() => expect(blocked).toHaveBeenCalled());
    other.close();
    await expect(people).resolves.toEqual([]);
  });
});

describe('when opening fails', () => {
  it('rejects with the browser error when the saved database is newer', async () => {
    resetIndexedDB();
    const newer = await rawOpen(9, (raw) => raw.createObjectStore('people', { keyPath: 'id' }));
    newer.close();
    const db = await loadDb();
    await expect(db.getPeople()).rejects.toMatchObject({ name: 'VersionError' });
    await expect(db.savePerson({ name: 'Test Person' })).rejects.toMatchObject({ name: 'VersionError' });
  });
});

describe('a newer copy opening in another tab', () => {
  it('closes this connection so the newer copy can upgrade', async () => {
    const db = await freshDb();
    await db.getPeople();
    const blocked = vi.fn();
    const newer = await new Promise((resolve, reject) => {
      const r = indexedDB.open('callback', 6);
      r.onblocked = blocked;
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    expect(newer.version).toBe(6);
    expect(blocked).not.toHaveBeenCalled();
    newer.close();
  });
});

describe('a failed read', () => {
  it('rejects with the request error', async () => {
    const db = await freshDb();
    await db.getPeople();
    const failure = new Error('read failed');
    let fake;
    vi.spyOn(IDBObjectStore.prototype, 'getAll').mockImplementation(() => {
      fake = {};
      setTimeout(() => {
        fake.error = failure;
        fake.onerror();
      });
      return fake;
    });
    await expect(db.getOrganizations()).rejects.toBe(failure);
  });
  it('rejects a lookup with a key that cannot be a key', async () => {
    const db = await freshDb();
    await expect(db.getPerson(undefined)).rejects.toMatchObject({ name: 'DataError' });
    await expect(db.getPerson({})).rejects.toMatchObject({ name: 'DataError' });
  });
  it('still reads fine after a failed lookup', async () => {
    const db = await freshDb();
    await expect(db.getPerson(null)).rejects.toBeTruthy();
    const saved = await db.savePerson({ name: 'Test Person' });
    expect((await db.getPerson(saved.id)).name).toBe('Test Person');
  });
});
