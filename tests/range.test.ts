import { describe, expect, it } from 'vitest';
import { resolveExplosionRange, validateRangeOptions } from '../src/engine/range.ts';
import type { RangeOptions } from '../src/engine/range.ts';
import type { Contribution } from '../src/engine/types.ts';

const DAY = 86_400_000;
const defaults: RangeOptions = { mode: 'fixed', fixedRange: 3, maxRange: 6 };
function calendar(reference: string, counts: Record<string, number> = {}): Contribution[] {
  return Array.from({ length: 35 }, (_, index) => {
    const date = new Date(Date.parse(reference) - (34 - index) * DAY).toISOString().slice(0, 10);
    const count = counts[date] ?? 0;
    return { date, count, level: count ? 1 : 0 };
  });
}

describe('explosion range selection', () => {
  it('keeps fixed values predictable and applies the configurable cap', () => {
    expect(resolveExplosionRange([], defaults)).toEqual({ mode: 'fixed', range: 3, maxRange: 6 });
    expect(resolveExplosionRange([], { ...defaults, fixedRange: 10 }).range).toBe(6);
    expect(resolveExplosionRange([], { ...defaults, fixedRange: 10, maxRange: 10 }).range).toBe(10);
    expect(resolveExplosionRange([], { ...defaults, maxRange: 1 }).range).toBe(1);
  });
  it('uses yesterday rather than today or padded future calendar days', () => {
    const days = calendar('2024-03-03', { '2024-02-29': 4, '2024-03-01': 100, '2024-03-02': 200 });
    expect(resolveExplosionRange(days, { ...defaults, mode: 'previous-day', referenceDate: '2024-03-01' })).toEqual({
      mode: 'previous-day', range: 4, maxRange: 6, average: 4, referenceDate: '2024-03-01', from: '2024-02-29', to: '2024-02-29',
    });
  });
  it('uses a full seven-day denominator, rounds up fractional averages, and excludes older days', () => {
    const days = calendar('2024-03-01', { '2024-02-22': 100, '2024-02-23': 3, '2024-02-29': 7, '2024-03-01': 100 });
    const result = resolveExplosionRange(days, { ...defaults, mode: 'previous-week' });
    expect(result).toMatchObject({ range: 2, average: 10 / 7, from: '2024-02-23', to: '2024-02-29' });
  });
  it('uses the previous 30 days across leap February rather than a calendar month', () => {
    const days = calendar('2024-03-01', { '2024-01-30': 100, '2024-01-31': 30, '2024-02-29': 31, '2024-03-01': 200 });
    expect(resolveExplosionRange(days, { ...defaults, mode: 'previous-month' })).toMatchObject({ range: 3, average: 61 / 30, from: '2024-01-31', to: '2024-02-29' });
  });
  it('keeps zero or missing activity at one cell and caps heavy activity', () => {
    expect(resolveExplosionRange([], { ...defaults, mode: 'previous-week', referenceDate: '2024-03-01' }).range).toBe(1);
    const days = calendar('2024-03-01', { '2024-02-29': 10000 });
    expect(resolveExplosionRange(days, { ...defaults, mode: 'previous-day' }).range).toBe(6);
    expect(resolveExplosionRange(days, { ...defaults, mode: 'previous-day', maxRange: 3 }).range).toBe(3);
  });
  it('rejects unknown modes, invalid limits, and impossible reference dates', () => {
    for (const options of [
      { ...defaults, mode: 'unknown' }, { ...defaults, fixedRange: 0 }, { ...defaults, fixedRange: 11 },
      { ...defaults, maxRange: 0 }, { ...defaults, maxRange: 11 }, { ...defaults, maxRange: 2.5 },
    ]) expect(() => validateRangeOptions(options as RangeOptions)).toThrow();
    for (const referenceDate of ['2024-02-30', 'invalid', '2024-03-01T12:00:00Z']) {
      expect(() => resolveExplosionRange([], { ...defaults, mode: 'previous-day', referenceDate })).toThrow('valid reference date');
    }
  });
});
