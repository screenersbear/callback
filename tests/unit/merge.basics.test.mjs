// js/merge.js: the small building blocks (comparing copies, paths into a
// record, which fields are bookkeeping, field-by-field merging, answering a
// conflict). planMerge, fileData and nextBase have their own files.
import { describe, it, expect } from 'vitest';
import { STORES, canonical, dataKey, keyOf, getPath, setPath, quietField, mergeFields, resolvedRecord } from '../../js/merge.js';

describe('STORES', () => {
  it('lists every synced store, tombstones last', () => {
    expect(STORES).toEqual(['people', 'organizations', 'circles', 'touchpoints', 'news', 'openLoops', 'ideas', 'weeks', 'settings', 'tombstones']);
  });
});

describe('canonical', () => {
  it('writes objects with their keys sorted, nested too', () => {
    expect(canonical({ b: 1, a: { d: 'x', c: [2, 1] } })).toBe('{"a":{"c":[2,1],"d":"x"},"b":1}');
  });

  it('gives the same text for the same data in any key order', () => {
    expect(canonical({ name: 'Test Person', tags: ['a'], n: 2 })).toBe(canonical({ n: 2, tags: ['a'], name: 'Test Person' }));
  });

  it('keeps array order (a different order is different data)', () => {
    expect(canonical([1, 2, 3])).toBe('[1,2,3]');
    expect(canonical([3, 2, 1])).not.toBe(canonical([1, 2, 3]));
  });

  it('leaves out fields that are undefined, so a missing field and an undefined one match', () => {
    expect(canonical({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(canonical({ a: 1, b: undefined })).toBe(canonical({ a: 1 }));
  });

  it('writes undefined and null as null', () => {
    expect(canonical(undefined)).toBe('null');
    expect(canonical(null)).toBe('null');
    expect(canonical([undefined, null])).toBe('[null,null]');
    expect(canonical({ a: null })).toBe('{"a":null}');
  });

  it('writes plain values the way JSON does', () => {
    expect(canonical(5)).toBe('5');
    expect(canonical(0)).toBe('0');
    expect(canonical('ab')).toBe('"ab"');
    expect(canonical('')).toBe('""');
    expect(canonical(true)).toBe('true');
    expect(canonical(false)).toBe('false');
    expect(canonical('say "hi"')).toBe('"say \\"hi\\""');
  });

  it('handles empty objects and arrays', () => {
    expect(canonical({})).toBe('{}');
    expect(canonical([])).toBe('[]');
    expect(canonical({ a: [], b: {} })).toBe('{"a":[],"b":{}}');
  });

  it('quotes awkward keys safely', () => {
    expect(canonical({ 'a"b': 1, 'é': 2 })).toBe('{"a\\"b":1,"é":2}');
  });
});

describe('dataKey', () => {
  const p1 = { id: 'p1', name: 'Test Person' };
  const p2 = { id: 'p2', name: 'Other Person' };
  const p3 = { id: 'p3', name: 'Third Person' };

  it('ignores the order records are in', () => {
    expect(dataKey({ people: [p3, p1, p2] })).toBe(dataKey({ people: [p1, p2, p3] }));
    expect(dataKey({ people: [p2, p3, p1] })).toBe(dataKey({ people: [p1, p2, p3] }));
  });

  it('notices a changed record', () => {
    expect(dataKey({ people: [p1] })).not.toBe(dataKey({ people: [{ ...p1, name: 'Changed' }] }));
  });

  it('treats a missing store as an empty one', () => {
    expect(dataKey({})).toBe(dataKey(Object.fromEntries(STORES.map((s) => [s, []]))));
    expect(dataKey({})).toBe(`[${STORES.map(() => '[]').join(',')}]`);
  });

  it('tells stores apart (the same record in another store is different data)', () => {
    expect(dataKey({ people: [p1] })).not.toBe(dataKey({ organizations: [p1] }));
  });

  it('ignores stores it does not sync', () => {
    expect(dataKey({ meta: [{ id: 'x' }] })).toBe(dataKey({}));
  });

  it('does not reorder the caller\'s arrays', () => {
    const people = [p3, p1];
    dataKey({ people });
    expect(people).toEqual([p3, p1]);
  });

  it('keeps records with the same id in the order given (stable sort)', () => {
    const a = { id: 'same', n: 1 };
    const b = { id: 'same', n: 2 };
    expect(dataKey({ people: [a, b] })).not.toBe(dataKey({ people: [b, a] }));
  });
});

describe('keyOf', () => {
  it('joins the store and id with a slash', () => {
    expect(keyOf('people', 'p1')).toBe('people/p1');
  });
  it('keeps ids that have slashes in them whole', () => {
    expect(keyOf('news', 'a/b')).toBe('news/a/b');
  });
  it('writes odd ids as text', () => {
    expect(keyOf('weeks', undefined)).toBe('weeks/undefined');
    expect(keyOf('ideas', 7)).toBe('ideas/7');
  });
});

describe('getPath', () => {
  const rec = { name: 'Test Person', cadence: { every: 30, inner: { at: 'x' } }, zero: 0, nothing: null };

  it('reads top-level and nested fields', () => {
    expect(getPath(rec, 'name')).toBe('Test Person');
    expect(getPath(rec, 'cadence.every')).toBe(30);
    expect(getPath(rec, 'cadence.inner.at')).toBe('x');
  });

  it('gives falsy values back as they are', () => {
    expect(getPath(rec, 'zero')).toBe(0);
    expect(getPath(rec, 'nothing')).toBe(null);
  });

  it('gives undefined for a missing field or a missing/null step on the way', () => {
    expect(getPath(rec, 'missing')).toBeUndefined();
    expect(getPath(rec, 'missing.deeper')).toBeUndefined();
    expect(getPath(rec, 'nothing.deeper')).toBeUndefined();
    expect(getPath(null, 'a')).toBeUndefined();
    expect(getPath(undefined, 'a.b')).toBeUndefined();
  });
});

describe('setPath', () => {
  it('sets a top-level field', () => {
    const o = { a: 1 };
    setPath(o, 'b', 2);
    expect(o).toEqual({ a: 1, b: 2 });
  });

  it('sets a nested field and keeps its neighbours', () => {
    const o = { cadence: { every: 30, kind: 'x' }, name: 'Test Person' };
    setPath(o, 'cadence.every', 14);
    expect(o).toEqual({ cadence: { every: 14, kind: 'x' }, name: 'Test Person' });
  });

  it('makes the objects on the way when they are missing (three levels)', () => {
    const o = {};
    setPath(o, 'a.b.c', 'deep');
    expect(o).toEqual({ a: { b: { c: 'deep' } } });
  });

  it('replaces a step that is not a plain object', () => {
    const o = { a: 'text', b: [1, 2], c: null };
    setPath(o, 'a.x', 1);
    setPath(o, 'b.y', 2);
    setPath(o, 'c.z', 3);
    expect(o).toEqual({ a: { x: 1 }, b: { y: 2 }, c: { z: 3 } });
  });

  it('deletes the field when the value is undefined', () => {
    const o = { a: 1, n: { b: 2, c: 3 } };
    setPath(o, 'a', undefined);
    setPath(o, 'n.b', undefined);
    expect(o).toEqual({ n: { c: 3 } });
    expect('a' in o).toBe(false);
  });

  it('keeps falsy values that are not undefined', () => {
    const o = {};
    setPath(o, 'a', null);
    setPath(o, 'b', 0);
    setPath(o, 'c', '');
    setPath(o, 'd', false);
    expect(o).toEqual({ a: null, b: 0, c: '', d: false });
  });
});

describe('quietField', () => {
  it('counts any field ending in At as bookkeeping, nested too', () => {
    expect(quietField('people', 'updatedAt')).toBe(true);
    expect(quietField('people', 'lastSeenAt')).toBe(true);
    expect(quietField('settings', 'cadence.reviewedAt')).toBe(true);
  });

  it('counts the listed bookkeeping fields by their last name', () => {
    expect(quietField('people', 'relationshipType')).toBe(true);
    expect(quietField('people', 'engagePromptDismissed')).toBe(true);
    expect(quietField('circles', 'sortOrder')).toBe(true);
    expect(quietField('settings', 'nested.sortOrder')).toBe(true);
  });

  it('counts a week reflection as bookkeeping only in weeks', () => {
    expect(quietField('weeks', 'reflection')).toBe(true);
    expect(quietField('people', 'reflection')).toBe(false);
    expect(quietField('weeks', 'notes')).toBe(false);
  });

  it('asks about real content', () => {
    expect(quietField('people', 'name')).toBe(false);
    expect(quietField('people', 'Attitude')).toBe(false);
    expect(quietField('people', 'sortOrderNote')).toBe(false);
    expect(quietField('people', 'updatedAt.value')).toBe(false);
    expect(quietField('people', 'relationshipType.note')).toBe(false);
  });

  it('handles an empty path', () => {
    expect(quietField('people', '')).toBe(false);
  });
});

describe('mergeFields', () => {
  it('keeps changes made to different fields on each side', () => {
    const b = { name: 'Test Person', city: 'Old Town', note: 'n' };
    const r = mergeFields(b, { ...b, city: 'New Town' }, { ...b, note: 'their note' });
    expect(r).toEqual({ merged: { name: 'Test Person', city: 'New Town', note: 'their note' }, clashes: [] });
  });

  it('is happy when both made the same change', () => {
    const b = { name: 'Old' };
    expect(mergeFields(b, { name: 'New' }, { name: 'New' })).toEqual({ merged: { name: 'New' }, clashes: [] });
  });

  it('reports the same field changed to different values, keeping this device\'s value', () => {
    const b = { name: 'Old', city: 'X' };
    const r = mergeFields(b, { name: 'Mine', city: 'X' }, { name: 'Theirs', city: 'X' });
    expect(r).toEqual({ merged: { name: 'Mine', city: 'X' }, clashes: ['name'] });
  });

  it('drops a field removed on one side and untouched on the other', () => {
    const b = { name: 'Test Person', note: 'gone soon' };
    const mineRemoved = mergeFields(b, { name: 'Test Person' }, b);
    expect(mineRemoved).toEqual({ merged: { name: 'Test Person' }, clashes: [] });
    expect('note' in mineRemoved.merged).toBe(false);
    const theirsRemoved = mergeFields(b, b, { name: 'Test Person' });
    expect('note' in theirsRemoved.merged).toBe(false);
    expect(theirsRemoved.clashes).toEqual([]);
  });

  it('drops a field removed on both sides', () => {
    const r = mergeFields({ a: 1, b: 2 }, { b: 2 }, { b: 2 });
    expect(r.merged).toEqual({ b: 2 });
    expect(Object.keys(r.merged)).toEqual(['b']);
  });

  it('reports a field removed on one side and changed on the other', () => {
    const r = mergeFields({ note: 'old' }, {}, { note: 'changed' });
    expect(r).toEqual({ merged: {}, clashes: ['note'] });
  });

  it('reports a field added on both sides with different values', () => {
    expect(mergeFields({}, { phone: '1' }, { phone: '2' })).toEqual({ merged: { phone: '1' }, clashes: ['phone'] });
  });

  it('skips the id and timestamps at the top level', () => {
    const b = { id: 'p1', createdAt: 'c0', updatedAt: 'u0', name: 'A' };
    const r = mergeFields(b, { ...b, createdAt: 'c1', updatedAt: 'u1' }, { ...b, id: 'other', createdAt: 'c2', updatedAt: 'u2' });
    expect(r).toEqual({ merged: { name: 'A' }, clashes: [] });
  });

  it('merges nested objects field by field, with dotted clash paths', () => {
    const b = { cadence: { every: 30, kind: 'warm', id: 'c', updatedAt: 'u0' } };
    const mine = { cadence: { every: 14, kind: 'warm', id: 'c', updatedAt: 'u1' } };
    const theirs = { cadence: { every: 30, kind: 'cool', id: 'c', updatedAt: 'u2' } };
    const r = mergeFields(b, mine, theirs);
    // Nested id/updatedAt are ordinary fields: they are merged and can clash.
    expect(r).toEqual({ merged: { cadence: { every: 14, kind: 'cool', id: 'c', updatedAt: 'u1' } }, clashes: ['cadence.updatedAt'] });
  });

  it('merges nested objects added on both sides when there was no base value', () => {
    const r = mergeFields({}, { goals: { weekly: 3 } }, { goals: { monthly: 9 } });
    expect(r).toEqual({ merged: { goals: { weekly: 3, monthly: 9 } }, clashes: [] });
  });

  it('merges deeper objects and names the full path of a clash', () => {
    const b = { a: { b: { c: 1, d: 1 } } };
    const r = mergeFields(b, { a: { b: { c: 2, d: 1 } } }, { a: { b: { c: 3, d: 4 } } });
    expect(r).toEqual({ merged: { a: { b: { c: 2, d: 4 } } }, clashes: ['a.b.c'] });
  });

  it('does not go into objects when the base value was not an object', () => {
    const r = mergeFields({ addr: 'Old Street' }, { addr: { street: 'A' } }, { addr: { city: 'B' } });
    expect(r).toEqual({ merged: { addr: { street: 'A' } }, clashes: ['addr'] });
  });

  it('does not go into objects when the base value was null', () => {
    const r = mergeFields({ addr: null }, { addr: { street: 'A' } }, { addr: { city: 'B' } });
    expect(r).toEqual({ merged: { addr: { street: 'A' } }, clashes: ['addr'] });
  });

  it('treats lists as one value (no merging inside arrays)', () => {
    const r = mergeFields({ tags: ['a'] }, { tags: ['a', 'b'] }, { tags: ['a', 'c'] });
    expect(r).toEqual({ merged: { tags: ['a', 'b'] }, clashes: ['tags'] });
  });

  it('reports a clash when only one side holds an object', () => {
    expect(mergeFields({ x: 1 }, { x: { y: 1 } }, { x: 2 })).toEqual({ merged: { x: { y: 1 } }, clashes: ['x'] });
    expect(mergeFields({ x: 1 }, { x: 2 }, { x: { y: 1 } })).toEqual({ merged: { x: 2 }, clashes: ['x'] });
  });

  it('reports a clash when only one side holds an object, even with no base value or an object base', () => {
    expect(mergeFields({}, { x: { y: 1 } }, { x: 2 })).toEqual({ merged: { x: { y: 1 } }, clashes: ['x'] });
    expect(mergeFields({}, { x: 'flat' }, { x: { y: 1 } })).toEqual({ merged: { x: 'flat' }, clashes: ['x'] });
    expect(mergeFields({ x: { y: 0 } }, { x: { y: 1 } }, { x: 'flat' })).toEqual({ merged: { x: { y: 1 } }, clashes: ['x'] });
  });

  it('copes with a missing base, mine or theirs', () => {
    expect(mergeFields(null, { a: 1 }, { a: 2 })).toEqual({ merged: { a: 1 }, clashes: ['a'] });
    expect(mergeFields(null, null, { a: 1 })).toEqual({ merged: { a: 1 }, clashes: [] });
    expect(mergeFields({ a: 1 }, { a: 1 }, null)).toEqual({ merged: {}, clashes: [] });
    expect(mergeFields({ a: 1 }, null, { a: 1 })).toEqual({ merged: {}, clashes: [] });
    expect(mergeFields(undefined, undefined, undefined)).toEqual({ merged: {}, clashes: [] });
  });

  it('uses the prefix for clash paths and merges stamps under a prefix', () => {
    const r = mergeFields({ id: 'a', v: 1 }, { id: 'b', v: 2 }, { id: 'c', v: 3 }, 'outer.');
    expect(r).toEqual({ merged: { id: 'b', v: 2 }, clashes: ['outer.id', 'outer.v'] });
  });

  it('treats null and a missing field as the same value (no clash, this device\'s missing field kept)', () => {
    expect(mergeFields({ a: null }, {}, { a: null })).toEqual({ merged: {}, clashes: [] });
    expect(mergeFields({}, { a: null }, {})).toEqual({ merged: { a: null }, clashes: [] });
  });
});

describe('resolvedRecord', () => {
  const conflict = (over = {}) => ({
    id: 'p1',
    mine: { id: 'p1', createdAt: 'c-mine', name: 'Mine', cadence: { every: 14, kind: 'a' } },
    theirs: { id: 'p1', createdAt: 'c-theirs', name: 'Theirs', cadence: { every: 60, kind: 'a' } },
    merged: { name: 'Mine', city: 'Both', cadence: { every: 14, kind: 'a' } },
    clashes: ['name', 'cadence.every'],
    ...over,
  });

  it('takes this device\'s values for the clashing fields when "mine" is picked', () => {
    expect(resolvedRecord(conflict(), 'mine')).toEqual({ id: 'p1', createdAt: 'c-mine', name: 'Mine', city: 'Both', cadence: { every: 14, kind: 'a' } });
  });

  it('takes the shared copy\'s values for the clashing fields when "theirs" is picked', () => {
    expect(resolvedRecord(conflict(), 'theirs')).toEqual({ id: 'p1', createdAt: 'c-mine', name: 'Theirs', city: 'Both', cadence: { every: 60, kind: 'a' } });
  });

  it('treats any other answer as "theirs"', () => {
    expect(resolvedRecord(conflict(), 'something else').name).toBe('Theirs');
  });

  it('removes a clashing field the picked side does not have', () => {
    const c = conflict({ theirs: { id: 'p1', createdAt: 'c-theirs', cadence: { kind: 'a' } } });
    const out = resolvedRecord(c, 'theirs');
    expect('name' in out).toBe(false);
    expect(out.cadence).toEqual({ kind: 'a' });
  });

  it('falls back to the shared copy\'s createdAt', () => {
    const c = conflict();
    delete c.mine.createdAt;
    expect(resolvedRecord(c, 'mine').createdAt).toBe('c-theirs');
  });

  it('leaves the conflict itself untouched', () => {
    const c = conflict();
    const before = JSON.stringify(c);
    resolvedRecord(c, 'theirs');
    expect(JSON.stringify(c)).toBe(before);
  });

  it('copes with no clashes at all', () => {
    const c = conflict({ clashes: [] });
    expect(resolvedRecord(c, 'theirs')).toEqual({ id: 'p1', createdAt: 'c-mine', name: 'Mine', city: 'Both', cadence: { every: 14, kind: 'a' } });
  });
});
