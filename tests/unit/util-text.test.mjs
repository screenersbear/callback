// Text, number and id helpers in js/util.js.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { uuid, span, plural, esc, debounce, hash, normalizeUrl, instagramUrl } from '../../js/util.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('uuid', () => {
  it('uses crypto.randomUUID when there is one', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'from-random-uuid', getRandomValues: () => { throw new Error('not used'); } });
    expect(uuid()).toBe('from-random-uuid');
  });
  it('makes different v4 ids each time', () => {
    const a = uuid();
    const b = uuid();
    expect(a).toMatch(UUID_V4);
    expect(b).toMatch(UUID_V4);
    expect(a).not.toBe(b);
  });
  it('builds a v4 id from random bytes without randomUUID', () => {
    vi.stubGlobal('crypto', { getRandomValues: (b) => { b.forEach((_, i) => { b[i] = i; }); return b; } });
    expect(uuid()).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f');
  });
  it('sets the version and variant bits on all-ones and all-zeros bytes', () => {
    vi.stubGlobal('crypto', { getRandomValues: (b) => b.fill(0xff) });
    expect(uuid()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
    vi.stubGlobal('crypto', { getRandomValues: (b) => b.fill(0) });
    expect(uuid()).toBe('00000000-0000-4000-8000-000000000000');
  });
  it('asks for exactly 16 random bytes', () => {
    const seen = [];
    vi.stubGlobal('crypto', { getRandomValues: (b) => { seen.push(b); return b; } });
    uuid();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeInstanceOf(Uint8Array);
    expect(seen[0]).toHaveLength(16);
  });
});

describe('span', () => {
  it('says zero and one day', () => {
    expect(span(0)).toBe('0 days');
    expect(span(1)).toBe('1 day');
  });
  it('uses weeks for whole weeks up to 12', () => {
    expect(span(7)).toBe('1 week');
    expect(span(14)).toBe('2 weeks');
    expect(span(42)).toBe('6 weeks');
    expect(span(70)).toBe('10 weeks');
    expect(span(84)).toBe('12 weeks');
  });
  it('uses months for whole 30-day months from 2 months on', () => {
    expect(span(60)).toBe('2 months');
    expect(span(90)).toBe('3 months');
    expect(span(180)).toBe('6 months');
    expect(span(210)).toBe('7 months');
  });
  it('uses days otherwise', () => {
    expect(span(2)).toBe('2 days');
    expect(span(10)).toBe('10 days');
    expect(span(30)).toBe('30 days');
    expect(span(91)).toBe('91 days');
    expect(span(98)).toBe('98 days');
    expect(span(365)).toBe('365 days');
  });
  it('reads numbers given as text', () => {
    expect(span('42')).toBe('6 weeks');
    expect(span('1')).toBe('1 day');
  });
  it('says 0 days for empty or bad input', () => {
    expect(span('')).toBe('0 days');
    expect(span(null)).toBe('0 days');
    expect(span(undefined)).toBe('0 days');
    expect(span('often')).toBe('0 days');
  });
});

describe('plural', () => {
  it('uses the single word for one', () => {
    expect(plural(1, 'person', 'people')).toBe('1 person');
    expect(plural(1, 'day')).toBe('1 day');
  });
  it('adds an s by default for other counts', () => {
    expect(plural(0, 'day')).toBe('0 days');
    expect(plural(2, 'day')).toBe('2 days');
    expect(plural(1000000, 'touchpoint')).toBe('1000000 touchpoints');
  });
  it('uses the given plural', () => {
    expect(plural(3, 'person', 'people')).toBe('3 people');
    expect(plural(0, 'person', 'people')).toBe('0 people');
  });
  it('treats "1" as text as plural', () => {
    expect(plural('1', 'day')).toBe('1 days');
    expect(plural(-1, 'day')).toBe('-1 days');
  });
});

describe('esc', () => {
  it('escapes the five HTML characters', () => {
    expect(esc(`<a href="x" title='y'>Tom & Jerry</a>`))
      .toBe('&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;Tom &amp; Jerry&lt;/a&gt;');
  });
  it('escapes every occurrence', () => {
    expect(esc('&&<<>>""\'\'')).toBe('&amp;&amp;&lt;&lt;&gt;&gt;&quot;&quot;&#39;&#39;');
  });
  it('escapes an ampersand before the others, once', () => {
    expect(esc('&lt;')).toBe('&amp;lt;');
  });
  it('leaves plain text alone', () => {
    expect(esc('Test Person')).toBe('Test Person');
    expect(esc('')).toBe('');
  });
  it('turns null and undefined into an empty string', () => {
    expect(esc(null)).toBe('');
    expect(esc(undefined)).toBe('');
  });
  it('turns other values into text', () => {
    expect(esc(0)).toBe('0');
    expect(esc(42)).toBe('42');
    expect(esc(false)).toBe('false');
  });
});

describe('debounce', () => {
  it('calls once after the wait with the last arguments', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn, 200);
    d(1);
    d(2, 'b');
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(199);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(2, 'b');
  });
  it('restarts the wait on every call', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn, 100);
    d('a');
    vi.advanceTimersByTime(80);
    d('b');
    vi.advanceTimersByTime(80);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(20);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenLastCalledWith('b');
  });
  it('calls again for calls after the wait', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn, 50);
    d('first');
    vi.advanceTimersByTime(50);
    d('second');
    vi.advanceTimersByTime(50);
    expect(fn.mock.calls).toEqual([['first'], ['second']]);
  });
  it('waits for the next tick with a zero wait', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    debounce(fn, 0)();
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(0);
    expect(fn).toHaveBeenCalledWith();
  });
  it('keeps separate debounced functions apart', () => {
    vi.useFakeTimers();
    const f1 = vi.fn();
    const f2 = vi.fn();
    const d1 = debounce(f1, 10);
    const d2 = debounce(f2, 10);
    d1('x');
    d2('y');
    vi.advanceTimersByTime(10);
    expect(f1).toHaveBeenCalledWith('x');
    expect(f2).toHaveBeenCalledWith('y');
  });
});

describe('hash', () => {
  it('matches the 32-bit FNV-1a reference values', () => {
    expect(hash('')).toBe(2166136261);
    expect(hash('a')).toBe(3826002220);
    expect(hash('foobar')).toBe(3214735720);
  });
  it('is stable for the same text and differs for different text', () => {
    expect(hash('Test Person|2024-01-05')).toBe(3717492938);
    expect(hash('Test Person|2024-01-05')).toBe(hash('Test Person|2024-01-05'));
    expect(hash('Test Person|2024-01-06')).not.toBe(hash('Test Person|2024-01-05'));
  });
  it('always gives a non-negative 32-bit integer', () => {
    for (const s of ['a', 'foobar', 'é😀', 'x'.repeat(10000)]) {
      const h = hash(s);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(2 ** 32);
    }
    expect(hash('é😀')).toBe(1154239905);
  });
  it('throws for a non-string', () => {
    expect(() => hash(null)).toThrow(TypeError);
  });
});

describe('normalizeUrl', () => {
  it('adds https:// to a bare address', () => {
    expect(normalizeUrl('example.com')).toBe('https://example.com');
    expect(normalizeUrl('www.example.com/path?q=1')).toBe('https://www.example.com/path?q=1');
  });
  it('keeps an address that already has a scheme', () => {
    expect(normalizeUrl('http://example.com')).toBe('http://example.com');
    expect(normalizeUrl('HTTPS://Example.com')).toBe('HTTPS://Example.com');
    expect(normalizeUrl('ftp://files.example.com')).toBe('ftp://files.example.com');
  });
  it('only counts a scheme at the start', () => {
    expect(normalizeUrl('example.com/?next=http://other.example')).toBe('https://example.com/?next=http://other.example');
    expect(normalizeUrl('1http://example.com')).toBe('https://1http://example.com');
  });
  it('trims spaces', () => {
    expect(normalizeUrl('  example.com  ')).toBe('https://example.com');
  });
  it('returns an empty string for empty input', () => {
    expect(normalizeUrl('')).toBe('');
    expect(normalizeUrl('   ')).toBe('');
    expect(normalizeUrl(null)).toBe('');
    expect(normalizeUrl(undefined)).toBe('');
  });
  it('needs the two slashes to count as a scheme', () => {
    expect(normalizeUrl('mailto:test@example.com')).toBe('https://mailto:test@example.com');
    expect(normalizeUrl('http:/example.com')).toBe('https://http:/example.com');
  });
});

describe('instagramUrl', () => {
  it('makes a profile link from a handle', () => {
    expect(instagramUrl('testhandle')).toBe('https://instagram.com/testhandle');
  });
  it('drops a leading @ only', () => {
    expect(instagramUrl('@testhandle')).toBe('https://instagram.com/testhandle');
    expect(instagramUrl('test@handle')).toBe('https://instagram.com/test@handle');
  });
  it('keeps an instagram link, adding https:// if needed', () => {
    expect(instagramUrl('instagram.com/testhandle')).toBe('https://instagram.com/testhandle');
    expect(instagramUrl('https://www.Instagram.com/testhandle')).toBe('https://www.Instagram.com/testhandle');
  });
  it('does not treat lookalike text as a link', () => {
    expect(instagramUrl('instagramXcom')).toBe('https://instagram.com/instagramXcom');
  });
  it('trims spaces', () => {
    expect(instagramUrl('  @testhandle  ')).toBe('https://instagram.com/testhandle');
  });
  it('returns an empty string for empty input', () => {
    expect(instagramUrl('')).toBe('');
    expect(instagramUrl('  ')).toBe('');
    expect(instagramUrl(null)).toBe('');
    expect(instagramUrl(undefined)).toBe('');
  });
});
