import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { calendarRange, normalizeCalendar } from './calendar.ts';
import type { CalendarRange, GitHubCalendar } from './calendar.ts';

const QUERY = `query ContriboomCalendar($login: String!, $from: DateTime!, $to: DateTime!) {
  user(login: $login) {
    login
    contributionsCollection(from: $from, to: $to) {
      contributionCalendar {
        totalContributions
        weeks {
          firstDay
          contributionDays { date weekday contributionCount contributionLevel }
        }
      }
    }
  }
}`;

export interface GitHubOptions {
  username: string;
  token?: string;
  year?: number;
  cacheDirectory?: string | false;
  cacheTtlSeconds?: number;
  refresh?: boolean;
}

export interface GitHubResult extends GitHubCalendar {
  source: 'github' | 'cache';
  fetchedAt: string;
  range: CalendarRange;
}

type JsonObject = Record<string, unknown>;
const isObject = (value: unknown): value is JsonObject => value !== null && typeof value === 'object' && !Array.isArray(value);

function apiError(response: Response, payload?: JsonObject): Error {
  const errors = Array.isArray(payload?.errors) ? payload.errors : [];
  const types = errors.filter(isObject).map(error => error.type ?? (isObject(error.extensions) ? error.extensions.code : undefined));
  if (response.status === 401) return new Error('GitHub authentication failed. Check GITHUB_TOKEN or GH_TOKEN.');
  if (response.status === 429 || response.headers.get('x-ratelimit-remaining') === '0' || types.includes('RATE_LIMITED')) {
    return new Error('GitHub API rate limit reached. Try again after the limit resets.');
  }
  if (response.status === 403 || types.includes('FORBIDDEN')) {
    return new Error('GitHub denied access. Check the token permissions for this account.');
  }
  if (types.includes('NOT_FOUND')) return new Error('GitHub account was not found. Check --username.');
  if (!response.ok) return new Error(`GitHub request failed (HTTP ${response.status}). Try again later.`);
  return new Error('GitHub could not return a complete contribution calendar. Check the account and token permissions.');
}

async function fetchUser(username: string, token: string, range: CalendarRange): Promise<JsonObject> {
  let response: Response;
  try {
    response = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'Contriboom' },
      body: JSON.stringify({ query: QUERY, variables: { login: username, from: range.from, to: range.to } }),
      signal: AbortSignal.timeout(15_000),
      redirect: 'error',
    });
  } catch (error) {
    const timeout = error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name);
    throw new Error(timeout ? 'GitHub request timed out. Try again.' : 'Unable to reach GitHub. Check the network connection.');
  }
  if (!response.ok) throw apiError(response);
  let payload: unknown;
  try { payload = await response.json(); } catch { throw new Error('GitHub returned an invalid JSON response.'); }
  if (!isObject(payload)) throw new Error('GitHub returned an invalid response.');
  if (payload.errors !== undefined && (!Array.isArray(payload.errors) || payload.errors.length > 0)) throw apiError(response, payload);
  if (!isObject(payload.data)) throw new Error('GitHub returned no contribution data.');
  if (payload.data.user === null) throw new Error('GitHub account was not found. Check --username.');
  if (!isObject(payload.data.user)) throw new Error('GitHub returned no account data.');
  return payload.data.user;
}

/** A cache hit stays local; failures never substitute stale or simulated contributions. */
export async function getGitHubContributions(options: GitHubOptions): Promise<GitHubResult> {
  const username = options.username.trim();
  if (!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(username) || username.includes('--')) {
    throw new Error('Invalid GitHub username.');
  }
  const range = calendarRange(options.year, new Date());
  const ttl = options.cacheTtlSeconds ?? 3600;
  if (!Number.isFinite(ttl) || ttl < 0) throw new Error('Cache TTL must be a nonnegative number of seconds.');
  const token = options.token?.trim() ?? (process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim());
  if (!token) throw new Error('Set GITHUB_TOKEN or GH_TOKEN to read GitHub contributions.');
  const cacheDirectory = options.cacheDirectory === false ? undefined : path.resolve(options.cacheDirectory ?? '.cache/contriboom');
  // Separate credentials so a cache from a privileged token is never reused for another token.
  const key = createHash('sha256').update(JSON.stringify({ username: username.toLowerCase(), range, token })).digest('hex');
  const cacheFile = cacheDirectory && path.join(cacheDirectory, `${key}.json`);
  if (cacheFile && !options.refresh && ttl > 0) {
    let cached: unknown;
    try { cached = JSON.parse(await readFile(cacheFile, 'utf8')); } catch { /* Missing or unreadable caches are misses. */ }
    if (isObject(cached) && cached.version === 1 && typeof cached.fetchedAt === 'string') {
      const age = Date.now() - Date.parse(cached.fetchedAt);
      if (age >= 0 && age < ttl * 1000) {
        try {
          return { ...normalizeCalendar(cached.user, username, range), source: 'cache', fetchedAt: cached.fetchedAt, range };
        } catch { /* Corrupt calendars are refetched and replaced. */ }
      }
    }
  }
  const user = await fetchUser(username, token, range);
  const calendar = normalizeCalendar(user, username, range);
  const fetchedAt = new Date().toISOString();
  if (cacheFile && cacheDirectory) {
    await mkdir(cacheDirectory, { recursive: true });
    const temporaryFile = `${cacheFile}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryFile, JSON.stringify({ version: 1, fetchedAt, user }) + '\n', { mode: 0o600 });
      await rename(temporaryFile, cacheFile);
    } finally {
      await rm(temporaryFile, { force: true });
    }
  }
  return { ...calendar, source: 'github', fetchedAt, range };
}
