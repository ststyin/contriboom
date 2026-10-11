import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { calendarRange, normalizeCalendar } from '../src/github/calendar.ts';
import { getGitHubContributions } from '../src/github/client.ts';
import { createArena } from '../src/engine/map.ts';
import { simulate } from '../src/engine/simulator.ts';
import { renderSvg } from '../src/renderer/svg.ts';

const DAY = 86_400_000;
const LEVELS = ['NONE', 'FIRST_QUARTILE', 'SECOND_QUARTILE', 'THIRD_QUARTILE', 'FOURTH_QUARTILE'];
const NOW = new Date('2026-10-10T12:00:00Z');

function userCalendar(from: string, to: string, login = 'octocat') {
  const weeks = new Map<string, { firstDay: string; contributionDays: Array<{
    date: string; weekday: number; contributionCount: number; contributionLevel: string;
  }> }>();
  let totalContributions = 0;
  for (let time = Date.parse(from), index = 0; time <= Date.parse(to); time += DAY, index++) {
    const weekday = new Date(time).getUTCDay();
    const firstDay = new Date(time - weekday * DAY).toISOString().slice(0, 10);
    if (!weeks.has(firstDay)) weeks.set(firstDay, { firstDay: new Date(time).toISOString().slice(0, 10), contributionDays: [] });
    const level = index % 5;
    const count = level * 3;
    totalContributions += count;
    weeks.get(firstDay)!.contributionDays.push({
      date: new Date(time).toISOString().slice(0, 10), weekday, contributionCount: count, contributionLevel: LEVELS[level]!,
    });
  }
  return { login, contributionsCollection: { contributionCalendar: { totalContributions, weeks: [...weeks.values()] } } };
}

describe('GitHub calendar normalization', () => {
  it('aligns partial weeks to Sunday without changing real counts or levels', () => {
    const range = calendarRange(2025, NOW);
    const user = userCalendar('2025-01-01', '2025-12-31');
    const calendar = normalizeCalendar(user, 'OCTOCAT', range);
    expect(calendar.width).toBe(53);
    expect(calendar.contributions).toHaveLength(371);
    expect(calendar.contributions[0]).toEqual({ date: '2024-12-29', count: 0, level: 0 });
    expect(calendar.contributions.at(-1)).toEqual({ date: '2026-01-03', count: 0, level: 0 });
    for (const day of user.contributionsCollection.contributionCalendar.weeks.flatMap(week => week.contributionDays)) {
      expect(calendar.contributions.find(value => value.date === day.date)).toEqual({
        date: day.date, count: day.contributionCount, level: LEVELS.indexOf(day.contributionLevel),
      });
    }
    expect(calendar.contributions.reduce((sum, day) => sum + day.count, 0)).toBe(user.contributionsCollection.contributionCalendar.totalContributions);
    expect(createArena(calendar.contributions, calendar.width).tiles).toHaveLength(371);
  });

  it('preserves the 54 weeks needed by a leap year starting on Saturday', () => {
    const leapSaturday = normalizeCalendar(userCalendar('2028-01-01', '2028-12-31'), 'octocat', calendarRange(2028, new Date('2029-01-01Z')));
    expect(leapSaturday.width).toBe(54);
    expect(leapSaturday.contributions).toHaveLength(378);
    const replay = simulate(createArena(leapSaturday.contributions, leapSaturday.width), { mode: 'preview' });
    expect(renderSvg(replay)).toContain('<title id="title">Contribution calendar</title>');
  });

  it('queries only elapsed dates in the current year and pads the rest of that year', () => {
    const range = calendarRange(2026, NOW);
    expect(range.to).toBe('2026-10-10T23:59:59.999Z');
    expect(range.endDate).toBe('2026-12-31');
    const calendar = normalizeCalendar(userCalendar('2026-01-01', '2026-10-10'), 'octocat', range);
    expect(calendar.width).toBe(53);
    expect(calendar.contributions.find(day => day.date === '2026-10-11')).toEqual({ date: '2026-10-11', count: 0, level: 0 });
  });

  it('uses UTC and keeps rolling periods at 365 inclusive days across leap years', () => {
    expect(calendarRange(undefined, NOW)).toEqual({
      from: '2025-10-11T00:00:00.000Z', to: '2026-10-10T23:59:59.999Z', endDate: '2026-10-10',
    });
    expect(calendarRange(undefined, new Date('2024-02-29T10:00:00Z')).from).toBe('2023-03-02T00:00:00.000Z');
    for (const now of ['2024-02-29T10:00:00Z', '2024-03-01T10:00:00Z', '2025-02-28T10:00:00Z', '2026-10-11T04:22:34Z']) {
      const range = calendarRange(undefined, new Date(now));
      expect((Date.parse(range.to.slice(0, 10)) - Date.parse(range.from)) / DAY + 1).toBe(365);
    }
    for (const year of [2007, 2027, 2025.5, NaN]) expect(() => calendarRange(year, NOW)).toThrow(/Year/);
  });

  it.each(['duplicate', 'missing', 'date', 'weekday', 'level', 'count', 'total', 'login'])(
    'rejects a malformed %s instead of silently filling real dates', defect => {
      const user = userCalendar('2025-01-01', '2025-12-31');
      const calendar = user.contributionsCollection.contributionCalendar;
      const day = calendar.weeks[0]!.contributionDays[0]!;
      if (defect === 'duplicate') calendar.weeks[0]!.contributionDays.push({ ...day });
      if (defect === 'missing') calendar.weeks[0]!.contributionDays.shift();
      if (defect === 'date') day.date = '2025-02-31';
      if (defect === 'weekday') day.weekday = 6;
      if (defect === 'level') day.contributionLevel = 'UNKNOWN';
      if (defect === 'count') day.contributionCount = -1;
      if (defect === 'total') calendar.totalContributions++;
      if (defect === 'login') user.login = 'another-account';
      expect(() => normalizeCalendar(user, 'octocat', calendarRange(2025, NOW))).toThrow();
    },
  );
});

describe('GitHub requests and cache', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const directories: string[] = [];
  const options = { username: 'octocat', token: 'test-token-that-is-never-persisted', year: 2025, cacheDirectory: false as const };
  const response = () => Response.json({ data: { user: userCalendar('2025-01-01', '2025-12-31') } });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.stubEnv('GITHUB_TOKEN', '');
    vi.stubEnv('GH_TOKEN', '');
    fetchMock = vi.fn().mockImplementation(async () => response());
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
  });
  async function cacheDirectory() {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'contriboom-cache-test-'));
    directories.push(directory);
    return directory;
  }

  it('sends a read-only parameterized query to GitHub and maps its response', async () => {
    const result = await getGitHubContributions(options);
    const [url, request] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.github.com/graphql');
    expect(request.method).toBe('POST');
    expect(request.redirect).toBe('error');
    expect(request.headers.Authorization).toBe(`Bearer ${options.token}`);
    const body = JSON.parse(request.body);
    expect(body.query).toContain('query ContriboomCalendar');
    expect(body.query).not.toContain('mutation');
    expect(body.variables).toEqual({ login: 'octocat', from: '2025-01-01T00:00:00.000Z', to: '2025-12-31T23:59:59.999Z' });
    expect(result.source).toBe('github');
    expect(result.width).toBe(53);
  });

  it('accepts the complete 365-day rolling calendar returned by GitHub, including today', async () => {
    const user = userCalendar('2025-10-11', '2026-10-10');
    fetchMock.mockResolvedValueOnce(Response.json({ data: { user } }));
    const result = await getGitHubContributions({ ...options, year: undefined });
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.variables).toEqual({ login: 'octocat', from: '2025-10-11T00:00:00.000Z', to: '2026-10-10T23:59:59.999Z' });
    expect(result.range.from).toBe('2025-10-11T00:00:00.000Z');
    expect(result.contributions.reduce((total, day) => total + day.count, 0)).toBe(user.contributionsCollection.contributionCalendar.totalContributions);
    expect(result.contributions.find(day => day.date === '2026-10-10')?.count).toBeGreaterThan(0);
  });

  it('uses environment tokens and fails before requesting if the token is missing', async () => {
    await expect(getGitHubContributions({ ...options, token: undefined })).rejects.toThrow(/GITHUB_TOKEN or GH_TOKEN/);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.stubEnv('GH_TOKEN', 'environment-token');
    await getGitHubContributions({ ...options, token: undefined });
    expect(fetchMock.mock.calls[0]![1].headers.Authorization).toBe('Bearer environment-token');
    vi.stubEnv('GITHUB_TOKEN', 'preferred-token');
    await getGitHubContributions({ ...options, token: undefined });
    expect(fetchMock.mock.calls[1]![1].headers.Authorization).toBe('Bearer preferred-token');
  });

  it.each(['../user', 'user/name', '-user', 'user--name', 'user-', ''])('rejects invalid account %s before requesting', async username => {
    await expect(getGitHubContributions({ ...options, username })).rejects.toThrow(/username/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [401, undefined, 'authentication'],
    [403, undefined, 'denied access'],
    [429, undefined, 'rate limit'],
    [503, undefined, 'HTTP 503'],
    [200, { errors: [{ type: 'NOT_FOUND', message: 'untrusted text' }], data: { user: null } }, 'not found'],
    [200, { errors: [{ type: 'FORBIDDEN' }], data: { user: {} } }, 'denied access'],
    [200, { errors: [{ type: 'RATE_LIMITED' }] }, 'rate limit'],
    [200, { errors: [{ message: 'untrusted text' }], data: { user: {} } }, 'complete contribution'],
    [200, { data: { user: null } }, 'not found'],
  ])('handles HTTP %s / API errors without falling back', async (status, payload, message) => {
    fetchMock.mockResolvedValueOnce(Response.json(payload ?? {}, { status }));
    await expect(getGitHubContributions(options)).rejects.toThrow(message);
  });

  it('handles invalid JSON, network failure and timeout without leaking request details', async () => {
    fetchMock.mockResolvedValueOnce(new Response('not JSON'));
    await expect(getGitHubContributions(options)).rejects.toThrow(/invalid JSON/);
    fetchMock.mockRejectedValueOnce(new Error(options.token));
    await expect(getGitHubContributions(options)).rejects.toThrow('Unable to reach GitHub. Check the network connection.');
    fetchMock.mockRejectedValueOnce(new DOMException('timeout', 'TimeoutError'));
    await expect(getGitHubContributions(options)).rejects.toThrow(/timed out/);
  });

  it('reuses fresh validated cache entries and persists neither tokens nor request headers', async () => {
    const directory = await cacheDirectory();
    const cachedOptions = { ...options, cacheDirectory: directory };
    const first = await getGitHubContributions(cachedOptions);
    const second = await getGitHubContributions({ ...cachedOptions, username: 'OCTOCAT' });
    expect(first.source).toBe('github');
    expect(second.source).toBe('cache');
    expect(second.contributions).toEqual(first.contributions);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const files = await readdir(directory);
    expect(files).toHaveLength(1);
    const content = await readFile(path.join(directory, files[0]!), 'utf8');
    expect(content).not.toContain(options.token);
    expect(content).not.toMatch(/Authorization|Bearer/);
    await getGitHubContributions({ ...cachedOptions, token: 'different-permissions' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refetches expired, refreshed and corrupted caches, with no stale fallback on failure', async () => {
    const directory = await cacheDirectory();
    const cachedOptions = { ...options, cacheDirectory: directory, cacheTtlSeconds: 60 };
    await getGitHubContributions(cachedOptions);
    vi.setSystemTime(new Date(NOW.getTime() + 60_000));
    await getGitHubContributions(cachedOptions);
    await getGitHubContributions({ ...cachedOptions, refresh: true });
    const cacheFile = path.join(directory, (await readdir(directory))[0]!);
    await writeFile(cacheFile, '{corrupt');
    await getGitHubContributions(cachedOptions);
    const cached = JSON.parse(await readFile(cacheFile, 'utf8'));
    cached.user.contributionsCollection.contributionCalendar.totalContributions++;
    await writeFile(cacheFile, JSON.stringify(cached));
    await getGitHubContributions(cachedOptions);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    fetchMock.mockResolvedValueOnce(new Response('', { status: 503 }));
    await expect(getGitHubContributions({ ...cachedOptions, refresh: true })).rejects.toThrow(/503/);
  });

  it('disables cache reads at zero TTL and bypasses all cache I/O with cacheDirectory false', async () => {
    const directory = await cacheDirectory();
    for (let index = 0; index < 2; index++) await getGitHubContributions({ ...options, cacheDirectory: directory, cacheTtlSeconds: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await readdir(directory)).toHaveLength(1);
    await getGitHubContributions(options);
    await getGitHubContributions(options);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    await expect(getGitHubContributions({ ...options, cacheTtlSeconds: -1 })).rejects.toThrow(/TTL/);
  });
});
