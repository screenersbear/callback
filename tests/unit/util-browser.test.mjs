// js/util.js helpers that touch the browser: ?today= pinning, saving and
// reading files.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { saveFile, readFileText } from '../../js/util.js';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('todayStr with ?today= in the address', () => {
  const loadWith = async (search) => {
    window.history.replaceState(null, '', `/${search}`);
    vi.resetModules();
    return import('../../js/util.js');
  };
  afterEach(() => window.history.replaceState(null, '', '/'));

  it('pins today to the given date', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 5, 1, 12));
    const util = await loadWith('?today=2024-02-29');
    expect(util.todayStr()).toBe('2024-02-29');
    expect(util.relDay('2024-03-01')).toBe('tomorrow');
  });
  it('ignores a pinned value that is not a date', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 5, 1, 12));
    for (const bad of ['?today=2024-2-29', '?today=x2024-02-29', '?today=2024-02-29x', '?today=', '?other=2024-02-29']) {
      const util = await loadWith(bad);
      expect(util.todayStr(), bad).toBe('2026-06-01');
    }
  });
  it('uses the real date when there is no address to read', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2025, 0, 1, 0, 30));
    vi.stubGlobal('URLSearchParams', function Broken() { throw new Error('no address'); });
    vi.resetModules();
    const util = await import('../../js/util.js');
    expect(util.todayStr()).toBe('2025-01-01');
  });
});

describe('saveFile', () => {
  let made;
  beforeEach(() => {
    made = [];
    vi.stubGlobal('URL', Object.assign(Object.create(URL), {
      createObjectURL: vi.fn((blob) => { made.push(blob); return 'blob:test-1'; }),
      revokeObjectURL: vi.fn(),
    }));
  });
  const media = (coarse) => vi.stubGlobal('matchMedia', vi.fn((q) => ({ matches: coarse && q === '(pointer: coarse)' })));
  const watchClicks = () => {
    const clicks = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click() {
      clicks.push({ href: this.href, download: this.download, inPage: document.body.contains(this) });
    });
    return clicks;
  };

  it('downloads through a link on a desktop', async () => {
    vi.useFakeTimers();
    media(false);
    const clicks = watchClicks();
    await expect(saveFile('backup.json', '{"a":1}', 'application/json')).resolves.toBe(true);
    expect(made).toHaveLength(1);
    expect(made[0].type).toBe('application/json');
    expect(await made[0].text()).toBe('{"a":1}');
    expect(clicks).toEqual([{ href: 'blob:test-1', download: 'backup.json', inPage: true }]);
    expect(document.querySelectorAll('a')).toHaveLength(0);
    vi.advanceTimersByTime(3999);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-1');
  });
  it('asks matchMedia about a coarse pointer', async () => {
    media(false);
    watchClicks();
    await saveFile('a.txt', 'x', 'text/plain');
    expect(matchMedia).toHaveBeenCalledWith('(pointer: coarse)');
  });
  it('shares the file on a phone that can share it', async () => {
    media(true);
    const clicks = watchClicks();
    const share = vi.fn(async () => {});
    const canShare = vi.fn(() => true);
    vi.stubGlobal('navigator', { canShare, share });
    await expect(saveFile('people.ics', 'BEGIN:VCALENDAR', 'text/calendar')).resolves.toBe(true);
    const file = canShare.mock.calls[0][0].files[0];
    expect(canShare.mock.calls[0][0].files).toHaveLength(1);
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe('people.ics');
    expect(file.type).toBe('text/calendar');
    expect(await file.text()).toBe('BEGIN:VCALENDAR');
    expect(share).toHaveBeenCalledWith({ files: [file], title: 'people.ics' });
    expect(clicks).toHaveLength(0);
  });
  it('returns false when the person closes the share sheet', async () => {
    media(true);
    const clicks = watchClicks();
    const err = Object.assign(new Error('closed'), { name: 'AbortError' });
    vi.stubGlobal('navigator', { canShare: () => true, share: vi.fn(async () => { throw err; }) });
    await expect(saveFile('a.txt', 'x', 'text/plain')).resolves.toBe(false);
    expect(clicks).toHaveLength(0);
  });
  it('falls back to a download when sharing fails another way', async () => {
    media(true);
    const clicks = watchClicks();
    vi.stubGlobal('navigator', { canShare: () => true, share: vi.fn(async () => { throw new Error('not allowed'); }) });
    await expect(saveFile('a.txt', 'x', 'text/plain')).resolves.toBe(true);
    expect(clicks).toHaveLength(1);
  });
  it('falls back to a download when sharing fails with no error', async () => {
    media(true);
    const clicks = watchClicks();
    vi.stubGlobal('navigator', { canShare: () => true, share: vi.fn(() => Promise.reject(undefined)) });
    await expect(saveFile('a.txt', 'x', 'text/plain')).resolves.toBe(true);
    expect(clicks).toHaveLength(1);
  });
  it('downloads on a phone that cannot share files', async () => {
    media(true);
    const clicks = watchClicks();
    const share = vi.fn();
    vi.stubGlobal('navigator', { canShare: () => false, share });
    await expect(saveFile('a.txt', 'x', 'text/plain')).resolves.toBe(true);
    expect(share).not.toHaveBeenCalled();
    expect(clicks).toHaveLength(1);
  });
  it('downloads on a phone with no share support at all', async () => {
    media(true);
    const clicks = watchClicks();
    vi.stubGlobal('navigator', {});
    await expect(saveFile('a.txt', 'x', 'text/plain')).resolves.toBe(true);
    expect(clicks).toHaveLength(1);
  });
  it('does not share on a desktop even when sharing is possible', async () => {
    media(false);
    const clicks = watchClicks();
    const share = vi.fn();
    vi.stubGlobal('navigator', { canShare: () => true, share });
    await saveFile('a.txt', 'x', 'text/plain');
    expect(share).not.toHaveBeenCalled();
    expect(clicks).toHaveLength(1);
  });
  it('saves an empty file', async () => {
    media(false);
    watchClicks();
    await expect(saveFile('empty.txt', '', 'text/plain')).resolves.toBe(true);
    expect(made[0].size).toBe(0);
  });
});

describe('readFileText', () => {
  it('reads a file as text', async () => {
    const file = new File(['{"app":"callback"}'], 'backup.json', { type: 'application/json' });
    await expect(readFileText(file)).resolves.toBe('{"app":"callback"}');
  });
  it('reads an empty file as an empty string', async () => {
    await expect(readFileText(new File([], 'empty.txt'))).resolves.toBe('');
  });
  it('reads accented and emoji text', async () => {
    await expect(readFileText(new Blob(['Café 😀 Test Person']))).resolves.toBe('Café 😀 Test Person');
  });
  it('rejects with the reader error when reading fails', async () => {
    const failure = new Error('read failed');
    vi.stubGlobal('FileReader', class {
      readAsText(file) {
        this.file = file;
        this.error = failure;
        setTimeout(() => this.onerror());
      }
    });
    await expect(readFileText(new Blob(['x']))).rejects.toBe(failure);
  });
  it('turns a non-text result into text', async () => {
    vi.stubGlobal('FileReader', class {
      readAsText() {
        this.result = 42;
        setTimeout(() => this.onload());
      }
    });
    await expect(readFileText(new Blob(['x']))).resolves.toBe('42');
  });
  it('rejects for something that is not a file', async () => {
    await expect(readFileText('not a file')).rejects.toThrow();
  });
});
