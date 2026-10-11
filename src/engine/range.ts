import type { Contribution } from './types.ts';

const DAY = 86_400_000;
export const RANGE_MODES = ['fixed', 'previous-day', 'previous-week', 'previous-month'] as const;
export type RangeMode = typeof RANGE_MODES[number];
export const DEFAULT_RANGE_MAX = 6;
export const RANGE_LIMIT = 10;

export interface RangeOptions {
  mode: RangeMode;
  fixedRange: number;
  maxRange: number;
  referenceDate?: string;
}
export interface RangeCalculation {
  mode: RangeMode;
  range: number;
  maxRange: number;
  referenceDate?: string;
  from?: string;
  to?: string;
  average?: number;
}

export function validateRangeOptions(options: RangeOptions): void {
  if (!(RANGE_MODES as readonly string[]).includes(options.mode)) throw new Error(`Unknown range-mode. Choose ${RANGE_MODES.join(', ')}.`);
  if (!Number.isInteger(options.fixedRange) || options.fixedRange < 1 || options.fixedRange > RANGE_LIMIT) throw new Error('range must be an integer from 1 to 10.');
  if (!Number.isInteger(options.maxRange) || options.maxRange < 1 || options.maxRange > RANGE_LIMIT) throw new Error('range-max must be an integer from 1 to 10.');
}

/** Exclude the reference day: its contributions might still be accumulating. */
export function resolveExplosionRange(days: readonly Contribution[], options: RangeOptions): RangeCalculation {
  validateRangeOptions(options);
  const result: RangeCalculation = { mode: options.mode, range: Math.min(options.fixedRange, options.maxRange), maxRange: options.maxRange };
  if (options.mode === 'fixed') return result;
  const referenceDate = options.referenceDate ?? days.at(-1)?.date;
  const reference = referenceDate === undefined ? NaN : Date.parse(referenceDate);
  if (!Number.isFinite(reference) || !/^\d{4}-\d{2}-\d{2}$/.test(referenceDate!) || new Date(reference).toISOString().slice(0, 10) !== referenceDate) {
    throw new Error('Adaptive range requires a valid reference date.');
  }
  const length = options.mode === 'previous-day' ? 1 : options.mode === 'previous-week' ? 7 : 30;
  const counts = new Map(days.map(day => [day.date, day.count]));
  let total = 0;
  for (let offset = 1; offset <= length; offset++) total += counts.get(new Date(reference - offset * DAY).toISOString().slice(0, 10)) ?? 0;
  const average = total / length;
  return {
    ...result, range: Math.max(1, Math.min(options.maxRange, Math.ceil(average))), referenceDate,
    from: new Date(reference - length * DAY).toISOString().slice(0, 10),
    to: new Date(reference - DAY).toISOString().slice(0, 10), average,
  };
}
