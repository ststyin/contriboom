import { initialBoxes, key, seededRandom } from './map.ts';
import { escapePath, reachable } from './pathfinding.ts';
import { blast } from './bomb.ts';
import type { Arena, GameConfig, GameEvent, Level, Position, Replay } from './types.ts';

export const DEFAULT_CONFIG: GameConfig = {
  mode: 'clear',
  seed: 42, maxBombs: 5, explosionRange: 3, blockDamage: 'instant', stepDuration: 0.15,
  fuse: 1.5, safetyMargin: 0.3, blastDuration: 0.48, maxDuration: 22,
};

export function simulate(arena: Arena, options: Partial<GameConfig> = {}): Replay {
  const config = { ...DEFAULT_CONFIG, ...options };
  if (!['clear', 'preview'].includes(config.mode) || !Number.isSafeInteger(config.seed) || !Number.isInteger(config.maxBombs) ||
      !['instant', 'fade'].includes(config.blockDamage) ||
      config.maxBombs < 0 || config.maxBombs > 20 ||
      !Number.isInteger(config.explosionRange) || config.explosionRange < 1 || config.explosionRange > 10 ||
      ![config.stepDuration, config.fuse, config.blastDuration, config.maxDuration].every(n => Number.isFinite(n) && n > 0) ||
      !Number.isFinite(config.safetyMargin) || config.safetyMargin < 0 ||
      config.maxDuration < 8 || config.maxDuration > 60) {
    throw new Error('Invalid simulation configuration. Preview duration must be 8–60 seconds.');
  }
  const boxes = initialBoxes(arena);
  const levels = new Map(arena.tiles.filter(tile => tile.count > 0).map(tile => [key(tile), tile.level]));
  const totalBoxes = boxes.size;
  const random = seededRandom(config.seed);
  // Spawn in the largest connected area of empty cells, without clearing data.
  const visited = new Set<string>();
  let largest: Position[] = [];
  for (const tile of arena.tiles) {
    if (boxes.has(key(tile)) || visited.has(key(tile))) continue;
    const component = reachable(arena, tile, boxes).positions;
    for (const cell of component) visited.add(key(cell));
    if (component.length > largest.length) largest = component;
  }
  const preferred = { x: Math.min(5, arena.width - 1), y: Math.floor(arena.height / 2) };
  const start = largest.reduce<Position | null>((best, cell) => {
    const distance = (p: Position): number => Math.abs(p.x - preferred.x) + Math.abs(p.y - preferred.y);
    return !best || distance(cell) < distance(best) ? { x: cell.x, y: cell.y } : best;
  }, null);
  let player: Position | null = start;
  let time = 1.2;
  let bombCount = 0;
  const events: GameEvent[] = [];
  const gameDeadline = config.mode === 'clear' ? Infinity : config.maxDuration - 4.3;
  // Every successful bomb reduces at least one block's remaining durability.
  const durability = config.blockDamage === 'fade' ? [...levels.values()].reduce<number>((sum, level) => sum + level, 0) : totalBoxes;
  const bombLimit = config.mode === 'clear' ? durability : config.maxBombs;
  const maxEscapeSteps = Math.max(0, Math.ceil((config.fuse - config.safetyMargin) / config.stepDuration) - 1);

  function walk(path: Position[]): void {
    if (!player) throw new Error('Cannot move without an empty spawn cell.');
    for (const destination of path) {
      events.push({ type: 'move', time, duration: config.stepDuration, from: player, to: destination });
      player = destination;
      time += config.stepDuration;
    }
  }

  for (let id = 0; id < bombLimit && boxes.size > 0 && player; id++) {
    const destinations = reachable(arena, player, boxes);
    let best: { position: Position; approach: Position[]; escape: Position[]; score: number; impact: ReturnType<typeof blast> } | undefined;
    for (const position of destinations.positions) {
      const impact = blast(arena, position, boxes, config.explosionRange);
      if (!impact.hits.length) continue;
      const approach = destinations.pathTo(position)!;
      if (time + approach.length * config.stepDuration + config.fuse + config.blastDuration > gameDeadline) continue;
      // Even a one-step escape cannot beat this upper bound. Skip costly BFS.
      if (best && 3 * impact.hits.length - approach.length - 2 + 0.01 < best.score) continue;
      const hazard = new Set(impact.cells.map(key));
      const blocked = new Set([...boxes, key(position)]);
      const escape = escapePath(arena, position, blocked, hazard, maxEscapeSteps);
      if (!escape) continue;
      if (escape.length * config.stepDuration + config.safetyMargin >= config.fuse) continue;
      const score = 3 * impact.hits.length - approach.length - 2 * escape.length + random() * 0.01;
      if (!best || score > best.score) best = { position, approach, escape, score, impact };
    }
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
    if (patrol.length) {
      const availableSteps = Math.max(0, Math.floor((config.maxDuration - 4.3 - time) / config.stepDuration));
      walk(patrol.slice(0, availableSteps));
    }
  }
  const resultTime = Math.max(time + 0.2, 3.2);
  const duration = config.mode === 'clear'
    ? Math.max(8, resultTime + 4.1)
    : Math.min(config.maxDuration, Math.max(8, resultTime + 4.1));
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
