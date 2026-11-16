import { describe, expect, it } from 'vitest';
import { blast } from '../src/engine/bomb.ts';
import { createArena, key, seededRandom } from '../src/engine/map.ts';
import { escapePath, reachable } from '../src/engine/pathfinding.ts';
import { simulate } from '../src/engine/simulator.ts';
import { mockContributions } from '../src/fixtures/contributions.ts';
import type { Arena, Level, Replay } from '../src/engine/types.ts';

function calendar(width: number, blocks: readonly (readonly [number, number, Level])[]) {
  const data = mockContributions(42, 'empty').slice(0, width * 7);
  for (const [x, y, level] of blocks) data[x * 7 + y] = { ...data[x * 7 + y]!, count: level * 3, level };
  return createArena(data, width);
}

/** Exhaust board/player states without the production planner's position merging,
 * hit-set deduplication, heuristic or greedy bound. */
function exhaustiveMinimum(arena: Arena, replay: Replay): number {
  const { config, start } = replay;
  const entry = replay.events.find(event => event.type === 'entry');
  const opened = new Set(entry?.cleared.map(key));
  const blocks = arena.tiles.filter(tile => tile.count > 0 && !opened.has(key(tile)));
  const indices = new Map(blocks.map((tile, i) => [key(tile), i]));
  const initial: number[] = blocks.map(tile => config.blockDamage === 'instant' ? 1 : tile.level);
  const queue = [{ levels: initial, bombs: 0, player: start! }];
  const seen = new Set([`${initial.join('')}@${key(start!)}`]);
  for (let index = 0; index < queue.length; index++) {
    const { levels, bombs, player } = queue[index]!;
    const boxes = new Set(blocks.filter((_, i) => levels[i]! > 0).map(key));
    if (!boxes.size) return bombs;
    for (const position of reachable(arena, player, boxes).positions) {
      const impact = blast(arena, position, boxes, config.explosionRange);
      if (!impact.hits.length) continue;
      const hazard = new Set(impact.cells.map(key));
      const blocked = new Set([...boxes, key(position)]);
      const escape = escapePath(arena, position, blocked, hazard, arena.tiles.length);
      if (!escape || escape.length * config.stepDuration + config.safetyMargin >= config.fuse) continue;
      const next = [...levels];
      for (const hit of impact.hits) {
        const hitIndex = indices.get(key(hit))!;
        next[hitIndex] = next[hitIndex]! - 1;
      }
      const nextPlayer = escape.at(-1)!;
      const id = `${next.join('')}@${key(nextPlayer)}`;
      if (seen.has(id)) continue;
      seen.add(id);
      queue.push({ levels: next, bombs: bombs + 1, player: nextPlayer });
    }
  }
  return Infinity;
}

describe('exact minimum bomb count', () => {
  it('matches independent exhaustive search across blocking layouts, ranges and durability rules', () => {
    const layouts: (readonly (readonly [number, number, Level])[])[] = [
      [[0, 0, 1], [2, 3, 1], [0, 6, 1]],
      [[0, 2, 2], [1, 2, 1], [2, 2, 2], [1, 5, 1]],
      [[0, 1, 1], [1, 0, 1], [1, 2, 2], [2, 1, 1], [1, 4, 1]],
    ];
    for (const blocks of layouts) for (const blockDamage of ['fade', 'instant'] as const) {
      for (const explosionRange of [1, 2, 4]) {
        const arena = calendar(3, blocks);
        const replay = simulate(arena, { planner: 'min-bombs', blockDamage, explosionRange });
        expect(replay.stats.remaining).toBe(0);
        expect(replay.stats.bombs).toBe(exhaustiveMinimum(arena, replay));
      }
    }
  }, 30000);

  it('matches exhaustive search on seeded layouts with custom escape timing', () => {
    for (let seed = 0; seed < 12; seed++) {
      const random = seededRandom(seed);
      const cells = new Set<number>();
      while (cells.size < 5) cells.add(Math.floor(random() * 21));
      const blocks = [...cells].map(id => [Math.floor(id / 7), id % 7, (1 + Math.floor(random() * 2)) as Level] as const);
      const arena = calendar(3, blocks);
      const replay = simulate(arena, {
        planner: 'min-bombs', seed, explosionRange: seed % 3 + 1,
        blockDamage: seed % 2 ? 'instant' : 'fade', stepDuration: 0.125, safetyMargin: 0.25, fuse: 0.75,
      });
      expect(replay.stats.bombs, `seed ${seed}`).toBe(exhaustiveMinimum(arena, replay));
    }
  }, 30000);

  it('can improve on greedy and produces a deterministic optimal replay', () => {
    const arena = calendar(8, [[1, 1, 1], [1, 3, 1]]);
    expect(simulate(arena).stats.bombs).toBe(2);
    const exact = simulate(arena, { planner: 'min-bombs' });
    expect(exact.stats.bombs).toBe(1);
    expect(simulate(arena, { planner: 'min-bombs' })).toEqual(exact);
  });

  it('fails at the state budget instead of returning an unproven greedy solution', () => {
    const arena = calendar(3, [[0, 0, 1], [2, 3, 1], [0, 6, 1]]);
    expect(simulate(arena, { explosionRange: 1 }).stats.bombs).toBe(3);
    expect(() => simulate(arena, { planner: 'min-bombs', explosionRange: 1, plannerSearchLimit: 1 }))
      .toThrow(/search limit.*before proving/);
    expect(simulate(arena, { planner: 'min-bombs', explosionRange: 1, plannerSearchLimit: 100 }).stats.bombs).toBe(3);
  });

  it('accepts a proven lower-bound solution even with a one-state budget', () => {
    const replay = simulate(calendar(8, [[1, 1, 4]]), { planner: 'min-bombs', plannerSearchLimit: 1 });
    expect(replay.stats.bombs).toBe(4);
  });

  it('rejects previews, invalid budgets and unsafely short fuses', () => {
    const arena = calendar(3, [[0, 0, 1], [2, 3, 1], [0, 6, 1]]);
    expect(() => simulate(arena, { planner: 'min-bombs', mode: 'preview', maxBombs: 0 })).toThrow(/requires mode clear/);
    for (const plannerSearchLimit of [0, -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => simulate(arena, { planner: 'min-bombs', plannerSearchLimit })).toThrow(/planner-search-limit/);
    }
    expect(() => simulate(arena, { planner: 'min-bombs', fuse: 0.1 })).toThrow(/Cannot safely clear/);
  });
});
