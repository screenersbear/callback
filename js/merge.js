// How sync combines this device's records with the shared file's.
//
// Plain functions, no storage and no network, so they can be tested alone.
//
// `base` is each record as it was at this device's last finished sync: the
// copy both sides agreed on. Comparing each side with it tells what changed
// where since then:
// - changed on one side only: that side's copy is taken;
// - changed on both, in different fields: both changes are kept, field by
//   field, and the result goes out as the newest copy;
// - the same field changed to different values on both, or deleted on one
//   side and changed on the other: a conflict. Nothing is overwritten; the
//   shared file keeps its copy, this device keeps its own, and you're asked
//   which to keep. Until then the record is "held".
// Records with no base copy (the first sync, a device joining, a record
// brought back after a delete) fall back to the plain rule: the newer copy
// wins, and a deletion wins over anything saved before it.

export const STORES = ['people', 'organizations', 'circles', 'touchpoints', 'news', 'openLoops', 'ideas', 'weeks', 'settings', 'tombstones'];
const RECORDS = STORES.filter((s) => s !== 'tombstones');
// Records that belong to a person, held along with them in a deletion conflict.
const CHILDREN = ['touchpoints', 'news', 'openLoops'];
const STAMPS = new Set(['id', 'createdAt', 'updatedAt']);

// The same data in the same order of keys, so copies can be compared.
export function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  }
  return v === undefined ? 'null' : JSON.stringify(v);
}
const same = (a, b) => canonical(a) === canonical(b);
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
// Whole data sets compared regardless of record order.
export function dataKey(data) {
  return canonical(STORES.map((s) => [...(data[s] || [])].sort(byId)));
}
const content = (r) => {
  if (!r) return r;
  const { id, createdAt, updatedAt, ...rest } = r;
  return rest;
};
const sameContent = (a, b) => same(content(a), content(b));
const newer = (a, b) => (a.updatedAt || '') > (b.updatedAt || '');
const isPlain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
export const keyOf = (store, id) => `${store}/${id}`;

export function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
export function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) {
    if (!isPlain(o[k])) o[k] = {};
    o = o[k];
  }
  const last = keys[keys.length - 1];
  if (value === undefined) delete o[last];
  else o[last] = value;
}

// Bookkeeping fields nobody needs to be asked about: when only these differ,
// the newer copy's values are taken.
export function quietField(store, path) {
  const last = path.split('.').pop();
  return last.endsWith('At') || ['relationshipType', 'engagePromptDismissed', 'sortOrder'].includes(last)
    || (store === 'weeks' && last === 'reflection');
}

// Three-way merge of one record's fields (nested settings go field by field).
// Returns the combined record (this device's value where they clash) and the
// paths of the fields that clash.
export function mergeFields(b, mine, theirs, prefix = '') {
  const merged = {};
  const clashes = [];
  const keys = new Set([...Object.keys(b || {}), ...Object.keys(mine || {}), ...Object.keys(theirs || {})]);
  for (const k of keys) {
    if (!prefix && STAMPS.has(k)) continue;
    const bv = b ? b[k] : undefined;
    const mv = mine ? mine[k] : undefined;
    const tv = theirs ? theirs[k] : undefined;
    if (same(mv, tv)) merged[k] = mv;
    else if (same(mv, bv)) merged[k] = tv;
    else if (same(tv, bv)) merged[k] = mv;
    else if (isPlain(mv) && isPlain(tv) && (bv === undefined || isPlain(bv))) {
      const sub = mergeFields(bv || {}, mv, tv, `${prefix}${k}.`);
      merged[k] = sub.merged;
      clashes.push(...sub.clashes);
    } else {
      merged[k] = mv;
      clashes.push(prefix + k);
    }
  }
  for (const k of Object.keys(merged)) if (merged[k] === undefined) delete merged[k];
  return { merged, clashes };
}

// The record a conflict ends up as when `side` ('mine' or 'theirs') is picked.
export function resolvedRecord(c, side) {
  const out = JSON.parse(JSON.stringify(c.merged));
  const src = side === 'mine' ? c.mine : c.theirs;
  for (const p of c.clashes) setPath(out, p, getPath(src, p));
  return { ...out, id: c.id, createdAt: c.mine.createdAt || c.theirs.createdAt };
}

// local, remote: { store: [records] } (tombstones included).
// base: { store: { id: record } } or null.
// Returns what to change here (puts, dels), the conflicts, and `held`: the
// records whose shared copy must stay as it is until a conflict is answered.
export function planMerge(local, remote, base, { incomingWins = [], now = new Date().toISOString() } = {}) {
  const puts = Object.fromEntries(STORES.map((s) => [s, []]));
  const dels = Object.fromEntries(STORES.map((s) => [s, []]));
  const conflicts = [];
  const held = new Set();
  const L = {};
  const R = {};
  for (const s of STORES) {
    L[s] = new Map((local[s] || []).map((r) => [r.id, r]));
    R[s] = new Map((remote[s] || []).map((r) => [r.id, r]));
  }
  const lt = L.tombstones;
  const rt = R.tombstones;
  const baseOf = (s, id) => (base && base[s] && base[s][id]) || null;
  const heldPeople = new Map(); // person id -> conflict

  for (const s of RECORDS) {
    const ids = new Set([...L[s].keys(), ...R[s].keys()]);
    for (const t of [...lt.values(), ...rt.values()]) if (t.store === s) ids.add(t.id);
    for (const id of ids) {
      const l = L[s].get(id);
      const r = R[s].get(id);
      const b = baseOf(s, id);
      const ltomb = lt.get(id);
      const rtomb = rt.get(id);
      const key = keyOf(s, id);

      // A person's touchpoints, news and promises wait with them.
      if (CHILDREN.includes(s)) {
        const pid = (l && l.personId) || (r && r.personId);
        const pc = pid && heldPeople.get(pid);
        if (pc) {
          held.add(key);
          pc.children.push({ store: s, id, mine: l || null, theirs: r || null, base: b });
          continue;
        }
      }

      if (l && r) {
        if (same(l, r)) continue;
        if (incomingWins.includes(s)) {
          puts[s].push(r);
          continue;
        }
        if (b) {
          const lc = !sameContent(l, b);
          const rc = !sameContent(r, b);
          if (!lc && !rc) {
            if (newer(r, l)) puts[s].push(r);
          } else if (!lc) {
            puts[s].push(r);
          } else if (rc) {
            if (sameContent(l, r)) {
              if (newer(r, l)) puts[s].push(r);
              continue;
            }
            const { merged, clashes } = mergeFields(b, l, r);
            const loud = clashes.filter((p) => !quietField(s, p));
            if (!loud.length) {
              const src = newer(r, l) ? r : l;
              for (const p of clashes) setPath(merged, p, getPath(src, p));
              puts[s].push({ ...merged, id, createdAt: l.createdAt || r.createdAt, updatedAt: now });
            } else {
              conflicts.push({ kind: 'both', store: s, id, mine: l, theirs: r, base: b, merged, clashes, loud, children: [] });
              held.add(key);
            }
          }
          continue;
        }
        // No shared starting point: the newer copy wins, unless deleted after it.
        const tomb = rtomb || ltomb;
        if (newer(r, l) && !(tomb && (tomb.deletedAt || '') >= (r.updatedAt || ''))) puts[s].push(r);
        else if (rtomb && (rtomb.deletedAt || '') >= (l.updatedAt || '') && (rtomb.deletedAt || '') >= (r.updatedAt || '')) dels[s].push(id);
        continue;
      }

      if (l) {
        // Here, not in the file: new here (it goes out), or deleted there.
        if (!rtomb) continue;
        if (b && sameContent(l, b)) {
          dels[s].push(id);
        } else if (b) {
          const c = { kind: 'deletedThere', store: s, id, mine: l, theirs: null, tomb: rtomb, base: b, children: [] };
          conflicts.push(c);
          held.add(key);
          if (s === 'people') heldPeople.set(id, c);
        } else if ((rtomb.deletedAt || '') >= (l.updatedAt || '')) {
          dels[s].push(id);
        }
        continue;
      }

      if (r) {
        // In the file, not here: new there, or deleted here.
        if (!ltomb) {
          if (rtomb && (rtomb.deletedAt || '') >= (r.updatedAt || '')) continue;
          puts[s].push(r);
        } else if (b && sameContent(r, b)) {
          // Deleted here, untouched there: stays deleted.
        } else if (b) {
          const c = { kind: 'deletedHere', store: s, id, mine: null, theirs: r, tomb: ltomb, base: b, children: [] };
          conflicts.push(c);
          held.add(key);
          if (s === 'people') heldPeople.set(id, c);
        } else if ((ltomb.deletedAt || '') < (r.updatedAt || '')) {
          puts[s].push(r);
        }
      }
    }
  }

  // Deletions from the other devices are kept here too, unless held. When
  // both have one for the same record, the later deletion is kept.
  for (const t of rt.values()) {
    if (held.has(keyOf(t.store, t.id))) continue;
    const mine = lt.get(t.id);
    if (!mine || (t.deletedAt || '') > (mine.deletedAt || '')) puts.tombstones.push(t);
  }

  // Two devices can each start a record for the same week; keep the newer.
  const weeks = new Map();
  for (const w of [...L.weeks.values(), ...puts.weeks]) {
    if (dels.weeks.includes(w.id)) continue;
    const kept = weeks.get(w.weekStart);
    if (!kept) weeks.set(w.weekStart, w);
    else if (kept.id !== w.id) {
      const [win, lose] = newer(w, kept) ? [w, kept] : [kept, w];
      weeks.set(w.weekStart, win);
      if (held.has(keyOf('weeks', lose.id))) continue;
      dels.weeks.push(lose.id);
      puts.weeks = puts.weeks.filter((x) => x.id !== lose.id);
    }
  }

  const changed = STORES.some((s) => puts[s].length || dels[s].length);
  return { puts, dels, conflicts, held, changed };
}

// What the shared file should hold: this device's data, except held records
// keep the file's own copy (and deletion) until their conflict is answered.
export function fileData(localAfter, remote, held) {
  const out = {};
  for (const s of STORES) out[s] = [...(localAfter[s] || [])];
  for (const key of held) {
    const cut = key.indexOf('/');
    const s = key.slice(0, cut);
    const id = key.slice(cut + 1);
    out[s] = out[s].filter((r) => r.id !== id);
    out.tombstones = out.tombstones.filter((t) => t.id !== id);
    const r = (remote[s] || []).find((x) => x.id === id);
    const t = (remote.tombstones || []).find((x) => x.id === id);
    if (r) out[s].push(r);
    if (t) out.tombstones.push(t);
  }
  for (const s of STORES) out[s].sort(byId);
  return out;
}

// The new "last agreed" copy: what was written (or read), except held
// records keep their old base, so the conflict is still seen next time.
export function nextBase(written, oldBase, held) {
  const out = {};
  for (const s of RECORDS) out[s] = Object.fromEntries((written[s] || []).map((r) => [r.id, r]));
  for (const key of held) {
    const cut = key.indexOf('/');
    const s = key.slice(0, cut);
    const id = key.slice(cut + 1);
    const b = oldBase && oldBase[s] && oldBase[s][id];
    if (b) out[s][id] = b;
    else delete out[s][id];
  }
  return out;
}
