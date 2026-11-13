// js/merge.js fileData and nextBase (what goes into the shared file, and the
// new last-agreed copy), plus whole rounds of planMerge between two devices:
// they agree in the end, and a second sync right after changes nothing.
import { describe, it, expect } from 'vitest';
import { STORES, planMerge, fileData, nextBase, dataKey, resolvedRecord } from '../../js/merge.js';

const T0 = '2026-01-01T00:00:00.000Z';
const T1 = '2026-01-02T00:00:00.000Z';
const T2 = '2026-01-03T00:00:00.000Z';
const T3 = '2026-01-04T00:00:00.000Z';
const T4 = '2026-01-05T00:00:00.000Z';
const NOW = '2026-02-01T12:00:00.000Z';
const rec = (id, extra = {}) => ({ id, createdAt: T0, updatedAt: T1, ...extra });
const tomb = (store, id, deletedAt) => ({ id, store, deletedAt, createdAt: deletedAt, updatedAt: deletedAt });
const empty = () => Object.fromEntries(STORES.map((s) => [s, []]));
const full = (d) => ({ ...empty(), ...d });

describe('fileData', () => {
  it('copies this device\'s data, every store, sorted by id', () => {
    const out = fileData({ people: [rec('p2'), rec('p1')], ideas: [rec('i1')] }, {}, new Set());
    expect(out).toEqual(full({ people: [rec('p1'), rec('p2')], ideas: [rec('i1')] }));
  });

  it('does not change the arrays passed in', () => {
    const people = [rec('p2'), rec('p1')];
    const out = fileData({ people }, {}, new Set());
    expect(people.map((r) => r.id)).toEqual(['p2', 'p1']);
    expect(out.people).not.toBe(people);
  });

  it('gives empty stores for an empty device', () => {
    expect(fileData({}, {}, new Set())).toEqual(empty());
  });

  it('keeps the file\'s copy of a record held over a clash', () => {
    const mine = rec('p1', { name: 'Mine' });
    const theirs = rec('p1', { name: 'Theirs' });
    const out = fileData({ people: [rec('p0'), mine, rec('p2')] }, { people: [theirs] }, new Set(['people/p1']));
    expect(out.people).toEqual([rec('p0'), theirs, rec('p2')]);
  });

  it('keeps the file\'s deletion of a record deleted there but changed here', () => {
    const t = tomb('people', 'p1', T2);
    const out = fileData({ people: [rec('p1', { name: 'Changed' })] }, { tombstones: [t] }, new Set(['people/p1']));
    expect(out.people).toEqual([]);
    expect(out.tombstones).toEqual([t]);
  });

  it('keeps the file\'s record (not this deletion) for a record deleted here but changed there', () => {
    const theirs = rec('p1', { name: 'Changed there' });
    const out = fileData({ tombstones: [tomb('people', 'p1', T2), tomb('ideas', 'i9', T2)] }, { people: [theirs] }, new Set(['people/p1']));
    expect(out.people).toEqual([theirs]);
    expect(out.tombstones).toEqual([tomb('ideas', 'i9', T2)]);
  });

  it('does not bring in the file\'s deletions of other records', () => {
    const theirs = rec('p1', { name: 'Theirs' });
    const other = tomb('ideas', 'i1', T2);
    const out = fileData({ people: [rec('p1', { name: 'Mine' })] }, { people: [theirs], tombstones: [other] }, new Set(['people/p1']));
    expect(out.people).toEqual([theirs]);
    expect(out.tombstones).toEqual([]);
  });

  it('leaves a held record out when the file has neither it nor its deletion', () => {
    const out = fileData({ news: [rec('n1')] }, {}, new Set(['news/n1']));
    expect(out.news).toEqual([]);
  });

  it('handles ids with a slash in them', () => {
    const theirs = rec('a/b', { name: 'Theirs' });
    const out = fileData({ people: [rec('a/b', { name: 'Mine' }), rec('a')] }, { people: [rec('a'), theirs] }, new Set(['people/a/b']));
    expect(out.people).toEqual([rec('a'), theirs]);
  });

  it('only swaps the held record, in the right store', () => {
    const out = fileData(
      { people: [rec('p1', { v: 'mine' })], ideas: [rec('i1', { v: 'mine' })] },
      { people: [rec('p1', { v: 'theirs' })], ideas: [rec('i1', { v: 'theirs' })] },
      new Set(['ideas/i1']),
    );
    expect(out.people).toEqual([rec('p1', { v: 'mine' })]);
    expect(out.ideas).toEqual([rec('i1', { v: 'theirs' })]);
  });

  it('sorts the swapped-in records with the rest', () => {
    const out = fileData({ tombstones: [tomb('ideas', 'z', T1)] }, { tombstones: [tomb('people', 'a', T1)] }, new Set(['people/a']));
    expect(out.tombstones.map((t) => t.id)).toEqual(['a', 'z']);
  });

  it('keeps records with the same id in the order given', () => {
    const a = rec('same', { n: 1 });
    const b = rec('same', { n: 2 });
    expect(fileData({ people: [a, b] }, {}, new Set()).people).toEqual([a, b]);
    expect(fileData({ people: [b, a] }, {}, new Set()).people).toEqual([b, a]);
  });
});

describe('nextBase', () => {
  it('turns the written data into id-keyed copies, records only', () => {
    const written = full({ people: [rec('p1')], weeks: [rec('w1')], tombstones: [tomb('people', 'p9', T1)] });
    const out = nextBase(written, null, new Set());
    expect(out).toEqual({ people: { p1: rec('p1') }, organizations: {}, circles: {}, touchpoints: {}, news: {}, openLoops: {}, ideas: {}, weeks: { w1: rec('w1') }, settings: {} });
    expect('tombstones' in out).toBe(false);
  });

  it('copes with missing stores', () => {
    expect(nextBase({}, null, new Set()).people).toEqual({});
  });

  it('keeps the old base of a held record', () => {
    const old = { people: { p1: rec('p1', { name: 'Agreed' }) } };
    const out = nextBase({ people: [rec('p1', { name: 'Theirs' }), rec('p2')] }, old, new Set(['people/p1']));
    expect(out.people).toEqual({ p1: rec('p1', { name: 'Agreed' }), p2: rec('p2') });
  });

  it('drops a held record that had no old base', () => {
    const out = nextBase({ people: [rec('p1')] }, { people: {} }, new Set(['people/p1']));
    expect(out.people).toEqual({});
    const noStore = nextBase({ people: [rec('p1')] }, { ideas: {} }, new Set(['people/p1']));
    expect(noStore.people).toEqual({});
    const noBase = nextBase({ people: [rec('p1')] }, null, new Set(['people/p1']));
    expect(noBase.people).toEqual({});
  });

  it('handles held ids with a slash in them', () => {
    const out = nextBase({ news: [rec('x/y'), rec('x')] }, { news: { 'x/y': rec('x/y', { old: true }) } }, new Set(['news/x/y']));
    expect(out.news).toEqual({ 'x/y': rec('x/y', { old: true }), x: rec('x') });
  });
});

// ---- Whole rounds between devices ----

// What sync does on one device: plan, apply here, write the file, move the base on.
function apply(data, plan) {
  const out = {};
  for (const s of STORES) {
    let list = (data[s] || []).filter((r) => !plan.dels[s].includes(r.id));
    for (const r of plan.puts[s]) list = [...list.filter((x) => x.id !== r.id), r];
    out[s] = list;
  }
  return out;
}
function syncDevice(device, file) {
  const plan = planMerge(device.data, file, device.base, { now: NOW });
  const data = apply(device.data, plan);
  const written = fileData(data, file, plan.held);
  return { device: { data, base: nextBase(written, device.base, plan.held) }, file: written, plan };
}

describe('merging is stable', () => {
  it('a second sync right after the first plans nothing and writes the same file', () => {
    const base = { people: { p1: rec('p1', { name: 'Test Person', city: 'A', note: 'n' }) } };
    const device = {
      data: full({ people: [rec('p1', { name: 'Test Person', city: 'B', note: 'n', updatedAt: T2 }), rec('p2', { name: 'New Here' })] }),
      base,
    };
    const file = full({
      people: [rec('p1', { name: 'Test Person', city: 'A', note: 'there', updatedAt: T3 }), rec('p3', { name: 'New There' })],
      tombstones: [tomb('ideas', 'i1', T2)],
    });
    const first = syncDevice(device, file);
    expect(first.plan.changed).toBe(true);
    const second = syncDevice(first.device, first.file);
    expect(second.plan.changed).toBe(false);
    expect(second.plan.conflicts).toEqual([]);
    expect(dataKey(second.file)).toBe(dataKey(first.file));
    expect(second.device.base).toEqual(first.device.base);
  });

  it('a held clash stays held, and stays the same, on every later sync until answered', () => {
    const b = rec('p1', { name: 'Test Person', city: 'Base' });
    const device = { data: full({ people: [{ ...b, city: 'Mine', updatedAt: T2 }] }), base: { people: { p1: b } } };
    const file = full({ people: [{ ...b, city: 'Theirs', updatedAt: T3 }] });
    const first = syncDevice(device, file);
    expect(first.plan.conflicts).toHaveLength(1);
    expect(first.file.people).toEqual(file.people);
    expect(first.device.base.people.p1).toEqual(b);
    const second = syncDevice(first.device, first.file);
    expect(second.plan.conflicts).toEqual(first.plan.conflicts);
    expect(second.plan.changed).toBe(false);
    expect(dataKey(second.file)).toBe(dataKey(first.file));
  });

  it('planning twice from the same inputs gives the same plan', () => {
    const local = full({ people: [rec('p1', { city: 'X', updatedAt: T2 })], weeks: [rec('w1', { weekStart: '2026-01-05' })] });
    const remote = full({ people: [rec('p1', { note: 'Y', updatedAt: T3 })], weeks: [rec('w2', { weekStart: '2026-01-05', updatedAt: T2 })] });
    const base = { people: { p1: rec('p1') } };
    const a = planMerge(local, remote, base, { now: NOW });
    const b = planMerge(local, remote, base, { now: NOW });
    expect({ ...b, held: [...b.held] }).toEqual({ ...a, held: [...a.held] });
  });
});

describe('two devices end up the same', () => {
  it('different fields changed on each device are both kept everywhere', () => {
    const b = rec('p1', { name: 'Test Person', city: 'Base', phone: '000' });
    const agreed = full({ people: [b] });
    const baseCopy = { people: { p1: b } };
    let phone = { data: full({ people: [{ ...b, city: 'Phone City', updatedAt: T2 }] }), base: baseCopy };
    let mac = { data: full({ people: [{ ...b, phone: '111', updatedAt: T3 }] }), base: baseCopy };
    let file = agreed;
    ({ device: phone, file } = syncDevice(phone, file));
    ({ device: mac, file } = syncDevice(mac, file));
    ({ device: phone, file } = syncDevice(phone, file));
    const expected = { ...b, city: 'Phone City', phone: '111', updatedAt: NOW };
    expect(phone.data.people).toEqual([expected]);
    expect(mac.data.people).toEqual([expected]);
    expect(file.people).toEqual([expected]);
  });

  it('a deletion on one device reaches the other when it was not changed there', () => {
    const b = rec('p1', { name: 'Test Person' });
    const baseCopy = { people: { p1: b } };
    const t = tomb('people', 'p1', T2);
    let phone = { data: full({ tombstones: [t] }), base: baseCopy };
    let mac = { data: full({ people: [b] }), base: baseCopy };
    let file = full({ people: [b] });
    ({ device: phone, file } = syncDevice(phone, file));
    expect(file.people).toEqual([]);
    expect(file.tombstones).toEqual([t]);
    ({ device: mac, file } = syncDevice(mac, file));
    expect(mac.data.people).toEqual([]);
    expect(mac.data.tombstones).toEqual([t]);
    expect(dataKey(mac.data)).toBe(dataKey(phone.data));
  });

  it('a clash answered on one device settles on both', () => {
    const b = rec('p1', { name: 'Test Person', city: 'Base' });
    const baseCopy = { people: { p1: b } };
    let phone = { data: full({ people: [{ ...b, city: 'Phone', updatedAt: T2 }] }), base: baseCopy };
    let mac = { data: full({ people: [{ ...b, city: 'Mac', updatedAt: T3 }] }), base: baseCopy };
    let file = full({ people: [b] });
    ({ device: mac, file } = syncDevice(mac, file));
    const r = syncDevice(phone, file);
    expect(r.plan.conflicts).toHaveLength(1);
    phone = r.device;
    file = r.file;
    // The phone picks the Mac's value: saved as the newest copy, base moved on.
    const c = r.plan.conflicts[0];
    const answer = { ...resolvedRecord(c, 'theirs'), updatedAt: T4 };
    phone = { data: { ...phone.data, people: [answer] }, base: { ...phone.base, people: { p1: c.theirs } } };
    ({ device: phone, file } = syncDevice(phone, file));
    ({ device: mac, file } = syncDevice(mac, file));
    expect(phone.data.people).toEqual([answer]);
    expect(mac.data.people).toEqual([answer]);
    expect(file.people).toEqual([answer]);
    expect(answer.city).toBe('Mac');
  });
});
