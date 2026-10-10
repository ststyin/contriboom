import { seededRandom } from '../engine/map.ts';
import type { Contribution, Level } from '../engine/types.ts';

export type Fixture = 'demo' | 'empty' | 'full' | 'sparse';

/** Fixed dates keep this fixture independent of the machine clock. Column-major. */
export function mockContributions(seed = 42, fixture: Fixture = 'demo'): Contribution[] {
  const random = seededRandom(seed);
  const start = Date.UTC(2025, 9, 5);
  return Array.from({ length: 53 * 7 }, (_, index) => {
    const x = Math.floor(index / 7);
    const y = index % 7;
    const probability = fixture === 'sparse' ? 0.06 : 0.57 + 0.17 * Math.sin(x / 5);
    // Organic clusters, with no artificial corridors inside the calendar.
    const occupied = fixture === 'full' ||
      (fixture !== 'empty' && random() < probability * (y === 0 || y === 6 ? 0.8 : 1));
    const level = (occupied ? 1 + Math.floor(random() * 4) : 0) as Level;
    const count = level ? level * 3 + Math.floor(random() * 5) : 0;
    return { date: new Date(start + index * 86400000).toISOString().slice(0, 10), count, level };
  });
}
