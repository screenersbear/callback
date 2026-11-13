// Export, import (replace and merge), sync's own writes and erasing
// everything (js/db.js).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { freshDb, rawAll, rawPut, pinClock } from './db-helpers.mjs';

let db;
const NOW = '2025-01-01T12:00:00.000Z';
const OLD = '2024-12-01T00:00:00.000Z';
const MID = '2024-12-15T00:00:00.000Z';
const NEW = '2024-12-31T00:00:00.000Z';
const STORES = ['people', 'organizations', 'circles', 'touchpoints', 'news', 'openLoops', 'ideas', 'weeks', 'settings', 'tombstones'];

beforeEach(async () => {
  db = await freshDb();
  pinClock(NOW);
  await db.getPeople();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const file = (data) => ({ app: 'callback', version: 1, data });
const ids = async (store) => (await rawAll(store)).map((r) => r.id);

describe('exportAll', () => {
  it('writes every synced store with defaults filled in', async () => {
    await rawPut('people', [{ id: 'p1', name: 'Test Person', updatedAt: OLD }]);
    await rawPut('news', [{ id: 'n1', updatedAt: OLD }]);
    await rawPut('touchpoints', [{ id: 't1', updatedAt: OLD }]);
    await rawPut('weeks', [{ id: 'w1', weekStart: '2024-12-30', reflection: 'Good week' }]);
    await rawPut('settings', [{ id: 'settings', goals: { touchpoints: 4 } }]);
    await rawPut('organizations', [{ id: 'o1', name: 'Test Org' }]);
    await db.setMeta('lastExport', OLD);
    const out = await db.exportAll();
    expect(out.app).toBe('callback');
    expect(out.version).toBe(1);
    expect(out.exportedAt).toBe(NOW);
    expect(Object.keys(out.data)).toEqual(STORES);
    expect(out.data.people[0]).toMatchObject({ id: 'p1', relationshipType: 'prospect', updatedAt: OLD });
    expect(out.data.news[0]).toEqual({ id: 'n1', updatedAt: OLD, repeatsYearly: false });
    expect(out.data.touchpoints[0]).toEqual({ id: 't1', updatedAt: OLD, lightTouch: false, replyCheckAt: null });
    expect(out.data.weeks[0].points).toEqual([{ id: 'reflection', text: 'Good week' }]);
    expect(out.data.settings[0]).toMatchObject({ id: 'settings', goals: { touchpoints: 4, newPeople: 3 }, cadence: { warm: 42 } });
    expect(out.data.organizations).toEqual([{ id: 'o1', name: 'Test Org' }]);
    expect(out.data.meta).toBeUndefined();
  });
  it('exports empty lists from an empty database', async () => {
    const out = await db.exportAll();
    for (const s of STORES) expect(out.data[s], s).toEqual([]);
  });
  it('keeps the settings id when exporting saved settings', async () => {
    await db.saveSettings({ goals: { newPeople: 1 } });
    const out = await db.exportAll();
    expect(out.data.settings).toHaveLength(1);
    expect(out.data.settings[0].id).toBe('settings');
  });
  it('reads back through importAll as the same data', async () => {
    await db.savePeople([{ id: 'p1', name: 'Test Person' }]);
    await db.saveTouchpoint({ id: 't1', personId: 'p1' });
    await db.deleteNews('n-gone');
    const out = await db.exportAll();
    const other = await freshDb();
    await other.importAll(JSON.parse(JSON.stringify(out)), 'replace');
    expect((await other.exportAll()).data).toEqual(out.data);
  });
});

describe('importAll: replace', () => {
  it('clears everything synced and loads the file, keeping device-only facts', async () => {
    await db.savePeople([{ id: 'old', name: 'Old Person' }]);
    await db.saveIdea({ id: 'i-old' });
    await db.setMeta('installedAt', OLD);
    const counts = await db.importAll(file({
      people: [{ id: 'p1', name: 'Test A', updatedAt: OLD }, { id: 'p2', name: 'Test B', updatedAt: OLD }],
      organizations: [{ id: 'o1' }],
      touchpoints: [{ id: 't1' }, { id: 't2' }, { id: 't3' }],
      news: [],
    }), 'replace');
    expect(counts).toEqual({ changed: true, people: 2, organizations: 1, touchpoints: 3, news: 0 });
    expect(await ids('people')).toEqual(['p1', 'p2']);
    expect(await ids('ideas')).toEqual([]);
    expect(await db.getMeta('installedAt')).toBe(OLD);
    // Defaults are written in, timestamps are kept as they were in the file.
    expect((await rawAll('people'))[0]).toMatchObject({ relationshipType: 'prospect', updatedAt: OLD });
  });
  it('takes the file copy even over a newer copy or a tombstone here', async () => {
    await rawPut('people', [{ id: 'p1', name: 'Here', updatedAt: NEW }, { id: 'p2', name: 'Here', updatedAt: MID }]);
    await rawPut('tombstones', [{ id: 'p3', store: 'people', deletedAt: NEW }]);
    const counts = await db.importAll(file({
      people: [{ id: 'p1', name: 'File', updatedAt: OLD }, { id: 'p2', name: 'File', updatedAt: MID }, { id: 'p3', name: 'File', updatedAt: OLD }],
    }), 'replace');
    expect(counts.people).toBe(3);
    expect((await rawAll('people')).map((p) => p.name)).toEqual(['File', 'File', 'File']);
    expect(await rawAll('tombstones')).toEqual([]);
  });
  it('empties the stores for a file with no records', async () => {
    await db.savePeople([{ id: 'old' }]);
    const counts = await db.importAll(file({}), 'replace');
    expect(counts).toEqual({ changed: true, people: 0, organizations: 0, touchpoints: 0, news: 0 });
    expect(await rawAll('people')).toEqual([]);
  });
  it('rejects a file that is not an export without changing anything', async () => {
    await db.savePeople([{ id: 'keep' }]);
    await expect(db.importAll({ app: 'other', data: {} }, 'replace')).rejects.toThrow("This file doesn't look like a Callback export.");
    await expect(db.importAll(null, 'merge')).rejects.toThrow("This file doesn't look like a Callback export.");
    expect(await ids('people')).toEqual(['keep']);
  });
  it('tells sync about the change unless quiet', async () => {
    const fn = vi.fn();
    db.onSyncedChange(fn);
    await db.importAll(file({}), 'replace');
    expect(fn).toHaveBeenCalledTimes(1);
    await db.importAll(file({}), 'replace', { quiet: true });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('importAll: merge', () => {
  it('adds new records and keeps local ones the file does not have', async () => {
    await rawPut('people', [{ id: 'local', updatedAt: OLD }]);
    const counts = await db.importAll(file({ people: [{ id: 'p1', updatedAt: OLD }], news: [{ id: 'n1', updatedAt: OLD }] }), 'merge');
    expect(counts).toEqual({ changed: true, people: 1, organizations: 0, touchpoints: 0, news: 1 });
    expect(await ids('people')).toEqual(['local', 'p1']);
  });
  it('keeps whichever copy is newer, and the local one on a tie', async () => {
    await rawPut('organizations', [
      { id: 'older-here', name: 'Here', updatedAt: OLD },
      { id: 'newer-here', name: 'Here', updatedAt: NEW },
      { id: 'tie', name: 'Here', updatedAt: MID },
      { id: 'no-date-here', name: 'Here' },
    ]);
    const counts = await db.importAll(file({
      organizations: [
        { id: 'older-here', name: 'File', updatedAt: MID },
        { id: 'newer-here', name: 'File', updatedAt: MID },
        { id: 'tie', name: 'File', updatedAt: MID },
        { id: 'no-date-here', name: 'File', updatedAt: OLD },
      ],
    }), 'merge');
    expect(counts.organizations).toBe(2);
    const names = Object.fromEntries((await rawAll('organizations')).map((o) => [o.id, o.name]));
    expect(names).toEqual({ 'older-here': 'File', 'newer-here': 'Here', tie: 'Here', 'no-date-here': 'File' });
  });
  it('does not take an incoming copy without a date over a local one', async () => {
    await rawPut('ideas', [{ id: 'i1', text: 'Here', updatedAt: OLD }]);
    const counts = await db.importAll(file({ ideas: [{ id: 'i1', text: 'File' }] }), 'merge');
    expect(counts.changed).toBe(false);
    expect((await rawAll('ideas'))[0].text).toBe('Here');
  });
  it('lets stores in incomingWins take the file copy even when older', async () => {
    await rawPut('settings', [{ id: 'settings', goals: { touchpoints: 9 }, updatedAt: NEW }]);
    await rawPut('ideas', [{ id: 'i1', text: 'Here', updatedAt: NEW }]);
    await db.importAll(file({
      settings: [{ id: 'settings', goals: { touchpoints: 2 }, updatedAt: OLD }],
      ideas: [{ id: 'i1', text: 'File', updatedAt: OLD }],
    }), 'merge', { incomingWins: ['settings'] });
    expect((await db.getSettings()).goals.touchpoints).toBe(2);
    expect((await rawAll('ideas'))[0].text).toBe('Here');
  });
  it('reports no change and does not write when the file adds nothing', async () => {
    await rawPut('people', [{ id: 'p1', updatedAt: NEW }]);
    const fn = vi.fn();
    db.onSyncedChange(fn);
    const counts = await db.importAll(file({ people: [{ id: 'p1', updatedAt: OLD }] }), 'merge');
    expect(counts).toEqual({ changed: false, people: 0, organizations: 0, touchpoints: 0, news: 0 });
    expect(fn).not.toHaveBeenCalled();
  });
  it('tells sync about a change unless quiet', async () => {
    const fn = vi.fn();
    db.onSyncedChange(fn);
    await db.importAll(file({ people: [{ id: 'p1', updatedAt: OLD }] }), 'merge');
    expect(fn).toHaveBeenCalledTimes(1);
    await db.importAll(file({ people: [{ id: 'p2', updatedAt: OLD }] }), 'merge', { quiet: true });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(await ids('people')).toEqual(['p1', 'p2']);
  });
  it('treats any mode other than replace as a merge', async () => {
    await rawPut('people', [{ id: 'local', updatedAt: OLD }]);
    await db.importAll(file({ people: [{ id: 'p1', updatedAt: OLD }] }), undefined);
    expect(await ids('people')).toEqual(['local', 'p1']);
  });

  describe('tombstones', () => {
    it('does not bring back a record deleted here after the file copy was saved', async () => {
      await rawPut('tombstones', [{ id: 't1', store: 'touchpoints', deletedAt: MID }, { id: 't2', store: 'touchpoints', deletedAt: MID }]);
      const counts = await db.importAll(file({
        touchpoints: [{ id: 't1', updatedAt: OLD }, { id: 't2', updatedAt: MID }],
      }), 'merge');
      expect(counts.touchpoints).toBe(0);
      expect(await rawAll('touchpoints')).toEqual([]);
    });
    it('brings back a record edited after it was deleted', async () => {
      await rawPut('tombstones', [{ id: 't1', store: 'touchpoints', deletedAt: MID }]);
      await db.importAll(file({ touchpoints: [{ id: 't1', updatedAt: NEW }] }), 'merge');
      expect(await ids('touchpoints')).toEqual(['t1']);
    });
    it('uses a tombstone from the file to block its record', async () => {
      await db.importAll(file({
        news: [{ id: 'n1', updatedAt: OLD }],
        tombstones: [{ id: 'n1', store: 'news', deletedAt: MID }],
      }), 'merge');
      expect(await rawAll('news')).toEqual([]);
      expect(await ids('tombstones')).toEqual(['n1']);
    });
    it('treats a missing deletion date or edit date as the earliest', async () => {
      await rawPut('tombstones', [
        { id: 'a', store: 'ideas' },
        { id: 'b', store: 'ideas', deletedAt: OLD },
        { id: 'c', store: 'ideas' },
      ]);
      await db.importAll(file({ ideas: [{ id: 'a', updatedAt: OLD }, { id: 'b' }, { id: 'c' }] }), 'merge');
      expect(await ids('ideas')).toEqual(['a']);
    });
    it('deletes local records the file deleted later, keeping ones edited since', async () => {
      await rawPut('people', [
        { id: 'gone', updatedAt: OLD },
        { id: 'tie', updatedAt: MID },
        { id: 'kept', updatedAt: NEW },
        { id: 'undated' },
      ]);
      const counts = await db.importAll(file({
        tombstones: [
          { id: 'gone', store: 'people', deletedAt: MID },
          { id: 'tie', store: 'people', deletedAt: MID },
          { id: 'kept', store: 'people', deletedAt: MID },
          { id: 'undated', store: 'people', deletedAt: OLD },
        ],
      }), 'merge');
      expect(counts.changed).toBe(true);
      expect(await ids('people')).toEqual(['kept']);
      expect(await ids('tombstones')).toEqual(['gone', 'kept', 'tie', 'undated']);
    });
    it('keeps a local record when the file tombstone has no date', async () => {
      await rawPut('people', [{ id: 'p1', updatedAt: OLD }]);
      await db.importAll(file({ tombstones: [{ id: 'p1', store: 'people' }] }), 'merge');
      expect(await ids('people')).toEqual(['p1']);
    });
    it('does not save a tombstone this device already has', async () => {
      await rawPut('tombstones', [{ id: 'x', store: 'news', deletedAt: OLD, note: 'here' }]);
      const counts = await db.importAll(file({ tombstones: [{ id: 'x', store: 'news', deletedAt: NEW, note: 'file' }] }), 'merge');
      expect(counts.changed).toBe(false);
      expect((await rawAll('tombstones'))[0].note).toBe('here');
    });
    it('keeps its own copy of a tombstone even when the file copy was updated later', async () => {
      await rawPut('tombstones', [{ id: 'x', store: 'news', deletedAt: OLD, updatedAt: OLD, note: 'here' }]);
      await db.importAll(file({ tombstones: [{ id: 'x', store: 'news', deletedAt: OLD, updatedAt: NEW, note: 'file' }] }), 'merge');
      expect(await rawAll('tombstones')).toEqual([{ id: 'x', store: 'news', deletedAt: OLD, updatedAt: OLD, note: 'here' }]);
    });
    it('keeps a tombstone for a store this version does not know', async () => {
      const counts = await db.importAll(file({ tombstones: [{ id: 'q1', store: 'someFutureStore', deletedAt: OLD }] }), 'merge');
      expect(counts.changed).toBe(true);
      expect(await ids('tombstones')).toEqual(['q1']);
    });
    it('takes the file version of a record the file both deleted and re-made', async () => {
      await rawPut('news', [{ id: 'n1', text: 'Here', updatedAt: OLD }]);
      await db.importAll(file({
        news: [{ id: 'n1', text: 'File', updatedAt: NEW }],
        tombstones: [{ id: 'n1', store: 'news', deletedAt: MID }],
      }), 'merge');
      expect(await rawAll('news')).toEqual([{ id: 'n1', text: 'File', updatedAt: NEW, repeatsYearly: false }]);
    });
  });

  describe('two records for the same week', () => {
    it('keeps the newer incoming week and deletes the local one', async () => {
      await rawPut('weeks', [{ id: 'w-here', weekStart: '2024-12-30', updatedAt: OLD }]);
      await db.importAll(file({ weeks: [{ id: 'w-file', weekStart: '2024-12-30', updatedAt: NEW }] }), 'merge');
      expect(await ids('weeks')).toEqual(['w-file']);
    });
    it('keeps the newer local week and skips the incoming one', async () => {
      await rawPut('weeks', [{ id: 'w-here', weekStart: '2024-12-30', updatedAt: NEW }]);
      await db.importAll(file({ weeks: [{ id: 'w-file', weekStart: '2024-12-30', updatedAt: OLD }] }), 'merge');
      expect(await ids('weeks')).toEqual(['w-here']);
    });
    it('keeps only the newest of three', async () => {
      await rawPut('weeks', [{ id: 'w-a', weekStart: '2024-12-30', updatedAt: OLD }]);
      await db.importAll(file({
        weeks: [
          { id: 'w-b', weekStart: '2024-12-30', updatedAt: NEW },
          { id: 'w-c', weekStart: '2024-12-30', updatedAt: MID },
        ],
      }), 'merge');
      expect(await ids('weeks')).toEqual(['w-b']);
    });
    it('takes a newer copy of the same week record', async () => {
      await rawPut('weeks', [{ id: 'w1', weekStart: '2024-12-30', points: [], updatedAt: OLD }]);
      await db.importAll(file({ weeks: [{ id: 'w1', weekStart: '2024-12-30', points: [{ id: 'a', text: 'Called' }], updatedAt: NEW }] }), 'merge');
      const weeks = await rawAll('weeks');
      expect(weeks).toHaveLength(1);
      expect(weeks[0].points).toEqual([{ id: 'a', text: 'Called' }]);
    });
    it('keeps different weeks side by side', async () => {
      await rawPut('weeks', [{ id: 'w1', weekStart: '2024-12-30', updatedAt: OLD }]);
      await db.importAll(file({ weeks: [{ id: 'w2', weekStart: '2025-01-06', updatedAt: OLD }] }), 'merge');
      expect(await ids('weeks')).toEqual(['w1', 'w2']);
    });
  });
});

describe('applySync', () => {
  it('applies deletes and puts per store in one go', async () => {
    await rawPut('people', [{ id: 'p1' }, { id: 'p2' }]);
    const fn = vi.fn();
    db.onSyncedChange(fn);
    const changed = await db.applySync(
      { people: [{ id: 'p3', updatedAt: NEW }], news: [{ id: 'n1' }] },
      { people: ['p1'] },
    );
    expect(changed).toBe(true);
    expect(await ids('people')).toEqual(['p2', 'p3']);
    expect(await ids('news')).toEqual(['n1']);
    // Quiet: sync's own writes are not sent straight back.
    expect(fn).not.toHaveBeenCalled();
  });
  it('returns false and writes nothing when there is nothing to do', async () => {
    const spy = vi.spyOn(IDBDatabase.prototype, 'transaction');
    expect(await db.applySync({}, {})).toBe(false);
    expect(await db.applySync({ people: [] }, { news: [] })).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
  it('works with only deletes or only puts', async () => {
    await rawPut('ideas', [{ id: 'i1' }]);
    expect(await db.applySync({}, { ideas: ['i1'] })).toBe(true);
    expect(await rawAll('ideas')).toEqual([]);
    expect(await db.applySync({ circles: [{ id: 'c1' }] }, {})).toBe(true);
    expect(await ids('circles')).toEqual(['c1']);
  });
  it('deletes before it puts, so a re-made record stays', async () => {
    await rawPut('openLoops', [{ id: 'l1', text: 'Old' }]);
    await db.applySync({ openLoops: [{ id: 'l1', text: 'New' }] }, { openLoops: ['l1'] });
    expect(await rawAll('openLoops')).toEqual([{ id: 'l1', text: 'New' }]);
  });
  it('ignores stores that are not synced', async () => {
    await db.setMeta('k', 1);
    expect(await db.applySync({ meta: [{ key: 'k', value: 2 }] }, { meta: ['k'] })).toBe(false);
    expect(await db.getMeta('k')).toBe(1);
  });
});

describe('eraseAll', () => {
  it('wipes every store, device-only facts included', async () => {
    await db.savePeople([{ id: 'p1' }]);
    await db.deleteNews('n1');
    await db.saveSettings({});
    await db.setMeta('installedAt', OLD);
    await db.eraseAll();
    for (const s of [...STORES, 'meta']) expect(await rawAll(s), s).toEqual([]);
  });
  it('works on an empty database', async () => {
    await expect(db.eraseAll()).resolves.toBeUndefined();
    expect(await rawAll('people')).toEqual([]);
  });
  it('leaves the database usable afterwards', async () => {
    await db.savePeople([{ id: 'p1' }]);
    await db.eraseAll();
    await db.savePerson({ id: 'p2' });
    expect(await ids('people')).toEqual(['p2']);
  });
});
