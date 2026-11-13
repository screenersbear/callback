// js/sync.js: when syncs run (queued, request, startAutoSync). Each test
// loads a fresh copy of sync.js (it keeps its timer and last-run time in
// module state) and catches the page listeners instead of attaching them.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../js/db.js', async () => await import('./sync.fakes.mjs'));

const NOW = '2026-03-10T09:00:00.000Z';
let fake;
let sync;
let gh;
let handler;
let listeners;
let visibility;

const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
};
// Moves the clock on and lets any sync it starts finish.
const wait = async (ms) => {
  await vi.advanceTimersByTimeAsync(ms);
  await flush();
};
const fire = (target, type) => listeners.filter((l) => l.target === target && l.type === type).forEach((l) => l.fn());
const syncs = () => gh.fetch.mock.calls.filter(([, init]) => (init.method || 'GET') === 'GET').length;

beforeEach(async () => {
  vi.resetModules();
  // The mocked db.js is the fakes module: take it the way sync.js gets it.
  fake = await import('../../js/db.js');
  sync = await import('../../js/sync.js');
  fake.resetFakes();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date(NOW));
  fake.useDevice(fake.makeDevice({}, { sync: { repo: fake.REPO, token: fake.KEY, device: 'Test Phone' } }));
  gh = fake.makeGitHub({ text: fake.fileText({}) });
  vi.stubGlobal('fetch', gh.fetch);
  handler = vi.fn();
  listeners = [];
  vi.spyOn(document, 'addEventListener').mockImplementation((type, fn) => listeners.push({ target: 'document', type, fn }));
  vi.spyOn(window, 'addEventListener').mockImplementation((type, fn) => listeners.push({ target: 'window', type, fn }));
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete document.visibilityState;
});

describe('queued', () => {
  it('runs a sync and gives its result', async () => {
    expect(await sync.queued()).toEqual({ changedHere: false, conflicts: 0, newConflicts: 0 });
    expect(syncs()).toBe(1);
  });

  it('runs syncs one after another, never two at once', async () => {
    const order = [];
    const real = gh.fetch.getMockImplementation();
    gh.fetch.mockImplementation(async (url, init) => {
      order.push('start');
      await flush();
      order.push('end');
      return real(url, init);
    });
    await Promise.all([sync.queued(), sync.queued(), sync.queued()]);
    expect(order).toEqual(['start', 'end', 'start', 'end', 'start', 'end']);
  });

  it('keeps going after a failed sync', async () => {
    gh.fetch.mockImplementationOnce(async () => fake.json({}, 500));
    const first = sync.queued();
    const second = sync.queued();
    await expect(first).rejects.toMatchObject({ kind: 'server' });
    expect(await second).toEqual({ changedHere: false, conflicts: 0, newConflicts: 0 });
  });

  it('tries a new setup when given one', async () => {
    const other = fake.makeGitHub({ repo: 'other-owner/other-repo', text: fake.fileText({}) });
    vi.stubGlobal('fetch', other.fetch);
    await sync.queued({ repo: 'other-owner/other-repo', token: 'test-key-456' });
    expect(other.fetch.mock.calls[0][0]).toBe('https://api.github.com/repos/other-owner/other-repo/contents/callback.json');
    expect(fake.current().meta.sync.repo).toBe('other-owner/other-repo');
  });
});

describe('request', () => {
  it('syncs after the delay and tells the handler', async () => {
    sync.startAutoSync(handler);
    await wait(0);
    handler.mockClear();
    sync.request(4000);
    await wait(3999);
    expect(handler).not.toHaveBeenCalled();
    await wait(1);
    expect(handler).toHaveBeenCalledWith({ changedHere: false, conflicts: 0, newConflicts: 0 });
  });

  it('syncs straight away by default', async () => {
    sync.request();
    await wait(0);
    expect(syncs()).toBe(1);
  });

  it('runs one sync for several requests in a row', async () => {
    sync.request(4000);
    await wait(1000);
    sync.request(4000);
    await wait(3999);
    expect(syncs()).toBe(0);
    await wait(1);
    expect(syncs()).toBe(1);
  });

  it('says nothing to the handler while sync is off', async () => {
    sync.startAutoSync(handler);
    fake.current().meta.sync = null;
    await wait(0);
    expect(handler).not.toHaveBeenCalled();
  });

  it('hands errors to the handler', async () => {
    sync.startAutoSync(handler);
    gh.fetch.mockImplementationOnce(async () => fake.json({}, 401));
    await wait(0);
    expect(handler).toHaveBeenCalledTimes(1);
    const [{ error }] = handler.mock.calls[0];
    expect(error).toBeInstanceOf(sync.SyncError);
    expect(error.kind).toBe('auth');
  });
});

describe('startAutoSync', () => {
  it('syncs when the app opens and listens for saves, the page, focus and the connection', async () => {
    sync.startAutoSync(handler);
    expect(fake.onSyncedChange).toHaveBeenCalledTimes(1);
    expect(listeners.map((l) => `${l.target} ${l.type}`)).toEqual(['document visibilitychange', 'window focus', 'window online']);
    await wait(0);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(syncs()).toBe(1);
  });

  it('syncs four seconds after something is saved', async () => {
    sync.startAutoSync(handler);
    await wait(0);
    fake.fireSyncedChange();
    await wait(3999);
    expect(syncs()).toBe(1);
    await wait(1);
    expect(syncs()).toBe(2);
  });

  it('syncs when the page shows again, unless it synced in the last 15 seconds', async () => {
    sync.startAutoSync(handler);
    await wait(0);
    await wait(15000);
    fire('document', 'visibilitychange');
    await wait(0);
    expect(syncs()).toBe(1);
    await wait(1);
    fire('document', 'visibilitychange');
    await wait(0);
    expect(syncs()).toBe(2);
  });

  it('sends what is waiting when the page is put away', async () => {
    sync.startAutoSync(handler);
    await wait(0);
    fake.fireSyncedChange();
    visibility = 'hidden';
    fire('document', 'visibilitychange');
    await wait(0);
    expect(syncs()).toBe(2);
  });

  it('does nothing when the page is put away with nothing waiting', async () => {
    sync.startAutoSync(handler);
    await wait(0);
    visibility = 'hidden';
    await wait(20000);
    fire('document', 'visibilitychange');
    await wait(0);
    expect(syncs()).toBe(1);
  });

  it('syncs when the window comes to the front, unless it synced in the last 15 seconds', async () => {
    sync.startAutoSync(handler);
    await wait(0);
    await wait(15000);
    fire('window', 'focus');
    await wait(0);
    expect(syncs()).toBe(1);
    await wait(1);
    fire('window', 'focus');
    await wait(0);
    expect(syncs()).toBe(2);
  });

  it('counts the 15 seconds from when the last sync started', async () => {
    sync.startAutoSync(handler);
    await wait(0);
    await wait(30000);
    fake.fireSyncedChange();
    await wait(4000);
    expect(syncs()).toBe(2);
    await wait(14000);
    fire('window', 'focus');
    await wait(0);
    expect(syncs()).toBe(2);
  });

  it('syncs when the connection comes back', async () => {
    sync.startAutoSync(handler);
    await wait(0);
    fire('window', 'online');
    await wait(0);
    expect(syncs()).toBe(2);
  });

  it('syncs every two minutes while the page is showing', async () => {
    sync.startAutoSync(handler);
    await wait(0);
    await wait(119999);
    expect(syncs()).toBe(1);
    // At two minutes the interval asks for a sync "now". (The fake clock
    // runs a zero delay set during a tick one millisecond later.)
    await wait(1);
    await wait(1);
    expect(syncs()).toBe(2);
    await wait(120000);
    expect(syncs()).toBe(3);
  });

  it('skips the two-minute sync while the page is hidden', async () => {
    sync.startAutoSync(handler);
    await wait(0);
    visibility = 'hidden';
    await wait(240000);
    await wait(1);
    expect(syncs()).toBe(1);
  });
});
