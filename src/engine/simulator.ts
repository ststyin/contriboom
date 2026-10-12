import { initialBoxes, key, seededRandom } from './map.ts';
import { escapePath, reachable } from './pathfinding.ts';
import { blast } from './bomb.ts';
import { DEFAULT_RANGE, RANGE_LIMIT } from './range.ts';
import type { Arena, GameConfig, GameEvent, Level, Position, Replay } from './types.ts';

export const DEFAULT_CONFIG: GameConfig = {
  mode: 'clear',
  seed: 42, maxBombs: 5, explosionRange: DEFAULT_RANGE, blockDamage: 'fade', stepDuration: 0.15,
  fuse: 1.5, safetyMargin: 0.3, blastDuration: 0.48,
};

export function simulate(arena: Arena, options: Partial<GameConfig> = {}): Replay {
  const config = { ...DEFAULT_CONFIG, ...options };
  if (!['clear', 'preview'].includes(config.mode) || !Number.isSafeInteger(config.seed) || !Number.isInteger(config.maxBombs) ||
      !['instant', 'fade'].includes(config.blockDamage) ||
      config.maxBombs < 0 || config.maxBombs > 20 ||
      !Number.isInteger(config.explosionRange) || config.explosionRange < 1 || config.explosionRange > RANGE_LIMIT ||
      ![config.stepDuration, config.fuse, config.blastDuration].every(n => Number.isFinite(n) && n > 0) ||
      !Number.isFinite(config.safetyMargin) || config.safetyMargin < 0) {
    throw new Error('Invalid simulation configuration.');
  }
  const boxes = initialBoxes(arena);
  const levels = new Map(arena.tiles.filter(tile => tile.count > 0).map(tile => [key(tile), tile.level]));
  const totalBoxes = boxes.size;
  const random = seededRandom(config.seed);
  const events: GameEvent[] = [];
  const maxEscapeSteps = Math.max(0, Math.ceil((config.fuse - config.safetyMargin) / config.stepDuration) - 1);

  function planBomb(origin: Position, randomize = true) {
    const destinations = reachable(arena, origin, boxes);
    let best: { position: Position; approach: Position[]; escape: Position[]; score: number; impact: ReturnType<typeof blast> } | undefined;
    for (const position of destinations.positions) {
      const impact = blast(arena, position, boxes, config.explosionRange);
      if (!impact.hits.length) continue;
      const approach = destinations.pathTo(position)!;
      // Even a one-step escape cannot beat this upper bound. Skip costly BFS.
      if (best && 3 * impact.hits.length - approach.length - 2 + 0.01 < best.score) continue;
      const hazard = new Set(impact.cells.map(key));
      const blocked = new Set([...boxes, key(position)]);
      const escape = escapePath(arena, position, blocked, hazard, maxEscapeSteps);
      if (!escape || escape.length * config.stepDuration + config.safetyMargin >= config.fuse) continue;
      if (!randomize) return { position, approach, escape, score: 0, impact };
      const score = 3 * impact.hits.length - approach.length - 2 * escape.length + random() * 0.01;
      if (!best || score > best.score) best = { position, approach, escape, score, impact };
    }
    return best;
  }

  // Prefer the largest empty component that permits safe bomb placement.
  const visited = new Set<string>();
  const components: Position[][] = [];
  for (const tile of arena.tiles) {
    if (boxes.has(key(tile)) || visited.has(key(tile))) continue;
    const component = reachable(arena, tile, boxes).positions;
    for (const cell of component) visited.add(key(cell));
    components.push(component);
  }
  const preferred = { x: Math.min(5, arena.width - 1), y: Math.floor(arena.height / 2) };
  const distance = (p: Position): number => Math.abs(p.x - preferred.x) + Math.abs(p.y - preferred.y);
  let start: Position | null = null;
  for (const component of components.sort((a, b) => b.length - a.length)) {
    const candidate = component.reduce((best, cell) => distance(cell) < distance(best) ? cell : best);
    // A probe must not advance the random sequence of an existing replay.
    if (!boxes.size || (config.mode === 'preview' && config.maxBombs === 0) || planBomb(candidate, false)) {
      start = { x: candidate.x, y: candidate.y };
      break;
    }
  }
  if (!start && boxes.size) {
    // A 2 x 2 entry provides a diagonal escape outside a cross-shaped blast.
    // Single-row/column inputs have no diagonal; open their entire strip instead.
    const entryWidth = arena.height === 1 ? arena.width : Math.min(2, arena.width);
    const entryHeight = arena.width === 1 ? arena.height : Math.min(2, arena.height);
    let region: { position: Position; cells: Position[]; cleared: Position[] } | undefined;
    for (let x = 0; x <= arena.width - entryWidth; x++) {
      for (let y = 0; y <= arena.height - entryHeight; y++) {
        const cells = Array.from({ length: entryWidth * entryHeight }, (_, i) => ({
          x: x + Math.floor(i / entryHeight), y: y + i % entryHeight,
        }));
        const cleared = cells.filter(cell => boxes.has(key(cell)));
        const position = { x, y };
        if (!region || cleared.length < region.cleared.length ||
            (cleared.length === region.cleared.length && distance(position) < distance(region.position))) {
          region = { position, cells, cleared };
        }
      }
    }
    if (region) {
      for (const cell of region.cleared) {
        boxes.delete(key(cell));
        levels.set(key(cell), 0);
      }
      start = region.position;
      events.push({ type: 'entry', time: 0.4, duration: 0.6, ...region });
    }
  }
  let player: Position | null = start;
  let time = 1.2;
  let bombCount = 0;
  // Every successful bomb reduces at least one block's remaining durability.
  const durability = config.blockDamage === 'fade' ? [...levels.values()].reduce<number>((sum, level) => sum + level, 0) : totalBoxes;
  const bombLimit = config.mode === 'clear' ? durability : config.maxBombs;

  function walk(path: Position[]): void {
    if (!player) throw new Error('Cannot move without an empty spawn cell.');
    for (const destination of path) {
      events.push({ type: 'move', time, duration: config.stepDuration, from: player, to: destination });
      player = destination;
      time += config.stepDuration;
    }
  }

  for (let id = 0; id < bombLimit && boxes.size > 0 && player; id++) {
    const best = planBomb(player);
    if (!best) break;
    walk(best.approach);
    const bombTime = time;
    events.push({ type: 'bomb', id, time, position: player, fuse: config.fuse });
    walk(best.escape);
    time = bombTime + config.fuse;
    const damaged = best.impact.hits.map(position => {
      const fromLevel = levels.get(key(position))!;
      const toLevel = (config.blockDamage === 'fade' ? fromLevel - 1 : 0) as Level;
      levels.set(key(position), toLevel);
      if (toLevel === 0) boxes.delete(key(position));
      return { position, fromLevel, toLevel };
    });
    const destroyed = damaged.filter(hit => hit.toLevel === 0).map(hit => hit.position);
    events.push({ type: 'explode', id, time, position: best.position, duration: config.blastDuration, cells: best.impact.cells, damaged, destroyed });
    time += config.blastDuration + 0.28;
    bombCount++;
  }

  if (config.mode === 'clear' && boxes.size > 0) {
    throw new Error(`Cannot safely clear ${boxes.size} remaining boxes with this fuse, speed and blast range. Increase the fuse or use preview mode.`);
  }

  if (bombCount === 0 && start && player) {
    // Empty calendars get a short honest patrol, without invented contributions.
    const map = reachable(arena, player, boxes);
    const patrol = map.positions.reduce<Position[]>((longest, position) => {
      const route = map.pathTo(position)!;
      return route.length > longest.length ? route : longest;
    }, []);
    walk(patrol);
  }
  const resultTime = Math.max(time + 0.2, 3.2);
  const duration = Math.max(8, resultTime + 4.1);
  const restoreTime = duration - 2.6;
  for (let column = 0; column < arena.width; column++) {
    const cells = arena.tiles.filter(tile => tile.x === column && tile.count > 0 && levels.get(key(tile)) !== tile.level);
    if (cells.length) events.push({ type: 'restore', column, time: restoreTime + column / Math.max(1, arena.width - 1) * 1.6, cells });
  }
  return {
    arena, config, start, events, duration, resultTime, restoreTime,
    stats: {
      bombs: bombCount, destroyed: totalBoxes - boxes.size, totalBoxes, remaining: boxes.size,
      contributions: arena.tiles.reduce((sum, tile) => sum + tile.count, 0),
    },
  };
}
