// js/merge.js planMerge: what a sync changes on this device, which records
// clash, and which are held until a clash is answered.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { planMerge, STORES } from '../../js/merge.js';

const T0 = '2026-01-01T00:00:00.000Z';
const T1 = '2026-01-02T00:00:00.000Z';
const T2 = '2026-01-03T00:00:00.000Z';
const T3 = '2026-01-04T00:00:00.000Z';
const NOW = '2026-02-01T12:00:00.000Z';

const person = (id, extra = {}) => ({ id, createdAt: T0, updatedAt: T1, name: 'Test Person', ...extra });
const rec = (id, extra = {}) => ({ id, createdAt: T0, updatedAt: T1, ...extra });
const tomb = (store, id, deletedAt) => ({ id, store, deletedAt, createdAt: deletedAt, updatedAt: deletedAt });
const baseOf = (store, ...recs) => ({ [store]: Object.fromEntries(recs.map((r) => [r.id, r])) });
const plan = (local, remote, base = null, opts = {}) => planMerge(local, remote, base, { now: NOW, ...opts });
// Only the stores with something in them, so a test states everything that happens.
const nonEmpty = (byStore) => Object.fromEntries(Object.entries(byStore).filter(([, v]) => v.length));

afterEach(() => {
  vi.useRealTimers();
});

describe('planMerge: the shape of the plan', () => {
  it('plans nothing for two empty data sets', () => {
    const r = plan({}, {});
    expect(Object.keys(r.puts)).toEqual(STORES);
    expect(Object.keys(r.dels)).toEqual(STORES);
    expect(nonEmpty(r.puts)).toEqual({});
    expect(nonEmpty(r.dels)).toEqual({});
    expect(r.conflicts).toEqual([]);
    expect([...r.held]).toEqual([]);
    expect(r.changed).toBe(false);
  });

  it('works without options, stamping merged records with the current time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-04T05:06:07.000Z'));
    const b = person('p1', { city: 'A', note: 'n' });
    const r = planMerge({ people: [{ ...b, city: 'B', updatedAt: T2 }] }, { people: [{ ...b, note: 'm', updatedAt: T2 }] }, baseOf('people', b));
    expect(r.puts.people).toEqual([{ id: 'p1', createdAt: T0, updatedAt: '2026-03-04T05:06:07.000Z', name: 'Test Person', city: 'B', note: 'm' }]);
  });

  it('copes with data sets missing whole stores', () => {
    const r = plan({ people: [person('p1')] }, { organizations: [rec('o1')] });
    expect(nonEmpty(r.puts)).toEqual({ organizations: [rec('o1')] });
    expect(r.changed).toBe(true);
  });

  it('marks a plan with only deletions as a change', () => {
    const t = tomb('people', 'p1', T3);
    const r = plan({ people: [person('p1')], tombstones: [t] }, { people: [person('p1', { city: 'X', updatedAt: T2 })], tombstones: [{ ...t }] });
    expect(nonEmpty(r.dels)).toEqual({ people: ['p1'] });
    expect(nonEmpty(r.puts)).toEqual({});
    expect(r.changed).toBe(true);
  });

  it('marks a deletion that came with its tombstone as a change', () => {
    const p = person('p1');
    const r = plan({ people: [p] }, { tombstones: [tomb('people', 'p1', T2)] }, baseOf('people', p));
    expect(nonEmpty(r.dels)).toEqual({ people: ['p1'] });
    expect(nonEmpty(r.puts)).toEqual({ tombstones: [tomb('people', 'p1', T2)] });
    expect(r.changed).toBe(true);
  });

  it('treats a missing store here as empty (nothing made up to delete)', () => {
    const w = { id: 'w1', updatedAt: T1 };
    const r = plan({}, { weeks: [w] });
    expect(r.puts.weeks).toEqual([w]);
    expect(r.dels.weeks).toEqual([]);
    const t = tomb('ideas', 'i1', T1);
    const r2 = plan({ tombstones: [t] }, {});
    expect(r2.changed).toBe(false);
  });

  it('marks a plan with only puts as a change', () => {
    const r = plan({}, { ideas: [rec('i1')] });
    expect(r.changed).toBe(true);
  });

  it('does not touch the data passed in', () => {
    const local = { people: [person('p1', { city: 'A' })], weeks: [rec('w1', { weekStart: '2026-01-05' })] };
    const remote = { people: [person('p1', { city: 'B', updatedAt: T2 })], weeks: [rec('w2', { weekStart: '2026-01-05', updatedAt: T2 })] };
    const before = JSON.stringify([local, remote]);
    plan(local, remote, baseOf('people', person('p1')));
    expect(JSON.stringify([local, remote])).toBe(before);
  });
});

describe('planMerge: a record on one side only, nothing deleted', () => {
  it('takes a record that is new in the shared file', () => {
    const r = plan({}, { people: [person('p1')] });
    expect(nonEmpty(r.puts)).toEqual({ people: [person('p1')] });
  });

  it('leaves a record that is new here (it goes out with the file)', () => {
    const r = plan({ people: [person('p1')] }, {});
    expect(nonEmpty(r.puts)).toEqual({});
    expect(nonEmpty(r.dels)).toEqual({});
    expect(r.changed).toBe(false);
  });

  it('does the same for every record store', () => {
    for (const s of STORES.filter((x) => x !== 'tombstones')) {
      const r = plan({}, { [s]: [rec('x1', { weekStart: '2026-01-05' })] });
      expect(nonEmpty(r.puts)).toEqual({ [s]: [rec('x1', { weekStart: '2026-01-05' })] });
    }
  });
});

describe('planMerge: the same record on both sides, with a last-agreed copy', () => {
  const b = person('p1', { city: 'Base Town', note: 'base note' });

  it('does nothing when the copies are identical', () => {
    const r = plan({ people: [b] }, { people: [{ ...b }] }, baseOf('people', b));
    expect(r.changed).toBe(false);
    expect(r.conflicts).toEqual([]);
  });

  it('takes the shared copy when only it changed', () => {
    const theirs = { ...b, city: 'Their Town', updatedAt: T2 };
    const r = plan({ people: [b] }, { people: [theirs] }, baseOf('people', b));
    expect(nonEmpty(r.puts)).toEqual({ people: [theirs] });
  });

  it('takes the shared copy when only it changed, even if this copy looks newer', () => {
    const theirs = { ...b, city: 'Their Town', updatedAt: T1 };
    const mine = { ...b, updatedAt: T3 };
    const r = plan({ people: [mine] }, { people: [theirs] }, baseOf('people', b));
    expect(nonEmpty(r.puts)).toEqual({ people: [theirs] });
  });

  it('keeps this copy when only it changed (it goes out with the file)', () => {
    const mine = { ...b, city: 'My Town', updatedAt: T2 };
    const theirs = { ...b, updatedAt: T3 };
    const r = plan({ people: [mine] }, { people: [theirs] }, baseOf('people', b));
    expect(r.changed).toBe(false);
    expect(r.conflicts).toEqual([]);
  });

  it('takes the newer stamps when nothing but stamps changed', () => {
    const newerThere = plan({ people: [b] }, { people: [{ ...b, updatedAt: T2 }] }, baseOf('people', b));
    expect(nonEmpty(newerThere.puts)).toEqual({ people: [{ ...b, updatedAt: T2 }] });
    const newerHere = plan({ people: [{ ...b, updatedAt: T2 }] }, { people: [b] }, baseOf('people', b));
    expect(newerHere.changed).toBe(false);
  });

  it('takes the newer copy when both made the same change', () => {
    const mine = { ...b, city: 'Same Town', updatedAt: T2 };
    const theirs = { ...b, city: 'Same Town', updatedAt: T3 };
    expect(nonEmpty(plan({ people: [mine] }, { people: [theirs] }, baseOf('people', b)).puts)).toEqual({ people: [theirs] });
    const r = plan({ people: [theirs] }, { people: [mine] }, baseOf('people', b));
    expect(r.changed).toBe(false);
    expect(r.conflicts).toEqual([]);
  });

  it('keeps both changes when different fields changed, stamped as the newest copy', () => {
    const mine = { ...b, city: 'My Town', updatedAt: T2 };
    const theirs = { ...b, note: 'their note', updatedAt: T3 };
    const r = plan({ people: [mine] }, { people: [theirs] }, baseOf('people', b));
    expect(nonEmpty(r.puts)).toEqual({ people: [{ id: 'p1', createdAt: T0, updatedAt: NOW, name: 'Test Person', city: 'My Town', note: 'their note' }] });
    expect(r.conflicts).toEqual([]);
    expect([...r.held]).toEqual([]);
  });

  it('keeps the createdAt of whichever copy has one', () => {
    const mine = { ...b, city: 'My Town', createdAt: undefined };
    const theirs = { ...b, note: 'their note', createdAt: 'their-created' };
    const r = plan({ people: [mine] }, { people: [theirs] }, baseOf('people', b));
    expect(r.puts.people[0].createdAt).toBe('their-created');
  });

  it('holds a real clash: same field, different values', () => {
    const mine = { ...b, city: 'My Town', note: 'my note', updatedAt: T2 };
    const theirs = { ...b, city: 'Their Town', updatedAt: T3 };
    const r = plan({ people: [mine] }, { people: [theirs] }, baseOf('people', b));
    expect(nonEmpty(r.puts)).toEqual({});
    expect(r.changed).toBe(false);
    expect(r.conflicts).toEqual([{
      kind: 'both', store: 'people', id: 'p1', mine, theirs, base: b,
      merged: { name: 'Test Person', city: 'My Town', note: 'my note' }, clashes: ['city'], loud: ['city'], children: [],
    }]);
    expect([...r.held]).toEqual(['people/p1']);
  });

  it('lists only the clashes worth asking about as loud', () => {
    const mine = { ...b, city: 'My Town', lastSeenAt: 'a', updatedAt: T2 };
    const theirs = { ...b, city: 'Their Town', lastSeenAt: 'b', updatedAt: T3 };
    const [c] = plan({ people: [mine] }, { people: [theirs] }, baseOf('people', b)).conflicts;
    expect(c.clashes).toEqual(['city', 'lastSeenAt']);
    expect(c.loud).toEqual(['city']);
  });

  it('settles bookkeeping-only clashes with the newer copy (the shared one)', () => {
    const mine = { ...b, sortOrder: 1, lastSeenAt: 'mine', city: 'My Town', updatedAt: T2 };
    const theirs = { ...b, sortOrder: 2, lastSeenAt: 'theirs', updatedAt: T3 };
    const r = plan({ people: [mine] }, { people: [theirs] }, baseOf('people', b));
    expect(r.conflicts).toEqual([]);
    expect(r.puts.people).toEqual([{ id: 'p1', createdAt: T0, updatedAt: NOW, name: 'Test Person', city: 'My Town', note: 'base note', sortOrder: 2, lastSeenAt: 'theirs' }]);
  });

  it('settles bookkeeping-only clashes with the newer copy (this one)', () => {
    const mine = { ...b, sortOrder: 1, updatedAt: T3 };
    const theirs = { ...b, sortOrder: 2, note: 'their note', updatedAt: T2 };
    const r = plan({ people: [mine] }, { people: [theirs] }, baseOf('people', b));
    expect(r.puts.people).toEqual([{ id: 'p1', createdAt: T0, updatedAt: NOW, name: 'Test Person', city: 'Base Town', note: 'their note', sortOrder: 1 }]);
  });

  it('settles a bookkeeping clash where the newer copy dropped the field', () => {
    const bb = { ...b, sortOrder: 0 };
    const mine = { ...bb, sortOrder: 1, updatedAt: T2 };
    const theirs = { ...bb, sortOrder: undefined, updatedAt: T3 };
    delete theirs.sortOrder;
    const r = plan({ people: [mine] }, { people: [theirs] }, baseOf('people', bb));
    expect(r.puts.people).toHaveLength(1);
    expect('sortOrder' in r.puts.people[0]).toBe(false);
  });

  it('merges nested settings field by field', () => {
    const sb = rec('settings', { cadence: { inner: 30, outer: 90 }, goal: 'g' });
    const mine = { ...sb, cadence: { inner: 14, outer: 90 }, updatedAt: T2 };
    const theirs = { ...sb, cadence: { inner: 30, outer: 120 }, updatedAt: T3 };
    const r = plan({ settings: [mine] }, { settings: [theirs] }, baseOf('settings', sb));
    expect(r.puts.settings).toEqual([{ id: 'settings', createdAt: T0, updatedAt: NOW, goal: 'g', cadence: { inner: 14, outer: 120 } }]);
  });

  it('holds a nested clash with its dotted path', () => {
    const sb = rec('settings', { cadence: { inner: 30 } });
    const r = plan({ settings: [{ ...sb, cadence: { inner: 14 } }] }, { settings: [{ ...sb, cadence: { inner: 60 } }] }, baseOf('settings', sb));
    expect(r.conflicts.map((c) => c.clashes)).toEqual([['cadence.inner']]);
    expect([...r.held]).toEqual(['settings/settings']);
  });

  it('treats a week reflection as bookkeeping, but not a person\'s', () => {
    const wb = rec('w1', { weekStart: '2026-01-05', reflection: 'base' });
    const weeks = plan({ weeks: [{ ...wb, reflection: 'mine', updatedAt: T2 }] }, { weeks: [{ ...wb, reflection: 'theirs', updatedAt: T3 }] }, baseOf('weeks', wb));
    expect(weeks.conflicts).toEqual([]);
    expect(weeks.puts.weeks[0].reflection).toBe('theirs');
    const pb = person('p1', { reflection: 'base' });
    const people = plan({ people: [{ ...pb, reflection: 'mine' }] }, { people: [{ ...pb, reflection: 'theirs' }] }, baseOf('people', pb));
    expect(people.conflicts).toHaveLength(1);
  });

  it('lets the stores in incomingWins take the shared copy whatever changed', () => {
    const sb = rec('settings', { goal: 'base goal' });
    const mine = { ...sb, goal: 'my goal', updatedAt: T3 };
    const theirs = { ...sb, updatedAt: T1 };
    const r = plan({ settings: [mine], people: [{ ...b, city: 'Mine' }] }, { settings: [theirs], people: [b] }, { ...baseOf('settings', sb), ...baseOf('people', b) }, { incomingWins: ['settings'] });
    expect(nonEmpty(r.puts)).toEqual({ settings: [theirs] });
  });

  it('lets incomingWins take the shared copy with no last-agreed copy too', () => {
    const mine = rec('settings', { goal: 'my goal', updatedAt: T3 });
    const theirs = rec('settings', { goal: 'their goal', updatedAt: T1 });
    expect(nonEmpty(plan({ settings: [mine] }, { settings: [theirs] }, null, { incomingWins: ['settings'] }).puts)).toEqual({ settings: [theirs] });
    expect(nonEmpty(plan({ settings: [mine] }, { settings: [theirs] }, null).puts)).toEqual({});
  });

  it('does not use incomingWins when the copies are the same', () => {
    const s = rec('settings', { goal: 'g' });
    expect(plan({ settings: [s] }, { settings: [{ ...s }] }, null, { incomingWins: ['settings'] }).changed).toBe(false);
  });

  it('ignores a base copy for another id or store', () => {
    const mine = person('p1', { city: 'Mine', updatedAt: T3 });
    const theirs = person('p1', { city: 'Theirs', updatedAt: T2 });
    const r = plan({ people: [mine] }, { people: [theirs] }, { people: { other: person('other') }, organizations: { p1: mine } });
    // No base for p1: plain rule, this newer copy stays.
    expect(r.changed).toBe(false);
    expect(r.conflicts).toEqual([]);
  });
});

describe('planMerge: the same record on both sides, no last-agreed copy', () => {
  const old = person('p1', { city: 'Old', updatedAt: T1 });
  const nw = person('p1', { city: 'New', updatedAt: T2 });

  it('takes the shared copy when it is newer', () => {
    expect(nonEmpty(plan({ people: [old] }, { people: [nw] }).puts)).toEqual({ people: [nw] });
  });

  it('keeps this copy when it is newer', () => {
    expect(plan({ people: [nw] }, { people: [old] }).changed).toBe(false);
  });

  it('keeps this copy when both are equally new', () => {
    expect(plan({ people: [old] }, { people: [{ ...old, city: 'Other' }] }).changed).toBe(false);
  });

  it('counts a copy with a time as newer than one with none', () => {
    const noTime = { ...old, updatedAt: undefined };
    expect(nonEmpty(plan({ people: [noTime] }, { people: [old] }).puts)).toEqual({ people: [old] });
    expect(plan({ people: [old] }, { people: [{ ...noTime, city: 'x' }] }).changed).toBe(false);
  });

  it('deletes when the file deleted it after both copies were saved', () => {
    const t = tomb('people', 'p1', T3);
    const r = plan({ people: [old] }, { people: [nw], tombstones: [t] });
    expect(nonEmpty(r.puts)).toEqual({ tombstones: [t] });
    expect(nonEmpty(r.dels)).toEqual({ people: ['p1'] });
  });

  it('deletes when the deletion happened at the very same moment as the newest save', () => {
    const t = tomb('people', 'p1', T2);
    const r = plan({ people: [old] }, { people: [nw], tombstones: [t] });
    expect(nonEmpty(r.dels)).toEqual({ people: ['p1'] });
    const r2 = plan({ people: [nw] }, { people: [old], tombstones: [t] });
    expect(nonEmpty(r2.dels)).toEqual({ people: ['p1'] });
  });

  it('does not take the newer shared copy when this device deleted it after that', () => {
    const r = plan({ people: [old], tombstones: [tomb('people', 'p1', T3)] }, { people: [nw] });
    expect(r.changed).toBe(false);
  });

  it('takes the newer shared copy when it was brought back after a deletion here', () => {
    const r = plan({ people: [old], tombstones: [tomb('people', 'p1', T1)] }, { people: [{ ...nw, updatedAt: T3 }] });
    expect(nonEmpty(r.puts)).toEqual({ people: [{ ...nw, updatedAt: T3 }] });
  });

  it('takes the newer shared copy when the file\'s deletion is older than it', () => {
    const t = tomb('people', 'p1', T1);
    const r = plan({ people: [old] }, { people: [{ ...nw, updatedAt: T3 }], tombstones: [t] });
    expect(nonEmpty(r.puts)).toEqual({ people: [{ ...nw, updatedAt: T3 }], tombstones: [t] });
    expect(nonEmpty(r.dels)).toEqual({});
  });

  it('goes by the file\'s deletion first when both sides have one', () => {
    // The file's deletion is old, so the newer shared copy wins even though
    // this device deleted it later.
    const r = plan({ people: [old], tombstones: [tomb('people', 'p1', T3)] }, { people: [nw], tombstones: [tomb('people', 'p1', T0)] });
    expect(r.puts.people).toEqual([nw]);
  });

  it('keeps this newer copy when the file\'s deletion is between the two saves', () => {
    const r = plan({ people: [{ ...nw, updatedAt: T3 }] }, { people: [old], tombstones: [tomb('people', 'p1', T2)] });
    expect(nonEmpty(r.dels)).toEqual({});
    expect(r.puts.people).toEqual([]);
  });

  it('treats a deletion with no time as older than any save', () => {
    const t = { id: 'p1', store: 'people' };
    const r = plan({ people: [old] }, { people: [nw], tombstones: [t] });
    expect(r.puts.people).toEqual([nw]);
    expect(r.dels.people).toEqual([]);
    const r2 = plan({ people: [nw] }, { people: [old], tombstones: [t] });
    expect(r2.dels.people).toEqual([]);
  });

  it('keeps this dated copy when the file has an undated copy and an undated deletion', () => {
    const r = plan({ people: [{ id: 'p1', name: 'A', updatedAt: T1 }] }, { people: [{ id: 'p1', name: 'B' }], tombstones: [{ id: 'p1', store: 'people' }] });
    expect(r.dels.people).toEqual([]);
    expect(r.puts.people).toEqual([]);
  });

  it('deletes copies with no times at all when the file has a deletion', () => {
    const a = { id: 'p1', name: 'A' };
    const bb = { id: 'p1', name: 'B' };
    const r = plan({ people: [a] }, { people: [bb], tombstones: [{ id: 'p1', store: 'people' }] });
    expect(r.dels.people).toEqual(['p1']);
  });
});

describe('planMerge: here, not in the file', () => {
  const b = person('p1', { city: 'Base' });

  it('deletes it when the file deleted it and it is unchanged here', () => {
    const t = tomb('people', 'p1', T2);
    const r = plan({ people: [{ ...b, updatedAt: T3 }] }, { tombstones: [t] }, baseOf('people', b));
    expect(nonEmpty(r.dels)).toEqual({ people: ['p1'] });
    expect(nonEmpty(r.puts)).toEqual({ tombstones: [t] });
  });

  it('holds it when the file deleted it but it changed here', () => {
    const t = tomb('people', 'p1', T3);
    const mine = { ...b, city: 'Changed', updatedAt: T2 };
    const r = plan({ people: [mine] }, { tombstones: [t] }, baseOf('people', b));
    expect(r.conflicts).toEqual([{ kind: 'deletedThere', store: 'people', id: 'p1', mine, theirs: null, tomb: t, base: b, children: [] }]);
    expect([...r.held]).toEqual(['people/p1']);
    // The file's deletion waits too.
    expect(r.changed).toBe(false);
  });

  it('with no last-agreed copy, deletes it when the deletion is newer (or as new)', () => {
    expect(plan({ people: [b] }, { tombstones: [tomb('people', 'p1', T2)] }).dels.people).toEqual(['p1']);
    expect(plan({ people: [b] }, { tombstones: [tomb('people', 'p1', T1)] }).dels.people).toEqual(['p1']);
  });

  it('with no last-agreed copy, keeps it when it was saved after the deletion', () => {
    const r = plan({ people: [{ ...b, updatedAt: T3 }] }, { tombstones: [tomb('people', 'p1', T2)] });
    expect(r.dels.people).toEqual([]);
    expect(r.conflicts).toEqual([]);
  });

  it('with no last-agreed copy, keeps a dated record when the file\'s deletion has no time', () => {
    const r = plan({ people: [b] }, { tombstones: [{ id: 'p1', store: 'people' }] });
    expect(r.dels.people).toEqual([]);
  });

  it('with no times on either, deletes it', () => {
    expect(plan({ people: [{ id: 'p1' }] }, { tombstones: [{ id: 'p1', store: 'people' }] }).dels.people).toEqual(['p1']);
  });

  it('matches a deletion by id alone (ids are unique across stores)', () => {
    const r = plan({ people: [b] }, { tombstones: [tomb('ideas', 'p1', T3)] }, baseOf('people', b));
    // A deletion is matched by id (ids are unique across stores).
    expect(r.dels.people).toEqual(['p1']);
  });
});

describe('planMerge: in the file, not here', () => {
  const b = person('p1', { city: 'Base' });

  it('takes it when this device never had it', () => {
    expect(plan({}, { people: [b] }).puts.people).toEqual([b]);
  });

  it('skips it when the file also deleted it later (or at the same time)', () => {
    expect(plan({}, { people: [b], tombstones: [tomb('people', 'p1', T2)] }).puts.people).toEqual([]);
    expect(plan({}, { people: [b], tombstones: [tomb('people', 'p1', T1)] }).puts.people).toEqual([]);
  });

  it('takes it when the file\'s deletion is older than it', () => {
    expect(plan({}, { people: [b], tombstones: [tomb('people', 'p1', T0)] }).puts.people).toEqual([b]);
  });

  it('keeps it deleted when it was deleted here and is unchanged there', () => {
    const r = plan({ tombstones: [tomb('people', 'p1', T2)] }, { people: [{ ...b, updatedAt: T3 }] }, baseOf('people', b));
    expect(r.changed).toBe(false);
    expect(r.conflicts).toEqual([]);
  });

  it('holds it when it was deleted here but changed there', () => {
    const t = tomb('people', 'p1', T3);
    const theirs = { ...b, city: 'Changed', updatedAt: T2 };
    const r = plan({ tombstones: [t] }, { people: [theirs] }, baseOf('people', b));
    expect(r.conflicts).toEqual([{ kind: 'deletedHere', store: 'people', id: 'p1', mine: null, theirs, tomb: t, base: b, children: [] }]);
    expect([...r.held]).toEqual(['people/p1']);
    expect(r.changed).toBe(false);
  });

  it('with no last-agreed copy, takes it back when it was saved after the deletion here', () => {
    expect(plan({ tombstones: [tomb('people', 'p1', T0)] }, { people: [b] }).puts.people).toEqual([b]);
  });

  it('with no last-agreed copy, keeps it deleted when the deletion is newer or as new', () => {
    expect(plan({ tombstones: [tomb('people', 'p1', T2)] }, { people: [b] }).changed).toBe(false);
    expect(plan({ tombstones: [tomb('people', 'p1', T1)] }, { people: [b] }).changed).toBe(false);
  });

  it('with no last-agreed copy, takes it back when this deletion has no time', () => {
    expect(plan({ tombstones: [{ id: 'p1', store: 'people' }] }, { people: [b] }).puts.people).toEqual([b]);
  });

  it('with no times, keeps it deleted', () => {
    expect(plan({ tombstones: [{ id: 'p1', store: 'people' }] }, { people: [{ id: 'p1' }] }).changed).toBe(false);
  });

  it('skips it when the file has a deletion and neither has a time', () => {
    expect(plan({}, { people: [{ id: 'p1' }], tombstones: [{ id: 'p1', store: 'people' }] }).puts.people).toEqual([]);
  });

  it('takes it when the file has a deletion with no time', () => {
    expect(plan({}, { people: [b], tombstones: [{ id: 'p1', store: 'people' }] }).puts.people).toEqual([b]);
  });

  it('skips it when the file has a dated deletion and the record has no time', () => {
    const undated = { id: 'p1', name: 'Test Person' };
    expect(plan({}, { people: [undated], tombstones: [tomb('people', 'p1', T0)] }).puts.people).toEqual([]);
  });

  it('holds other stores deleted here but changed there too, without holding children', () => {
    const ob = rec('o1', { name: 'Test Org' });
    const tp = rec('t1', { personId: 'o1' });
    const r = plan({ tombstones: [tomb('organizations', 'o1', T3)] }, { organizations: [{ ...ob, name: 'Renamed' }], touchpoints: [tp] }, baseOf('organizations', ob));
    expect(r.conflicts.map((c) => [c.kind, c.store, c.id])).toEqual([['deletedHere', 'organizations', 'o1']]);
    expect(r.puts.touchpoints).toEqual([tp]);
    expect([...r.held]).toEqual(['organizations/o1']);
  });
});

describe('planMerge: bad input', () => {
  it('does not trip over numbers where times should be', () => {
    // A broken record: a number for this copy's time, none on the file's.
    // The file's copy counts as newer, but the file also deleted it.
    const r = plan({ people: [{ id: 'p1', name: 'A', updatedAt: -1 }] }, { people: [{ id: 'p1', name: 'B' }], tombstones: [tomb('people', 'p1', T1)] });
    expect(r.puts.people).toEqual([]);
    expect(r.dels.people).toEqual([]);
  });

  it('throws on a record that is not an object', () => {
    expect(() => plan({ people: [null] }, {})).toThrow(TypeError);
  });
});

describe('planMerge: a person\'s touchpoints, news and promises wait with them', () => {
  const pb = person('p1', { city: 'Base' });
  const tp = rec('t1', { personId: 'p1', note: 'coffee' });
  const nw = rec('n1', { personId: 'p1', text: 'new job' });
  const ol = rec('l1', { personId: 'p1', text: 'send link' });

  it('holds the children of a person deleted there but changed here', () => {
    const mine = { ...pb, city: 'Changed', updatedAt: T2 };
    const ptomb = tomb('people', 'p1', T3);
    const ttomb = tomb('touchpoints', 't1', T3);
    const r = plan(
      { people: [mine], touchpoints: [tp], news: [nw], openLoops: [ol] },
      { tombstones: [ptomb, ttomb], news: [{ ...nw, text: 'their text', updatedAt: T2 }] },
      { ...baseOf('people', pb), ...baseOf('touchpoints', tp) },
    );
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0].children).toEqual([
      { store: 'touchpoints', id: 't1', mine: tp, theirs: null, base: tp },
      { store: 'news', id: 'n1', mine: nw, theirs: { ...nw, text: 'their text', updatedAt: T2 }, base: null },
      { store: 'openLoops', id: 'l1', mine: ol, theirs: null, base: null },
    ]);
    expect([...r.held].sort()).toEqual(['news/n1', 'openLoops/l1', 'people/p1', 'touchpoints/t1']);
    // Nothing happens to them, and their deletions wait too.
    expect(r.changed).toBe(false);
  });

  it('holds the shared children of a person deleted here but changed there', () => {
    const theirs = { ...pb, city: 'Changed', updatedAt: T2 };
    const r = plan(
      { tombstones: [tomb('people', 'p1', T3)] },
      { people: [theirs], touchpoints: [tp] },
      baseOf('people', pb),
    );
    expect(r.conflicts[0].kind).toBe('deletedHere');
    expect(r.conflicts[0].children).toEqual([{ store: 'touchpoints', id: 't1', mine: null, theirs: tp, base: null }]);
    expect(r.puts.touchpoints).toEqual([]);
    expect([...r.held].sort()).toEqual(['people/p1', 'touchpoints/t1']);
  });

  it('merges children normally when their person is not held', () => {
    const r = plan({ people: [pb] }, { people: [pb], touchpoints: [tp] }, baseOf('people', pb));
    expect(r.puts.touchpoints).toEqual([tp]);
    expect([...r.held]).toEqual([]);
  });

  it('does not hold children when the person clashed on a field (only deletions hold them)', () => {
    const r = plan(
      { people: [{ ...pb, city: 'Mine' }] },
      { people: [{ ...pb, city: 'Theirs' }], touchpoints: [tp] },
      baseOf('people', pb),
    );
    expect(r.conflicts[0].kind).toBe('both');
    expect(r.puts.touchpoints).toEqual([tp]);
  });

  it('does not hold records of other stores that mention the person', () => {
    const idea = rec('i1', { personId: 'p1', text: 'gift' });
    const r = plan(
      { people: [{ ...pb, city: 'Changed' }] },
      { tombstones: [tomb('people', 'p1', T3)], ideas: [idea] },
      baseOf('people', pb),
    );
    expect(r.puts.ideas).toEqual([idea]);
    expect(r.held.has('ideas/i1')).toBe(false);
  });

  it('only holds children for people, not for an organization with the same id', () => {
    const ob = rec('p1', { name: 'Test Org' });
    const r = plan(
      { organizations: [{ ...ob, name: 'Changed Org' }] },
      { tombstones: [tomb('organizations', 'p1', T3)], touchpoints: [tp] },
      baseOf('organizations', ob),
    );
    expect(r.conflicts[0].kind).toBe('deletedThere');
    expect(r.puts.touchpoints).toEqual([tp]);
    expect(r.held.has('touchpoints/t1')).toBe(false);
  });

  it('leaves records with no person alone', () => {
    const loose = rec('t9', { note: 'no person' });
    const r = plan({}, { touchpoints: [loose] });
    expect(r.puts.touchpoints).toEqual([loose]);
  });
});

describe('planMerge: deletions from other devices', () => {
  it('keeps a new deletion from the file', () => {
    const t = tomb('ideas', 'i1', T2);
    expect(plan({}, { tombstones: [t] }).puts.tombstones).toEqual([t]);
  });

  it('skips a deletion this device already has', () => {
    const t = tomb('ideas', 'i1', T2);
    expect(plan({ tombstones: [t] }, { tombstones: [{ ...t }] }).puts.tombstones).toEqual([]);
  });

  it('keeps the later deletion when both have one', () => {
    const early = tomb('ideas', 'i1', T1);
    const late = tomb('ideas', 'i1', T2);
    expect(plan({ tombstones: [early] }, { tombstones: [late] }).puts.tombstones).toEqual([late]);
    expect(plan({ tombstones: [late] }, { tombstones: [early] }).puts.tombstones).toEqual([]);
  });

  it('treats a deletion with no time as the oldest', () => {
    const none = { id: 'i1', store: 'ideas' };
    const late = tomb('ideas', 'i1', T2);
    expect(plan({ tombstones: [none] }, { tombstones: [late] }).puts.tombstones).toEqual([late]);
    expect(plan({ tombstones: [late] }, { tombstones: [none] }).puts.tombstones).toEqual([]);
    expect(plan({ tombstones: [none] }, { tombstones: [{ ...none }] }).puts.tombstones).toEqual([]);
  });

  it('holds back the deletion of a held record', () => {
    const t = tomb('people', 'p1', T3);
    const other = tomb('ideas', 'i1', T3);
    const b = person('p1');
    const r = plan({ people: [{ ...b, city: 'Changed' }] }, { tombstones: [t, other] }, baseOf('people', b));
    expect(r.puts.tombstones).toEqual([other]);
  });
});

describe('planMerge: two devices starting the same week', () => {
  const W = '2026-01-05';
  const wk = (id, updatedAt, extra = {}) => rec(id, { weekStart: W, updatedAt, ...extra });

  it('keeps the newer week from the file and deletes the one here', () => {
    const r = plan({ weeks: [wk('w1', T1)] }, { weeks: [wk('w2', T2)] });
    expect(r.puts.weeks).toEqual([wk('w2', T2)]);
    expect(r.dels.weeks).toEqual(['w1']);
  });

  it('keeps the newer week here and drops the one from the file', () => {
    const r = plan({ weeks: [wk('w1', T2)] }, { weeks: [wk('w2', T1)] });
    expect(r.puts.weeks).toEqual([]);
    expect(r.dels.weeks).toEqual(['w2']);
  });

  it('keeps the one already here when both are equally new', () => {
    const r = plan({ weeks: [wk('w1', T1)] }, { weeks: [wk('w2', T1)] });
    expect(r.puts.weeks).toEqual([]);
    expect(r.dels.weeks).toEqual(['w2']);
  });

  it('keeps weeks that start on different days', () => {
    const other = rec('w2', { weekStart: '2026-01-12' });
    const r = plan({ weeks: [wk('w1', T1)] }, { weeks: [other] });
    expect(r.puts.weeks).toEqual([other]);
    expect(r.dels.weeks).toEqual([]);
  });

  it('does not treat the same week record seen twice as two weeks', () => {
    const b = wk('w1', T1, { notes: 'base' });
    const r = plan({ weeks: [b] }, { weeks: [{ ...b, notes: 'theirs', updatedAt: T2 }] }, baseOf('weeks', b));
    expect(r.puts.weeks).toEqual([{ ...b, notes: 'theirs', updatedAt: T2 }]);
    expect(r.dels.weeks).toEqual([]);
  });

  it('leaves out a week that is being deleted', () => {
    const w1 = wk('w1', T3);
    const r = plan({ weeks: [w1] }, { weeks: [wk('w2', T1)], tombstones: [tomb('weeks', 'w1', T3)] }, baseOf('weeks', w1));
    expect(r.dels.weeks).toEqual(['w1']);
    expect(r.puts.weeks).toEqual([wk('w2', T1)]);
  });

  it('keeps the newest of three and deletes the other two', () => {
    const r = plan({ weeks: [wk('w1', T1)] }, { weeks: [wk('w2', T3), wk('w3', T2)] });
    expect(r.puts.weeks).toEqual([wk('w2', T3)]);
    expect([...r.dels.weeks].sort()).toEqual(['w1', 'w3']);
  });

  it('does not delete a held week that lost', () => {
    const b = wk('w1', T1, { notes: 'base' });
    const r = plan(
      { weeks: [{ ...b, notes: 'mine' }] },
      { weeks: [{ ...b, notes: 'theirs' }, wk('w2', T3)] },
      baseOf('weeks', b),
    );
    expect(r.conflicts.map((c) => c.id)).toEqual(['w1']);
    expect(r.dels.weeks).toEqual([]);
    expect(r.puts.weeks).toEqual([wk('w2', T3)]);
  });
});
