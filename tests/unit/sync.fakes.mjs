// Test doubles for the sync tests: an in-memory stand-in for js/db.js (one
// "device" at a time, swappable so two devices can share one fake GitHub) and
// a fake GitHub contents API behind a stubbed fetch. No real network, no
// real storage. Not a test file itself (no .test in the name).
import { vi } from 'vitest';

export const SCHEMA_VERSION = 1;
export const STORE_NAMES = ['people', 'organizations', 'circles', 'touchpoints', 'news', 'openLoops', 'ideas', 'weeks', 'settings', 'tombstones'];

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
export const emptyData = () => Object.fromEntries(STORE_NAMES.map((s) => [s, []]));

// A device: its synced records and its device-only meta values.
export function makeDevice(data = {}, meta = {}) {
  return { data: { ...emptyData(), ...clone(data) }, meta: clone(meta) || {} };
}

let dev = makeDevice();
export const current = () => dev;
export function useDevice(d) {
  dev = d;
  return d;
}

export const getMeta = vi.fn(async (key) => clone(dev.meta[key]));
export const setMeta = vi.fn(async (key, value) => {
  dev.meta[key] = clone(value);
});
export const exportAll = vi.fn(async () => ({ app: 'callback', version: SCHEMA_VERSION, exportedAt: new Date().toISOString(), data: clone(dev.data) }));
export const applySync = vi.fn(async (puts, dels) => {
  const changed = STORE_NAMES.some((s) => (puts[s] || []).length || (dels[s] || []).length);
  if (!changed) return false;
  for (const s of STORE_NAMES) {
    for (const id of dels[s] || []) dev.data[s] = dev.data[s].filter((r) => r.id !== id);
    for (const r of puts[s] || []) dev.data[s] = [...dev.data[s].filter((x) => x.id !== r.id), clone(r)];
  }
  return true;
});
export const getPeople = vi.fn(async () => clone(dev.data.people));
// Like the real one: defaults (no updatedAt) when nothing was ever saved.
export const getSettings = vi.fn(async () => clone(dev.data.settings.find((r) => r.id === 'settings')) || { goal: 'default goal' });
export const saveSettings = vi.fn(async (s) => {
  const now = new Date().toISOString();
  const r = { ...s, id: 'settings', createdAt: s.createdAt || now, updatedAt: now };
  dev.data.settings = [...dev.data.settings.filter((x) => x.id !== 'settings'), r];
  return r;
});
export const readExport = vi.fn((payload) => {
  if (!payload || payload.app !== 'callback' || !payload.data) throw new Error("This file doesn't look like a Callback export.");
  const data = {};
  for (const s of STORE_NAMES) data[s] = Array.isArray(payload.data[s]) ? payload.data[s].filter((r) => r && typeof r.id === 'string') : [];
  return data;
});
let syncedChange = null;
export const onSyncedChange = vi.fn((fn) => {
  syncedChange = fn;
});
export const fireSyncedChange = () => syncedChange && syncedChange();

export const allFakes = [getMeta, setMeta, exportAll, applySync, getPeople, getSettings, saveSettings, readExport, onSyncedChange];
export function resetFakes() {
  for (const f of allFakes) f.mockClear();
  dev = makeDevice();
  syncedChange = null;
}

// ---- Fake GitHub ----
export const REPO = 'test-owner/callback-test';
export const KEY = 'test-key-123';
const b64 = (text) => Buffer.from(text, 'utf8').toString('base64');
export const unb64 = (s) => Buffer.from(s, 'base64').toString('utf8');
export const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

// The file's text as a sync would write it.
export const fileText = (data, extra = {}) => JSON.stringify({ app: 'callback', version: 1, exportedAt: '2026-01-01T00:00:00.000Z', syncedFrom: null, ...extra, data: { ...emptyData(), ...data } }, null, 2);

// A repository with (optionally) callback.json in it. Answers like GitHub's
// contents API: 404 for no file, 409 for a write on top of an older sha.
export function makeGitHub({ repo = REPO, repoExists = true, text = null, wrap = true } = {}) {
  const gh = { repo, repoExists, text, sha: text == null ? null : 'sha-0', version: 0, puts: [], wrap, conflictsLeft: 0 };
  gh.fetch = vi.fn(async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || 'GET';
    const contents = `/repos/${gh.repo}/contents/callback.json`;
    if (u.pathname === `/repos/${gh.repo}` && method === 'GET') return gh.repoExists ? json({ full_name: gh.repo }) : json({ message: 'Not Found' }, 404);
    if (u.pathname !== contents || !gh.repoExists) return json({ message: 'Not Found' }, 404);
    if (method === 'GET') {
      if (gh.text == null) return json({ message: 'Not Found' }, 404);
      if (init.headers.Accept === 'application/vnd.github.raw') return new Response(gh.text, { status: 200 });
      const content = gh.wrap ? b64(gh.text).replace(/(.{60})/g, '$1\n') : b64(gh.text);
      return json({ sha: gh.sha, encoding: 'base64', content });
    }
    // PUT
    const body = JSON.parse(init.body);
    gh.puts.push(body);
    if (gh.conflictsLeft > 0) {
      gh.conflictsLeft--;
      return json({ message: 'conflict' }, 409);
    }
    // Like GitHub: no sha for a file that exists is a 422, an old sha a 409.
    if (gh.sha && !body.sha) return json({ message: 'sha missing' }, 422);
    if ((body.sha || null) !== gh.sha) return json({ message: 'sha mismatch' }, 409);
    gh.text = unb64(body.content);
    gh.version++;
    gh.sha = `sha-${gh.version}`;
    return json({ content: { sha: gh.sha } }, 201);
  });
  gh.file = () => JSON.parse(gh.text);
  return gh;
}
