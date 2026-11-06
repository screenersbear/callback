// Sync between your devices through one file, callback.json, in a private
// GitHub repository you own.
//
// Every device keeps working on its own, offline too. A sync reads the file,
// combines it with this device's records field by field (js/merge.js: what
// changed on one side is taken, changes to different fields of the same
// record are both kept, and a real clash is held and asked about), then
// writes the result back if this device had anything new. GitHub refuses a
// write made on top of an older copy, so when two devices sync at once the
// second one reads again and merges first; nothing is lost. The
// repository's history keeps every version, so it's a backup as well.
//
// Device-only values (db meta): 'sync' (repository, key, status),
// 'syncBase' (each record as last agreed, for telling who changed what) and
// 'syncConflicts' (clashes waiting for an answer).
//
// The repository name and key are kept with this device's own values (db
// meta): never in a backup, never in the file. One day this can sit behind
// a proper sign-in instead; only this file talks to GitHub.

import * as db from './db.js';
import { nowISO } from './util.js';
import { STORES, dataKey, planMerge, fileData, nextBase, resolvedRecord, keyOf } from './merge.js';

const FILE = 'callback.json';
const GITHUB = 'https://api.github.com';

export class SyncError extends Error {
  constructor(message, kind) {
    super(message);
    this.kind = kind; // offline, auth, repo, file, busy, server
  }
}

export async function syncConfig() {
  const cfg = await db.getMeta('sync');
  return cfg && cfg.repo && cfg.token ? cfg : null;
}

export const validRepo = (repo) => /^[\w.-]+\/[\w.-]+$/.test(repo);

async function call(cfg, path, { accept = 'application/vnd.github+json', ...opts } = {}) {
  const headers = { Authorization: `Bearer ${cfg.token}`, Accept: accept, 'X-GitHub-Api-Version': '2022-11-28' };
  if (opts.body) headers['Content-Type'] = 'application/json';
  try {
    return await fetch(`${cfg.api || GITHUB}${path}`, { cache: 'no-store', ...opts, headers });
  } catch {
    throw new SyncError("Couldn't reach GitHub. Callback tries again once you're online.", 'offline');
  }
}

function explain(res, cfg) {
  if (res.status === 401) {
    return new SyncError("GitHub turned the key down. Check you copied all of it; if it expired or was deleted, make a new one and paste it in.", 'auth');
  }
  if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
    return new SyncError('GitHub asked Callback to slow down. It tries again in a few minutes.', 'server');
  }
  if (res.status === 403) {
    return new SyncError(`The key isn't allowed to change ${cfg.repo}. Give it Contents: Read and write for that repository.`, 'auth');
  }
  if (res.status === 404) {
    return new SyncError(`GitHub can't find ${cfg.repo}, or the key can't see it. Check the name, and that the key was given that repository.`, 'repo');
  }
  return new SyncError(`GitHub answered with an error (${res.status}). Callback tries again by itself.`, 'server');
}

// Base64 of the UTF-8 text, as GitHub wants it (names can have accents).
function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function fromBase64(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

async function readRemote(cfg) {
  const path = `/repos/${cfg.repo}/contents/${FILE}`;
  const res = await call(cfg, path);
  if (res.status === 404) {
    // No file yet (a new repository), or no repository: tell them apart.
    const repo = await call(cfg, `/repos/${cfg.repo}`);
    if (repo.ok) return { sha: null, payload: null };
    throw explain(repo, cfg);
  }
  if (!res.ok) throw explain(res, cfg);
  const meta = await res.json();
  let text;
  if (meta.encoding === 'base64' && meta.content) {
    text = fromBase64(meta.content);
  } else {
    // Over 1 MB GitHub leaves the content out; ask for the file itself.
    const raw = await call(cfg, path, { accept: 'application/vnd.github.raw' });
    if (!raw.ok) throw explain(raw, cfg);
    text = await raw.text();
  }
  try {
    const payload = JSON.parse(text);
    return { sha: meta.sha, payload, data: db.readExport(payload) };
  } catch (err) {
    throw new SyncError(err instanceof SyntaxError ? `${FILE} in ${cfg.repo} isn't a Callback file. Use a repository just for Callback.` : err.message, 'file');
  }
}

// The new version's id, or null when another device wrote first.
async function writeRemote(cfg, text, sha) {
  const body = { message: `Sync from ${cfg.device || 'a device'}`, content: toBase64(text) };
  if (sha) body.sha = sha;
  const res = await call(cfg, `/repos/${cfg.repo}/contents/${FILE}`, { method: 'PUT', body: JSON.stringify(body) });
  if (res.status === 409 || res.status === 422) return null;
  if (!res.ok) throw explain(res, cfg);
  return (await res.json()).content.sha;
}

// A device joining takes the shared settings (goals, rhythms), since its own
// may just be fresh defaults. But when the shared copy has nobody in it yet
// (an empty device connected first) and this one has your people, this
// device's settings are the real ones: they're marked newest so they win on
// every device. Whichever device connects first, nothing real is lost.
async function joinRule(payload) {
  const theirs = (payload.data.people || []).length;
  const mine = (await db.getPeople()).length;
  if (theirs || !mine) return ['settings'];
  const s = await db.getSettings();
  if (s.updatedAt) await db.saveSettings(s);
  return [];
}

// One sync. Pass cfg to try a new repository or key before keeping it.
// Returns { changedHere } (true when the other devices' changes came in).
export async function syncNow(newCfg = null) {
  const cfg = newCfg || (await syncConfig());
  if (!cfg) return { off: true };
  let changedHere = false;
  let done = false;
  let conflicts = [];
  let base = null;
  try {
    // A device joining (or moving to another repository) starts afresh.
    const oldBase = cfg.joined ? await db.getMeta('syncBase') : null;
    for (let tries = 0; tries < 4 && !done; tries++) {
      const remote = await readRemote(cfg);
      const theirs = remote.data || Object.fromEntries(STORES.map((s) => [s, []]));
      let held = new Set();
      conflicts = [];
      if (remote.payload) {
        const incomingWins = cfg.joined ? [] : await joinRule(remote.payload);
        const plan = planMerge((await db.exportAll()).data, theirs, oldBase, { incomingWins, now: nowISO() });
        if (await db.applySync(plan.puts, plan.dels)) changedHere = true;
        held = plan.held;
        const from = remote.payload.syncedFrom && remote.payload.syncedFrom !== cfg.device ? remote.payload.syncedFrom : null;
        conflicts = plan.conflicts.map((c) => ({ ...c, from, foundAt: nowISO() }));
      }
      const out = fileData((await db.exportAll()).data, theirs, held);
      if (remote.payload && dataKey(out) === dataKey(theirs)) done = true;
      else {
        const text = JSON.stringify({ app: 'callback', version: db.SCHEMA_VERSION, exportedAt: nowISO(), syncedFrom: cfg.device || null, data: out }, null, 2);
        done = !!(await writeRemote(cfg, text, remote.sha));
      }
      if (done) base = nextBase(out, oldBase, held);
    }
    if (!done) throw new SyncError('Another device kept syncing at the same moment. Callback tries again shortly.', 'busy');
  } catch (err) {
    const e = err instanceof SyncError ? err : new SyncError(err && err.message ? err.message : 'Sync stopped partway. Callback tries again shortly.', 'server');
    if (!newCfg) await db.setMeta('sync', { ...cfg, lastError: e.message, lastErrorKind: e.kind, lastErrorAt: nowISO() });
    throw e;
  }
  const before = new Set(((await db.getMeta('syncConflicts')) || []).map((c) => keyOf(c.store, c.id)));
  await db.setMeta('syncBase', base);
  await db.setMeta('syncConflicts', conflicts);
  await db.setMeta('sync', { ...cfg, joined: true, lastSyncAt: nowISO(), lastError: null, lastErrorKind: null });
  const fresh = conflicts.filter((c) => !before.has(keyOf(c.store, c.id))).length;
  return { changedHere, conflicts: conflicts.length, newConflicts: fresh };
}

export async function turnOff() {
  await db.setMeta('sync', null);
  await db.setMeta('syncBase', null);
  await db.setMeta('syncConflicts', []);
}

export async function getConflicts() {
  return (await db.getMeta('syncConflicts')) || [];
}

// ---- Answering a conflict ----
// side: 'mine' or 'theirs' for a record changed on both; 'keep' or 'delete'
// when one side deleted it. The answer is saved here as the newest copy and
// the last-agreed copy is moved on, so the next sync sends it out.

export function resolve(c, side) {
  const p = chain.then(() => applyAnswer(c, side));
  chain = p.catch(() => {});
  return p.then((r) => {
    request(0);
    return r;
  });
}

async function applyAnswer(c, side) {
  const base = (await db.getMeta('syncBase')) || {};
  const setBase = (s, id, rec) => {
    base[s] = base[s] || {};
    if (rec) base[s][id] = rec;
    else delete base[s][id];
  };
  const here = (await db.exportAll()).data;
  const cur = (s, id) => here[s].find((r) => r.id === id) || null;
  const puts = Object.fromEntries(STORES.map((s) => [s, []]));
  const dels = Object.fromEntries(STORES.map((s) => [s, []]));
  const now = nowISO();
  const tomb = (x) => ({ id: x.id, store: x.store, deletedAt: now, createdAt: now, updatedAt: now });
  const all = [{ store: c.store, id: c.id, theirs: c.theirs }, ...(c.children || [])];
  let stale = false;

  if (c.kind === 'both') {
    const mine = cur(c.store, c.id);
    // Changed again here since the question came up: ask afresh next sync.
    if (!mine || mine.updatedAt !== c.mine.updatedAt) stale = true;
    else {
      puts[c.store].push({ ...resolvedRecord(c, side), updatedAt: now });
      setBase(c.store, c.id, c.theirs);
    }
  } else if (c.kind === 'deletedThere') {
    for (const x of all) {
      const mine = cur(x.store, x.id);
      if (side === 'keep') {
        if (mine) puts[x.store].push({ ...mine, updatedAt: now });
      } else {
        if (mine) dels[x.store].push(x.id);
        puts.tombstones.push(tomb(x));
      }
      setBase(x.store, x.id, null);
    }
  } else if (c.kind === 'deletedHere') {
    for (const x of all) {
      if (!x.theirs) continue;
      if (side === 'keep') {
        puts[x.store].push(x.theirs);
        dels.tombstones.push(x.id);
      } else if (!here.tombstones.some((t) => t.id === x.id)) {
        puts.tombstones.push(tomb(x));
      }
      setBase(x.store, x.id, x.theirs);
    }
  }
  await db.applySync(puts, dels);
  await db.setMeta('syncBase', base);
  const left = (await getConflicts()).filter((x) => keyOf(x.store, x.id) !== keyOf(c.store, c.id));
  await db.setMeta('syncConflicts', left);
  return { stale };
}

// ---- When to sync ----
// A few seconds after anything is saved, when the app opens or comes back
// to the front, when the connection returns, and every couple of minutes
// while it's open. Syncs run one after another, never two at once.

let timer = null;
let lastRun = 0;
let chain = Promise.resolve();
let onResult = () => {};

// Runs a sync after any that's under way. cfg: see syncNow.
export function queued(cfg = null) {
  const p = chain.then(() => syncNow(cfg));
  chain = p.catch(() => {});
  return p;
}

export function startAutoSync(handler) {
  onResult = handler;
  db.onSyncedChange(() => request(4000));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (Date.now() - lastRun > 15000) request(0);
    } else if (timer) {
      // Leaving the app with something unsent: send it now.
      request(0);
    }
  });
  // On the Mac, switching back to the window doesn't count as the page
  // showing again, so coming to the front syncs too.
  window.addEventListener('focus', () => {
    if (Date.now() - lastRun > 15000) request(0);
  });
  window.addEventListener('online', () => request(0));
  setInterval(() => {
    if (document.visibilityState === 'visible') request(0);
  }, 120000);
  request(0);
}

export function request(delay = 0) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    lastRun = Date.now();
    queued().then(
      (r) => {
        if (!r.off) onResult(r);
      },
      (error) => onResult({ error }),
    );
  }, delay);
}
