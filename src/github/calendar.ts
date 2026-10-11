import type { Contribution, Level } from '../engine/types.ts';

const DAY = 86_400_000;
const LEVELS: Record<string, Level> = {
  NONE: 0, FIRST_QUARTILE: 1, SECOND_QUARTILE: 2, THIRD_QUARTILE: 3, FOURTH_QUARTILE: 4,
};

export interface CalendarRange {
  from: string;
  to: string;
  endDate: string;
}

export interface GitHubCalendar {
  login: string;
  contributions: Contribution[];
  width: number;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid GitHub contribution calendar.');
  return value as Record<string, unknown>;
}

function dateTime(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Invalid GitHub contribution date.');
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) throw new Error('Invalid GitHub contribution date.');
  return time;
}

export function calendarRange(year: number | undefined, now: Date): CalendarRange {
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid current date.');
  const currentYear = now.getUTCFullYear();
  if (year !== undefined && (!Number.isInteger(year) || year < 2008 || year > currentYear)) {
    throw new Error(`Year must be between 2008 and ${currentYear}.`);
  }
  const today = Date.UTC(currentYear, now.getUTCMonth(), now.getUTCDate());
  // Both calendar endpoints are inclusive; keep the rolling window at 365 days.
  const from = year === undefined
    ? today - 364 * DAY
    : Date.UTC(year, 0, 1);
  const end = year === undefined ? today : Date.UTC(year, 11, 31);
  const to = Math.min(end, today);
  return {
    from: new Date(from).toISOString(),
    to: new Date(to + DAY - 1).toISOString(),
    endDate: new Date(end).toISOString().slice(0, 10),
  };
}

/** Keep GitHub's counts and levels; pad only the dates outside the queried period. */
export function normalizeCalendar(value: unknown, username: string, range: CalendarRange): GitHubCalendar {
  const user = record(value);
  if (typeof user.login !== 'string' || user.login.toLowerCase() !== username.toLowerCase()) {
    throw new Error('GitHub returned a different account.');
  }
  const calendar = record(record(user.contributionsCollection).contributionCalendar);
  if (!Array.isArray(calendar.weeks) || calendar.weeks.length === 0 || calendar.weeks.length > 54) {
    throw new Error('Invalid GitHub contribution weeks.');
  }
  const from = dateTime(range.from.slice(0, 10));
  const to = dateTime(range.to.slice(0, 10));
  const end = dateTime(range.endDate);
  const first = from - new Date(from).getUTCDay() * DAY;
  const last = end + (6 - new Date(end).getUTCDay()) * DAY;
  const width = (last - first + DAY) / (7 * DAY);
  if (!Number.isInteger(width) || width < 1 || width > 54 || from > to || to > end) {
    throw new Error('Invalid GitHub contribution range.');
  }
  const days = new Map<number, Contribution>();
  for (const weekValue of calendar.weeks) {
    const week = record(weekValue);
    const firstDay = dateTime(week.firstDay);
    const weekStart = firstDay - new Date(firstDay).getUTCDay() * DAY;
    if (!Array.isArray(week.contributionDays) ||
        week.contributionDays.length < 1 || week.contributionDays.length > 7) {
      throw new Error('Invalid GitHub contribution week.');
    }
    let earliest = Infinity;
    for (const dayValue of week.contributionDays) {
      const day = record(dayValue);
      const time = dateTime(day.date);
      earliest = Math.min(earliest, time);
      const count = day.contributionCount;
      const level = typeof day.contributionLevel === 'string' && Object.hasOwn(LEVELS, day.contributionLevel)
        ? LEVELS[day.contributionLevel] : undefined;
      if (time < from || time > to || time < weekStart || time >= weekStart + 7 * DAY || days.has(time) ||
          day.weekday !== new Date(time).getUTCDay() ||
          typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0 ||
          level === undefined || (count === 0) !== (level === 0)) {
        throw new Error('Invalid GitHub contribution day.');
      }
      days.set(time, { date: day.date as string, count, level });
    }
    if (firstDay !== earliest) throw new Error('Invalid GitHub contribution week boundary.');
  }
  if (days.size !== (to - from) / DAY + 1) throw new Error('GitHub returned an incomplete contribution calendar.');
  if (typeof calendar.totalContributions !== 'number' ||
      calendar.totalContributions !== [...days.values()].reduce((total, day) => total + day.count, 0)) {
    throw new Error('GitHub contribution totals do not match the calendar.');
  }
  return {
    login: user.login,
    width,
    contributions: Array.from({ length: width * 7 }, (_, index) => {
      const time = first + index * DAY;
      return days.get(time) ?? { date: new Date(time).toISOString().slice(0, 10), count: 0, level: 0 };
    }),
  };
}
