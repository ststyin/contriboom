import type { Arena, Contribution, Position } from './types.ts';

export const key = ({ x, y }: Position): string => `${x},${y}`;
export const same = (a: Position, b: Position): boolean => a.x === b.x && a.y === b.y;

/** One traversable ring surrounds the unmodified contribution calendar. */
export function inside(arena: Arena, p: Position): boolean {
  return p.x >= -1 && p.x <= arena.width && p.y >= -1 && p.y <= arena.height;
}

export function createArena(data: readonly Contribution[], width = 53): Arena {
  if (!Number.isInteger(width) || width < 1 || width > 53 || data.length !== width * 7) {
    throw new Error('Expected exactly width × 7 contribution days (width 1–53).');
  }
  const dates = new Set<string>();
  const tiles = data.map((day, index) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day.date) ||
        !Number.isFinite(Date.parse(day.date)) ||
        new Date(day.date).toISOString().slice(0, 10) !== day.date || dates.has(day.date) ||
        (index > 0 && Date.parse(day.date) !== Date.parse(data[index - 1]!.date) + 86400000) ||
        !Number.isSafeInteger(day.count) || day.count < 0 ||
        !Number.isInteger(day.level) || day.level < 0 || day.level > 4 ||
        (day.count === 0) !== (day.level === 0)) {
      throw new Error(`Invalid contribution day at index ${index}.`);
    }
    dates.add(day.date);
    return { ...day, x: Math.floor(index / 7), y: index % 7 };
  });
  return { width, height: 7, tiles };
}

export function initialBoxes(arena: Arena): Set<string> {
  return new Set(arena.tiles.filter(tile => tile.count > 0).map(key));
}

export function neighbors(p: Position): Position[] {
  return [
    { x: p.x + 1, y: p.y }, { x: p.x, y: p.y - 1 },
    { x: p.x, y: p.y + 1 }, { x: p.x - 1, y: p.y },
  ];
}

export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
