import { initialBoxes, key, seededRandom } from './map.ts';
import { escapePath, reachable } from './pathfinding.ts';
import { blast } from './bomb.ts';
import type { Arena, GameConfig, GameEvent, Position, Replay } from './types.ts';

export const DEFAULT_CONFIG: GameConfig = {
  mode: 'clear',
  seed: 42, maxBombs: 5, explosionRange: 3, stepDuration: 0.15,
  fuse: 1.5, safetyMargin: 0.3, blastDuration: 0.48, maxDuration: 22,
};

export function simulate(arena: Arena, options: Partial<GameConfig> = {}): Replay {
  const config = { ...DEFAULT_CONFIG, ...options };
  if (!['clear', 'preview'].includes(config.mode) || !Number.isSafeInteger(config.seed) || !Number.isInteger(config.maxBombs) ||
      config.maxBombs < 0 || config.maxBombs > 20 ||
      !Number.isInteger(config.explosionRange) || config.explosionRange < 1 || config.explosionRange > 10 ||
      ![config.stepDuration, config.fuse, config.blastDuration, config.maxDuration].every(n => Number.isFinite(n) && n > 0) ||
      !Number.isFinite(config.safetyMargin) || config.safetyMargin < 0 ||
      config.maxDuration < 8 || config.maxDuration > 60) {
    throw new Error('Invalid simulation configuration. Preview duration must be 8–60 seconds.');
  }
  const boxes = initialBoxes(arena);
  const totalBoxes = boxes.size;
  const random = seededRandom(config.seed);
  // An edge spawn never overwrites a contribution, including a completely full map.
  const start = { x: Math.min(5, arena.width - 1), y: -1 };
  let player: Position = start;
  let time = 1.2;
  let bombCount = 0;
  const events: GameEvent[] = [];
  const gameDeadline = config.mode === 'clear' ? Infinity : config.maxDuration - 4.3;
  // Every successful bomb removes at least one box, so full clearing is finite.
  const bombLimit = config.mode === 'clear' ? totalBoxes : config.maxBombs;
  const maxEscapeSteps = Math.max(0, Math.ceil((config.fuse - config.safetyMargin) / config.stepDuration) - 1);

  function walk(path: Position[]): void {
    for (const destination of path) {
      events.push({ type: 'move', time, duration: config.stepDuration, from: player, to: destination });
      player = destination;
      time += config.stepDuration;
    }
  }

  for (let id = 0; id < bombLimit && boxes.size > 0; id++) {
    const destinations = reachable(arena, player, boxes);
    let best: { position: Position; approach: Position[]; escape: Position[]; score: number; impact: ReturnType<typeof blast> } | undefined;
    for (const position of destinations.positions) {
      const impact = blast(arena, position, boxes, config.explosionRange);
      if (!impact.destroyed.length) continue;
      const approach = destinations.pathTo(position)!;
      if (time + approach.length * config.stepDuration + config.fuse + config.blastDuration > gameDeadline) continue;
      // Even a one-step escape cannot beat this upper bound. Skip costly BFS.
      if (best && 3 * impact.destroyed.length - approach.length - 2 + 0.01 < best.score) continue;
      const hazard = new Set(impact.cells.map(key));
      const blocked = new Set([...boxes, key(position)]);
      const escape = escapePath(arena, position, blocked, hazard, maxEscapeSteps);
      if (!escape) continue;
      if (escape.length * config.stepDuration + config.safetyMargin >= config.fuse) continue;
      const score = 3 * impact.destroyed.length - approach.length - 2 * escape.length + random() * 0.01;
      if (!best || score > best.score) best = { position, approach, escape, score, impact };
    }
    if (!best) break;
    walk(best.approach);
    const bombTime = time;
    events.push({ type: 'bomb', id, time, position: player, fuse: config.fuse });
    walk(best.escape);
    time = bombTime + config.fuse;
    events.push({ type: 'explode', id, time, position: best.position, duration: config.blastDuration, ...best.impact });
    for (const cell of best.impact.destroyed) boxes.delete(key(cell));
    time += config.blastDuration + 0.28;
    bombCount++;
  }

  if (config.mode === 'clear' && boxes.size > 0) {
    throw new Error(`Cannot safely clear ${boxes.size} remaining boxes with this fuse, speed and blast range. Increase the fuse or use preview mode.`);
  }

  if (bombCount === 0) {
    // Empty calendars get a short honest patrol, without invented contributions.
    const map = reachable(arena, player, boxes);
    const destination = map.positions.find(p => p.x === Math.min(start.x + 8, arena.width) && p.y === -1);
    if (destination) {
      const availableSteps = Math.max(0, Math.floor((config.maxDuration - 4.3 - time) / config.stepDuration));
      walk(map.pathTo(destination)!.slice(0, availableSteps));
    }
  }
  const resultTime = Math.max(time + 0.2, 3.2);
  const duration = config.mode === 'clear'
    ? Math.max(8, resultTime + 4.1)
    : Math.min(config.maxDuration, Math.max(8, resultTime + 4.1));
  const restoreTime = duration - 2.6;
  for (let column = 0; column < arena.width; column++) {
    const cells = arena.tiles.filter(tile => tile.x === column && tile.count > 0 && !boxes.has(key(tile)));
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
