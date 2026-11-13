// js/sync.js: one sync against a fake GitHub (fetch is always stubbed; no
// real network) with an in-memory stand-in for js/db.js.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fake from './sync.fakes.mjs';
import { SyncError, syncConfig, validRepo, syncNow, turnOff, getConflicts } from '../../js/sync.js';

vi.mock('../../js/db.js', async () => await import('./sync.fakes.mjs'));

const NOW = '2026-03-10T09:00:00.000Z';
const T0 = '2026-01-01T00:00:00.000Z';
const T1 = '2026-01-02T00:00:00.000Z';
const T2 = '2026-01-03T00:00:00.000Z';
const T3 = '2026-01-04T00:00:00.000Z';
const API = 'https://api.github.com';
const CONTENTS = `${API}/repos/${fake.REPO}/contents/callback.json`;
const HEADERS = { Authorization: `Bearer ${fake.KEY}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };

const cfg = (extra = {}) => ({ repo: fake.REPO, token: fake.KEY, device: 'Test Phone', ...extra });
const person = (id, extra = {}) => ({ id, createdAt: T0, updatedAt: T1, name: 'Test Person', ...extra });
const tomb = (store, id, deletedAt) => ({ id, store, deletedAt, createdAt: deletedAt, updatedAt: deletedAt });
const full = (d = {}) => ({ ...fake.emptyData(), ...d });
// The text a sync writes for these stores.
const written = (data, syncedFrom = 'Test Phone') => JSON.stringify({ app: 'callback', version: 1, exportedAt: NOW, syncedFrom, data: full(data) }, null, 2);

// A device and a repository; fetch goes to the fake GitHub.
function setup({ local = {}, meta = {}, gh = {} } = {}) {
  const device = fake.useDevice(fake.makeDevice(local, meta));
  const github = fake.makeGitHub(gh);
  vi.stubGlobal('fetch', github.fetch);
  return { device, gh: github };
}
// fetch answering with these responses in turn.
function answers(...list) {
  const f = vi.fn();
  for (const r of list) f.mockImplementationOnce(async () => (typeof r === 'function' ? r() : r));
  vi.stubGlobal('fetch', f);
  return f;
}
const methods = (f) => f.mock.calls.map(([url, init]) => `${init.method || 'GET'} ${url}`);
const putBodies = (f) => f.mock.calls.filter(([, init]) => init.method === 'PUT').map(([, init]) => JSON.parse(init.body));

beforeEach(() => {
  fake.resetFakes();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
  // Never the real network: tests that sync put a fake GitHub in place.
  vi.stubGlobal('fetch', vi.fn(async () => {
    throw new Error('no network in tests');
  }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('SyncError', () => {
  it('is an Error with a message and a kind', () => {
    const e = new SyncError('Something went wrong', 'offline');
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe('Something went wrong');
    expect(e.kind).toBe('offline');
  });
  it('keeps any kind it is given', () => {
    expect(new SyncError('x', 'busy').kind).toBe('busy');
  });
  it('has no kind when none is given', () => {
    expect(new SyncError('x').kind).toBeUndefined();
  });
});

describe('syncConfig', () => {
  it('gives the saved repository and key', async () => {
    fake.useDevice(fake.makeDevice({}, { sync: cfg() }));
    expect(await syncConfig()).toEqual(cfg());
  });
  it('gives null when sync was never set up', async () => {
    expect(await syncConfig()).toBe(null);
  });
  it('gives null when the repository or the key is missing', async () => {
    fake.useDevice(fake.makeDevice({}, { sync: { repo: fake.REPO, token: '' } }));
    expect(await syncConfig()).toBe(null);
    fake.useDevice(fake.makeDevice({}, { sync: { repo: '', token: fake.KEY } }));
    expect(await syncConfig()).toBe(null);
  });
});

describe('validRepo', () => {
  it('accepts owner/name', () => {
    expect(validRepo('test-owner/callback-test')).toBe(true);
    expect(validRepo('ab/cd')).toBe(true);
    expect(validRepo('a/b')).toBe(true);
    expect(validRepo('my.name/re_po-2.data')).toBe(true);
  });
  it('turns down names without exactly one slash between two parts', () => {
    expect(validRepo('owner')).toBe(false);
    expect(validRepo('owner/')).toBe(false);
    expect(validRepo('/repo')).toBe(false);
    expect(validRepo('owner/repo/extra')).toBe(false);
    expect(validRepo('')).toBe(false);
  });
  it('turns down spaces and other characters, wherever they are', () => {
    expect(validRepo('bad owner/repo')).toBe(false);
    expect(validRepo('owner/repo bad')).toBe(false);
    expect(validRepo(' owner/repo')).toBe(false);
    expect(validRepo('owner/repo ')).toBe(false);
    expect(validRepo('own?er/repo')).toBe(false);
    expect(validRepo('https://github.com/owner/repo')).toBe(false);
  });
});

describe('syncNow: when sync is off', () => {
  it('does nothing without a saved setup', async () => {
    const f = answers();
    expect(await syncNow()).toEqual({ off: true });
    expect(f).not.toHaveBeenCalled();
  });
  it('does nothing when the key is missing', async () => {
    fake.useDevice(fake.makeDevice({}, { sync: { repo: fake.REPO } }));
    const f = answers();
    expect(await syncNow()).toEqual({ off: true });
    expect(f).not.toHaveBeenCalled();
  });
});

describe('syncNow: the first sync into a new, empty repository', () => {
  it('checks the repository exists, then writes this device\'s data', async () => {
    const p = person('p1');
    const { device, gh } = setup({ local: { people: [p] }, meta: { sync: cfg() } });
    const r = await syncNow();
    expect(r).toEqual({ changedHere: false, conflicts: 0, newConflicts: 0 });
    expect(methods(gh.fetch)).toEqual([`GET ${CONTENTS}`, `GET ${API}/repos/${fake.REPO}`, `PUT ${CONTENTS}`]);
    expect(gh.fetch.mock.calls[0][1]).toEqual({ cache: 'no-store', headers: HEADERS });
    expect(gh.fetch.mock.calls[1][1]).toEqual({ cache: 'no-store', headers: HEADERS });
    const [, put] = gh.fetch.mock.calls[2];
    expect(put).toEqual({ cache: 'no-store', method: 'PUT', body: put.body, headers: { ...HEADERS, 'Content-Type': 'application/json' } });
    const body = JSON.parse(put.body);
    expect(Object.keys(body)).toEqual(['message', 'content']);
    expect(body.message).toBe('Sync from Test Phone');
    expect(fake.unb64(body.content)).toBe(written({ people: [p] }));
    expect(gh.text).toBe(written({ people: [p] }));
    // The last-agreed copy, no clashes, and the setup marked as joined.
    expect(device.meta.syncBase).toEqual({ people: { p1: p }, organizations: {}, circles: {}, touchpoints: {}, news: {}, openLoops: {}, ideas: {}, weeks: {}, settings: {} });
    expect(device.meta.syncConflicts).toEqual([]);
    expect(device.meta.sync).toEqual({ ...cfg(), joined: true, lastSyncAt: NOW, lastError: null, lastErrorKind: null });
  });

  it('writes the file even when this device is empty', async () => {
    const { gh } = setup({ meta: { sync: cfg() } });
    expect(await syncNow()).toEqual({ changedHere: false, conflicts: 0, newConflicts: 0 });
    expect(gh.puts).toHaveLength(1);
    expect(gh.text).toBe(written({}));
  });

  it('names no device when this one has no name', async () => {
    const { gh } = setup({ meta: { sync: cfg({ device: undefined }) } });
    await syncNow();
    expect(gh.puts[0].message).toBe('Sync from a device');
    expect(gh.file().syncedFrom).toBe(null);
  });

  it('turns a missing repository into a "can\'t find" error and saves it', async () => {
    const { device } = setup({ meta: { sync: cfg() }, gh: { repoExists: false } });
    const err = await syncNow().catch((e) => e);
    expect(err).toBeInstanceOf(SyncError);
    expect(err.kind).toBe('repo');
    expect(err.message).toBe(`GitHub can't find ${fake.REPO}, or the key can't see it. Check the name, and that the key was given that repository.`);
    expect(device.meta.sync).toEqual({ ...cfg(), lastError: err.message, lastErrorKind: 'repo', lastErrorAt: NOW });
    expect(device.meta.syncBase).toBeUndefined();
  });

  it('explains a refused key while checking the repository', async () => {
    fake.useDevice(fake.makeDevice({}, { sync: cfg() }));
    answers(fake.json({}, 404), fake.json({}, 401));
    await expect(syncNow()).rejects.toMatchObject({ kind: 'auth' });
  });
});

describe('syncNow: GitHub saying no', () => {
  const failWith = async (status, headers) => {
    fake.useDevice(fake.makeDevice({}, { sync: cfg() }));
    answers(fake.json({ message: 'no' }, status, headers));
    return syncNow().catch((e) => e);
  };

  it('explains a key GitHub turned down', async () => {
    const e = await failWith(401);
    expect(e.kind).toBe('auth');
    expect(e.message).toBe('GitHub turned the key down. Check you copied all of it; if it expired or was deleted, make a new one and paste it in.');
  });

  it('explains being asked to slow down', async () => {
    const e = await failWith(403, { 'x-ratelimit-remaining': '0' });
    expect(e.kind).toBe('server');
    expect(e.message).toBe('GitHub asked Callback to slow down. It tries again in a few minutes.');
  });

  it('explains a key without write access (a 403 that is not about speed)', async () => {
    for (const headers of [undefined, { 'x-ratelimit-remaining': '42' }]) {
      const e = await failWith(403, headers);
      expect(e.kind).toBe('auth');
      expect(e.message).toBe(`The key isn't allowed to change ${fake.REPO}. Give it Contents: Read and write for that repository.`);
    }
  });

  it('explains any other error with its number', async () => {
    const e = await failWith(500);
    expect(e.kind).toBe('server');
    expect(e.message).toBe('GitHub answered with an error (500). Callback tries again by itself.');
    expect((await failWith(502)).message).toBe('GitHub answered with an error (502). Callback tries again by itself.');
  });

  it('only reads the "slow down" header on a 403', async () => {
    const e = await failWith(500, { 'x-ratelimit-remaining': '0' });
    expect(e.message).toBe('GitHub answered with an error (500). Callback tries again by itself.');
  });

  it('says it is offline when GitHub can\'t be reached, and saves that', async () => {
    const device = fake.useDevice(fake.makeDevice({}, { sync: cfg() }));
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));
    const e = await syncNow().catch((x) => x);
    expect(e).toBeInstanceOf(SyncError);
    expect(e.kind).toBe('offline');
    expect(e.message).toBe("Couldn't reach GitHub. Callback tries again once you're online.");
    expect(device.meta.sync.lastErrorKind).toBe('offline');
  });

  it('explains a refused write', async () => {
    fake.useDevice(fake.makeDevice({ people: [person('p1')] }, { sync: cfg() }));
    const f = answers(fake.json({}, 404), fake.json({}), fake.json({}, 403));
    const e = await syncNow().catch((x) => x);
    expect(e.kind).toBe('auth');
    expect(methods(f)).toHaveLength(3);
  });
});

describe('syncNow: reading the shared file', () => {
  it('takes in what other devices added, without writing when nothing is new here', async () => {
    const theirs = person('p2', { name: 'From The Mac' });
    const { device, gh } = setup({ meta: { sync: cfg() }, gh: { text: fake.fileText({ people: [theirs] }) } });
    const r = await syncNow();
    expect(r).toEqual({ changedHere: true, conflicts: 0, newConflicts: 0 });
    expect(device.data.people).toEqual([theirs]);
    expect(methods(gh.fetch)).toEqual([`GET ${CONTENTS}`]);
    expect(device.meta.syncBase.people).toEqual({ p2: theirs });
  });

  it('writes on top of the version it read when this device has something new', async () => {
    const mine = person('p1');
    const theirs = person('p2');
    const { gh } = setup({ local: { people: [mine] }, meta: { sync: cfg() }, gh: { text: fake.fileText({ people: [theirs] }) } });
    expect(await syncNow()).toEqual({ changedHere: true, conflicts: 0, newConflicts: 0 });
    expect(gh.puts).toHaveLength(1);
    expect(gh.puts[0].sha).toBe('sha-0');
    expect(Object.keys(gh.puts[0])).toEqual(['message', 'content', 'sha']);
    expect(gh.file().data.people).toEqual([mine, theirs]);
  });

  it('reports no change here when the file had nothing new', async () => {
    const p = person('p1');
    const { gh } = setup({ local: { people: [p] }, meta: { sync: cfg() }, gh: { text: fake.fileText({ people: [p] }) } });
    expect(await syncNow()).toEqual({ changedHere: false, conflicts: 0, newConflicts: 0 });
    expect(gh.puts).toHaveLength(0);
  });

  it('reads names with accents and emoji correctly, through GitHub\'s wrapped base64', async () => {
    const theirs = person('p2', { name: 'Zoë Ñandú 🙂 Łódź' });
    const { device } = setup({ meta: { sync: cfg() }, gh: { text: fake.fileText({ people: [theirs] }) } });
    await syncNow();
    expect(device.data.people[0].name).toBe('Zoë Ñandú 🙂 Łódź');
  });

  it('reads unwrapped base64 too', async () => {
    const theirs = person('p2', { name: 'Ünwrapped' });
    const { device } = setup({ meta: { sync: cfg() }, gh: { text: fake.fileText({ people: [theirs] }), wrap: false } });
    await syncNow();
    expect(device.data.people[0].name).toBe('Ünwrapped');
  });

  it('asks for the raw file when GitHub leaves the content out (over 1 MB)', async () => {
    const theirs = person('p2');
    const text = fake.fileText({ people: [theirs] });
    const device = fake.useDevice(fake.makeDevice({}, { sync: cfg() }));
    const f = answers(fake.json({ sha: 'big', encoding: 'none', content: '' }), new Response(text, { status: 200 }));
    await syncNow();
    expect(methods(f)).toEqual([`GET ${CONTENTS}`, `GET ${CONTENTS}`]);
    expect(f.mock.calls[1][1]).toEqual({ cache: 'no-store', headers: { ...HEADERS, Accept: 'application/vnd.github.raw' } });
    expect(device.data.people).toEqual([theirs]);
  });

  it('asks for the raw file when the content is empty, or not base64', async () => {
    const text = fake.fileText({ people: [person('p2')] });
    for (const meta of [{ sha: 's', encoding: 'base64', content: '' }, { sha: 's', encoding: 'none', content: 'bm90IHVzZWQ=' }, { sha: 's' }]) {
      const device = fake.useDevice(fake.makeDevice({}, { sync: cfg() }));
      const f = answers(fake.json(meta), new Response(text, { status: 200 }));
      await syncNow();
      expect(f).toHaveBeenCalledTimes(2);
      expect(device.data.people).toHaveLength(1);
    }
  });

  it('explains a failed raw download', async () => {
    fake.useDevice(fake.makeDevice({}, { sync: cfg() }));
    answers(fake.json({ sha: 'big', encoding: 'none', content: '' }), new Response('', { status: 503 }));
    const e = await syncNow().catch((x) => x);
    expect(e.kind).toBe('server');
    expect(e.message).toBe('GitHub answered with an error (503). Callback tries again by itself.');
  });

  it('turns down a file that is not JSON', async () => {
    const { device } = setup({ meta: { sync: cfg() }, gh: { text: 'this is not json' } });
    const e = await syncNow().catch((x) => x);
    expect(e).toBeInstanceOf(SyncError);
    expect(e.kind).toBe('file');
    expect(e.message).toBe(`callback.json in ${fake.REPO} isn't a Callback file. Use a repository just for Callback.`);
    expect(device.meta.sync.lastErrorKind).toBe('file');
  });

  it('turns down JSON that is not a Callback file, with the reader\'s own words', async () => {
    setup({ meta: { sync: cfg() }, gh: { text: JSON.stringify({ app: 'something-else', data: {} }) } });
    const e = await syncNow().catch((x) => x);
    expect(e.kind).toBe('file');
    expect(e.message).toBe("This file doesn't look like a Callback export.");
  });

  it('uses another API address when the setup names one', async () => {
    fake.useDevice(fake.makeDevice({}, { sync: cfg({ api: 'https://github.example.test/api/v3' }) }));
    const f = answers(fake.json({}, 401));
    await syncNow().catch(() => {});
    expect(f.mock.calls[0][0]).toBe(`https://github.example.test/api/v3/repos/${fake.REPO}/contents/callback.json`);
  });
});

describe('syncNow: writing', () => {
  it('writes accents, emoji and big files as UTF-8 base64 GitHub can read back', async () => {
    const long = 'ñ🙂'.repeat(9000) + 'end';
    const p = person('p1', { name: 'Zoë', note: long });
    const { gh } = setup({ local: { people: [p] }, meta: { sync: cfg() } });
    await syncNow();
    expect(fake.unb64(gh.puts[0].content)).toBe(written({ people: [p] }));
    expect(gh.file().data.people[0].note).toBe(long);
  });

  it('reads again and merges when another device wrote first, so nothing is lost', async () => {
    const mine = person('p1', { name: 'Mine' });
    const theirs = person('p2', { name: 'Theirs' });
    const { gh, device } = setup({ local: { people: [mine] }, meta: { sync: cfg() }, gh: { text: fake.fileText({}) } });
    const real = gh.fetch.getMockImplementation();
    let first = true;
    gh.fetch.mockImplementation(async (url, init = {}) => {
      if (init.method === 'PUT' && first) {
        // The Mac's write lands between this device's read and write.
        first = false;
        gh.text = fake.fileText({ people: [theirs] }, { syncedFrom: 'Test Mac' });
        gh.sha = 'sha-mac';
        return fake.json({ message: 'conflict' }, 409);
      }
      return real(url, init);
    });
    expect(await syncNow()).toEqual({ changedHere: true, conflicts: 0, newConflicts: 0 });
    expect(putBodies(gh.fetch).map((b) => b.sha)).toEqual(['sha-0', 'sha-mac']);
    expect(gh.file().data.people).toEqual([mine, theirs]);
    expect(device.data.people).toEqual([mine, theirs]);
  });

  it('tries again after a 422 too', async () => {
    const { gh } = setup({ local: { people: [person('p1')] }, meta: { sync: cfg() }, gh: { text: fake.fileText({}) } });
    const real = gh.fetch.getMockImplementation();
    gh.fetch.mockImplementationOnce(real).mockImplementationOnce(async () => fake.json({}, 422));
    await syncNow();
    expect(gh.puts.length + 1).toBe(2);
    expect(gh.file().data.people).toHaveLength(1);
  });

  it('gives up after four tries when other devices keep writing first', async () => {
    const { gh, device } = setup({ local: { people: [person('p1')] }, meta: { sync: cfg() }, gh: { text: fake.fileText({}) } });
    gh.conflictsLeft = 99;
    const e = await syncNow().catch((x) => x);
    expect(e).toBeInstanceOf(SyncError);
    expect(e.kind).toBe('busy');
    expect(e.message).toBe('Another device kept syncing at the same moment. Callback tries again shortly.');
    expect(gh.puts).toHaveLength(4);
    expect(methods(gh.fetch).filter((m) => m.startsWith('GET'))).toHaveLength(4);
    expect(device.meta.sync.lastErrorKind).toBe('busy');
  });

  it('succeeds on the fourth try', async () => {
    const { gh } = setup({ local: { people: [person('p1')] }, meta: { sync: cfg() }, gh: { text: fake.fileText({}) } });
    gh.conflictsLeft = 3;
    await syncNow();
    expect(gh.puts).toHaveLength(4);
    expect(gh.file().data.people).toHaveLength(1);
  });
});

describe('syncNow: a device joining', () => {
  const mySettings = { id: 'settings', createdAt: T0, updatedAt: T3, goal: 'my goal' };
  const theirSettings = { id: 'settings', createdAt: T0, updatedAt: T1, goal: 'their goal' };

  it('takes the shared settings when the file already has people', async () => {
    const { device, gh } = setup({
      local: { settings: [mySettings], people: [person('p1')] },
      meta: { sync: cfg() },
      gh: { text: fake.fileText({ settings: [theirSettings], people: [person('p2')] }) },
    });
    await syncNow();
    expect(device.data.settings).toEqual([theirSettings]);
    expect(gh.file().data.settings).toEqual([theirSettings]);
    expect(fake.saveSettings).not.toHaveBeenCalled();
  });

  it('takes the shared settings when neither side has people yet', async () => {
    const { device } = setup({ local: { settings: [mySettings] }, meta: { sync: cfg() }, gh: { text: fake.fileText({ settings: [theirSettings] }) } });
    await syncNow();
    expect(device.data.settings).toEqual([theirSettings]);
  });

  it('keeps this device\'s settings, marked newest, when only this device has people', async () => {
    const { device, gh } = setup({
      local: { settings: [mySettings], people: [person('p1')] },
      meta: { sync: cfg() },
      gh: { text: JSON.stringify({ app: 'callback', version: 1, data: { settings: [{ ...theirSettings, updatedAt: '2026-03-01T00:00:00.000Z' }] } }) },
    });
    await syncNow();
    expect(fake.saveSettings).toHaveBeenCalledTimes(1);
    expect(fake.saveSettings).toHaveBeenCalledWith(mySettings);
    const kept = { ...mySettings, updatedAt: NOW };
    expect(device.data.settings).toEqual([kept]);
    expect(gh.file().data.settings).toEqual([kept]);
  });

  it('does not save default settings that were never set here', async () => {
    const { device } = setup({
      local: { people: [person('p1')] },
      meta: { sync: cfg() },
      gh: { text: fake.fileText({ settings: [theirSettings] }) },
    });
    await syncNow();
    expect(fake.saveSettings).not.toHaveBeenCalled();
    expect(device.data.settings).toEqual([theirSettings]);
  });

  it('starts afresh, ignoring a last-agreed copy left from before', async () => {
    const old = person('p1', { city: 'Old' });
    const mine = person('p1', { city: 'Mine', updatedAt: T3 });
    const theirs = person('p1', { city: 'Theirs', updatedAt: T2 });
    const { device, gh } = setup({
      local: { people: [mine] },
      meta: { sync: cfg(), syncBase: { people: { p1: mine } } },
      gh: { text: fake.fileText({ people: [theirs] }) },
    });
    await syncNow();
    // With no shared starting point, the newer copy (this one) wins.
    expect(device.data.people).toEqual([mine]);
    expect(gh.file().data.people).toEqual([mine]);
    expect(fake.getMeta).not.toHaveBeenCalledWith('syncBase');
    expect(old.city).toBe('Old');
  });

  it('after joining, uses the last-agreed copy and the plain rules for settings', async () => {
    const mine = person('p1', { city: 'Mine', updatedAt: T3 });
    const theirs = person('p1', { city: 'Theirs', updatedAt: T2 });
    const { device } = setup({
      local: { people: [mine], settings: [mySettings] },
      meta: { sync: cfg({ joined: true }), syncBase: { people: { p1: mine } } },
      gh: { text: fake.fileText({ people: [theirs], settings: [theirSettings] }) },
    });
    await syncNow();
    // Only the shared copy changed since the last sync: it's taken.
    expect(device.data.people).toEqual([theirs]);
    // Settings: no base, so the newer copy (this one) stays.
    expect(device.data.settings).toEqual([mySettings]);
    expect(fake.getPeople).not.toHaveBeenCalled();
  });
});

describe('syncNow: clashes', () => {
  const b = person('p1', { city: 'Base' });
  const mine = { ...b, city: 'Mine', updatedAt: T2 };
  const theirs = { ...b, city: 'Theirs', updatedAt: T3 };
  const clashSetup = (fileExtra = { syncedFrom: 'Test Mac' }) => setup({
    local: { people: [mine] },
    meta: { sync: cfg({ joined: true }), syncBase: { people: { p1: b } } },
    gh: { text: fake.fileText({ people: [theirs] }, fileExtra) },
  });

  it('saves a clash with where it came from and when it was found, and leaves the file alone', async () => {
    const { device, gh } = clashSetup();
    expect(await syncNow()).toEqual({ changedHere: false, conflicts: 1, newConflicts: 1 });
    expect(device.meta.syncConflicts).toEqual([{
      kind: 'both', store: 'people', id: 'p1', mine, theirs, base: b,
      merged: { name: 'Test Person', city: 'Mine' }, clashes: ['city'], loud: ['city'], children: [],
      from: 'Test Mac', foundAt: NOW,
    }]);
    expect(gh.puts).toHaveLength(0);
    expect(device.data.people).toEqual([mine]);
    // The held record keeps its old last-agreed copy.
    expect(device.meta.syncBase.people).toEqual({ p1: b });
  });

  it('counts a clash as new only the first time', async () => {
    clashSetup();
    await syncNow();
    expect(await syncNow()).toEqual({ changedHere: false, conflicts: 1, newConflicts: 0 });
  });

  it('counts a clash with another record as new', async () => {
    const { device } = clashSetup();
    device.meta.syncConflicts = [{ store: 'people', id: 'other' }, { store: 'ideas', id: 'p1' }];
    expect(await syncNow()).toEqual({ changedHere: false, conflicts: 1, newConflicts: 1 });
  });

  it('names no other device when the file was written by this one, or by nobody named', async () => {
    const one = clashSetup({ syncedFrom: 'Test Phone' });
    await syncNow();
    expect(one.device.meta.syncConflicts[0].from).toBe(null);
    const two = clashSetup({});
    await syncNow();
    expect(two.device.meta.syncConflicts[0].from).toBe(null);
  });

  it('still writes this device\'s other changes while a clash is held', async () => {
    const { device, gh } = clashSetup();
    device.data.ideas = [{ id: 'i1', createdAt: T0, updatedAt: T1, text: 'new idea' }];
    await syncNow();
    expect(gh.puts).toHaveLength(1);
    const file = gh.file();
    expect(file.data.people).toEqual([theirs]);
    expect(file.data.ideas).toHaveLength(1);
    expect(file.syncedFrom).toBe('Test Phone');
  });
});

describe('syncNow: trying a new setup', () => {
  it('keeps the new repository and key once a sync with them works', async () => {
    const { device } = setup({ meta: { sync: cfg({ repo: 'old-owner/old-repo' }) } });
    const next = cfg({ device: 'Test Mac' });
    await syncNow(next);
    expect(device.meta.sync).toEqual({ ...next, joined: true, lastSyncAt: NOW, lastError: null, lastErrorKind: null });
  });

  it('leaves the saved setup alone when the new one fails', async () => {
    const saved = cfg({ repo: 'old-owner/old-repo' });
    const { device } = setup({ meta: { sync: saved }, gh: { repoExists: false } });
    const e = await syncNow(cfg()).catch((x) => x);
    expect(e.kind).toBe('repo');
    expect(device.meta.sync).toEqual(saved);
    expect(fake.setMeta).not.toHaveBeenCalled();
  });

  it('works on a device that never had sync set up', async () => {
    const { device, gh } = setup();
    expect(await syncNow(cfg())).toEqual({ changedHere: false, conflicts: 0, newConflicts: 0 });
    expect(gh.puts).toHaveLength(1);
    expect(device.meta.sync.joined).toBe(true);
  });
});

describe('syncNow: something else going wrong partway', () => {
  it('passes the reason on as a server error and saves it', async () => {
    const { device } = setup({ meta: { sync: cfg() }, gh: { text: fake.fileText({ people: [person('p2')] }) } });
    fake.applySync.mockRejectedValueOnce(new Error('Disk is full'));
    const e = await syncNow().catch((x) => x);
    expect(e).toBeInstanceOf(SyncError);
    expect(e.kind).toBe('server');
    expect(e.message).toBe('Disk is full');
    expect(device.meta.sync).toEqual({ ...cfg(), lastError: 'Disk is full', lastErrorKind: 'server', lastErrorAt: NOW });
  });

  it('uses a plain message when the problem has none', async () => {
    for (const thrown of [{}, null, undefined, new Error('')]) {
      setup({ meta: { sync: cfg() } });
      fake.exportAll.mockRejectedValueOnce(thrown);
      const e = await syncNow().catch((x) => x);
      expect(e.kind).toBe('server');
      expect(e.message).toBe('Sync stopped partway. Callback tries again shortly.');
    }
  });

  it('keeps a sync error\'s own kind', async () => {
    setup({ meta: { sync: cfg() } });
    const own = new SyncError('Own words', 'file');
    fake.exportAll.mockRejectedValueOnce(own);
    await expect(syncNow()).rejects.toBe(own);
  });
});

describe('turnOff', () => {
  it('forgets the setup, the last-agreed copy and the clashes', async () => {
    const device = fake.useDevice(fake.makeDevice({ people: [person('p1')] }, { sync: cfg(), syncBase: { people: {} }, syncConflicts: [{ id: 'x' }], other: 'kept' }));
    await turnOff();
    expect(device.meta).toEqual({ sync: null, syncBase: null, syncConflicts: [], other: 'kept' });
    expect(device.data.people).toHaveLength(1);
  });
  it('works when sync was never on', async () => {
    const device = fake.useDevice(fake.makeDevice());
    await turnOff();
    expect(device.meta).toEqual({ sync: null, syncBase: null, syncConflicts: [] });
  });
  it('makes later syncs do nothing', async () => {
    fake.useDevice(fake.makeDevice({}, { sync: cfg() }));
    await turnOff();
    expect(await syncNow()).toEqual({ off: true });
  });
});

describe('getConflicts', () => {
  it('gives the saved clashes', async () => {
    fake.useDevice(fake.makeDevice({}, { syncConflicts: [{ store: 'people', id: 'p1' }] }));
    expect(await getConflicts()).toEqual([{ store: 'people', id: 'p1' }]);
  });
  it('gives an empty list when none were ever saved', async () => {
    expect(await getConflicts()).toEqual([]);
  });
  it('gives an empty list after sync is turned off', async () => {
    fake.useDevice(fake.makeDevice({}, { syncConflicts: [{ store: 'people', id: 'p1' }] }));
    await turnOff();
    expect(await getConflicts()).toEqual([]);
  });
});
