// Storage module. The only file that knows about IndexedDB: the UI asks for
// people, touchpoints and so on through these functions, so a sync backend
// can slot in here later without touching the screens.
//
// Every synced record carries a UUID `id`, `createdAt` and `updatedAt`.
// Deletions leave a tombstone so a later merge (import today, sync tomorrow)
// knows the record was removed on purpose rather than never seen.
import { uuid, nowISO } from './util.js';
import { withDefaults } from './cadence.js';

const DB_NAME = 'callback';
const DB_VERSION = 1;
export const SCHEMA_VERSION = 1;

// Stores that travel in exports, imports and (one day) sync.
const SYNCED = ['people', 'organizations', 'touchpoints', 'news', 'weeks', 'settings', 'tombstones'];
// settings holds one record, id 'settings', so two devices merge into the
// same record instead of each keeping its own.
const SETTINGS_ID = 'settings';

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const people = db.createObjectStore('people', { keyPath: 'id' });
      people.createIndex('organizationId', 'organizationId');
      db.createObjectStore('organizations', { keyPath: 'id' });
      const tps = db.createObjectStore('touchpoints', { keyPath: 'id' });
      tps.createIndex('personId', 'personId');
      const news = db.createObjectStore('news', { keyPath: 'id' });
      news.createIndex('personId', 'personId');
      const weeks = db.createObjectStore('weeks', { keyPath: 'id' });
      weeks.createIndex('weekStart', 'weekStart');
      db.createObjectStore('settings', { keyPath: 'id' });
      db.createObjectStore('tombstones', { keyPath: 'id' });
      // Device-only facts (last export, install date). Never exported.
      db.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Callback is open in another tab that needs to close first.'));
  });
  return dbPromise;
}

function done(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getAll(store) {
  const db = await open();
  return done(db.transaction(store).objectStore(store).getAll());
}

async function getOne(store, id) {
  const db = await open();
  return done(db.transaction(store).objectStore(store).get(id));
}

async function getByIndex(store, index, value) {
  const db = await open();
  return done(db.transaction(store).objectStore(store).index(index).getAll(value));
}

// One readwrite transaction across `stores`; fn queues requests synchronously.
async function write(stores, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, 'readwrite');
    fn((name) => tx.objectStore(name));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Save was cancelled.'));
  });
}

function stamp(rec) {
  const now = nowISO();
  return { ...rec, id: rec.id || uuid(), createdAt: rec.createdAt || now, updatedAt: now };
}

async function save(store, rec) {
  const r = stamp(rec);
  await write([store], (st) => st(store).put(r));
  return r;
}

function tombstone(id, store) {
  const now = nowISO();
  return { id, store, deletedAt: now, createdAt: now, updatedAt: now };
}

async function remove(store, id) {
  await write([store, 'tombstones'], (st) => {
    st(store).delete(id);
    st('tombstones').put(tombstone(id, store));
  });
}

// ---- People ----
export const getPeople = () => getAll('people');
export const getPerson = (id) => getOne('people', id);
export const savePerson = (p) => save('people', p);
export async function savePeople(list) {
  const recs = list.map(stamp);
  await write(['people'], (st) => recs.forEach((r) => st('people').put(r)));
  return recs;
}

// Removes a person along with their touchpoints and news.
export async function deletePerson(id) {
  const [tps, news] = await Promise.all([getByIndex('touchpoints', 'personId', id), getByIndex('news', 'personId', id)]);
  await write(['people', 'touchpoints', 'news', 'tombstones'], (st) => {
    st('people').delete(id);
    st('tombstones').put(tombstone(id, 'people'));
    for (const t of tps) {
      st('touchpoints').delete(t.id);
      st('tombstones').put(tombstone(t.id, 'touchpoints'));
    }
    for (const n of news) {
      st('news').delete(n.id);
      st('tombstones').put(tombstone(n.id, 'news'));
    }
  });
}

// ---- Organizations ----
export const getOrganizations = () => getAll('organizations');
export const getOrganization = (id) => getOne('organizations', id);
export const saveOrganization = (o) => save('organizations', o);

// Removes an organization. Its people stay, just without an organization.
export async function deleteOrganization(id) {
  const people = await getByIndex('people', 'organizationId', id);
  const now = nowISO();
  await write(['organizations', 'people', 'tombstones'], (st) => {
    st('organizations').delete(id);
    st('tombstones').put(tombstone(id, 'organizations'));
    for (const p of people) st('people').put({ ...p, organizationId: null, updatedAt: now });
  });
}

// ---- Touchpoints ----
export const getTouchpoints = () => getAll('touchpoints');
export const getTouchpointsFor = (personId) => getByIndex('touchpoints', 'personId', personId);
export const saveTouchpoint = (t) => save('touchpoints', t);
export const deleteTouchpoint = (id) => remove('touchpoints', id);

// ---- Their news ----
export const getNews = () => getAll('news');
export const getNewsFor = (personId) => getByIndex('news', 'personId', personId);
export const saveNews = (n) => save('news', n);
export const deleteNews = (id) => remove('news', id);

// ---- Weekly reflections (one record per week, keyed by its Monday) ----
export const getWeeks = () => getAll('weeks');
export async function getWeek(weekStart) {
  const list = await getByIndex('weeks', 'weekStart', weekStart);
  return list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] || null;
}
export const saveWeek = (w) => save('weeks', w);

// ---- Settings ----
export async function getSettings() {
  return withDefaults(await getOne('settings', SETTINGS_ID));
}
export function saveSettings(s) {
  return save('settings', { ...s, id: SETTINGS_ID });
}

// ---- Device-only facts ----
export async function getMeta(key) {
  const rec = await getOne('meta', key);
  return rec ? rec.value : undefined;
}
export function setMeta(key, value) {
  return write(['meta'], (st) => st('meta').put({ key, value }));
}

// Asks the browser not to clear this site's storage under pressure. Data
// lives only here, so it's worth asking once there's something to keep.
export async function askToPersist() {
  try {
    if (navigator.storage && navigator.storage.persist && !(await navigator.storage.persisted())) {
      await navigator.storage.persist();
    }
  } catch {
    /* not supported: nothing to do */
  }
}

// ---- Export and import ----
export async function exportAll() {
  const data = {};
  for (const store of SYNCED) data[store] = await getAll(store);
  return { app: 'callback', version: SCHEMA_VERSION, exportedAt: nowISO(), data };
}

// Checks an export file and returns its contents, or throws a friendly error.
export function readExport(payload) {
  if (!payload || payload.app !== 'callback' || !payload.data) {
    throw new Error("This file doesn't look like a Callback export.");
  }
  if (Number(payload.version) > SCHEMA_VERSION) {
    throw new Error('This export comes from a newer version of Callback. Update the app, then try again.');
  }
  const data = {};
  for (const store of SYNCED) {
    const list = Array.isArray(payload.data[store]) ? payload.data[store] : [];
    data[store] = list.filter((r) => r && typeof r.id === 'string');
  }
  return data;
}

const newer = (a, b) => (a.updatedAt || '') > (b.updatedAt || '');

// mode 'replace': clear everything, then load the file.
// mode 'merge': match records by id and keep whichever copy is newer.
export async function importAll(payload, mode) {
  const incoming = readExport(payload);
  const puts = Object.fromEntries(SYNCED.map((s) => [s, []]));
  const dels = Object.fromEntries(SYNCED.map((s) => [s, []]));

  if (mode === 'replace') {
    for (const s of SYNCED) puts[s] = incoming[s];
  } else {
    const local = {};
    for (const s of SYNCED) local[s] = new Map((await getAll(s)).map((r) => [r.id, r]));
    const tombs = new Map([...local.tombstones.values(), ...incoming.tombstones].map((t) => [t.id, t]));

    for (const s of SYNCED) {
      if (s === 'tombstones') continue;
      for (const r of incoming[s]) {
        const t = tombs.get(r.id);
        if (t && (t.deletedAt || '') >= (r.updatedAt || '')) continue;
        const mine = local[s].get(r.id);
        if (!mine || newer(r, mine)) puts[s].push(r);
      }
    }
    for (const t of incoming.tombstones) {
      const mine = local[t.store] && local[t.store].get(t.id);
      if (mine && (t.deletedAt || '') >= (mine.updatedAt || '')) dels[t.store].push(t.id);
      if (!local.tombstones.has(t.id)) puts.tombstones.push(t);
    }

    // Two devices can each start a record for the same week; keep the newer.
    const weeks = new Map();
    for (const w of [...local.weeks.values(), ...puts.weeks]) {
      const kept = weeks.get(w.weekStart);
      if (!kept) weeks.set(w.weekStart, w);
      else if (kept.id !== w.id) {
        const [win, lose] = newer(w, kept) ? [w, kept] : [kept, w];
        weeks.set(w.weekStart, win);
        dels.weeks.push(lose.id);
        puts.weeks = puts.weeks.filter((x) => x.id !== lose.id);
      }
    }
  }

  await write(SYNCED, (st) => {
    if (mode === 'replace') for (const s of SYNCED) st(s).clear();
    for (const s of SYNCED) {
      for (const id of dels[s]) st(s).delete(id);
      for (const r of puts[s]) st(s).put(r);
    }
  });

  const counts = {};
  for (const s of ['people', 'organizations', 'touchpoints', 'news']) counts[s] = puts[s].length;
  return counts;
}

// Wipes every record on this device (meta included).
export async function eraseAll() {
  await write([...SYNCED, 'meta'], (st) => [...SYNCED, 'meta'].forEach((s) => st(s).clear()));
}
