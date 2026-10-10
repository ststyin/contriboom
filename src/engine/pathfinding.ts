import { inside, key, neighbors, same } from './map.ts';
import type { Arena, Position } from './types.ts';

export interface Reachable {
  positions: Position[];
  pathTo: (destination: Position) => Position[] | undefined;
}

/** Paths exclude the starting cell. A bomb origin may be exited but never re-entered. */
export function reachable(arena: Arena, start: Position, blocked: ReadonlySet<string>): Reachable {
  const queue: Position[] = [start];
  const parents = new Map<string, Position | null>([[key(start), null]]);
  for (let index = 0; index < queue.length; index++) {
    for (const next of neighbors(queue[index]!)) {
      const id = key(next);
      if (!inside(arena, next) || blocked.has(id) || parents.has(id)) continue;
      parents.set(id, queue[index]!);
      queue.push(next);
    }
  }
  return {
    positions: queue,
    pathTo(destination) {
      if (!parents.has(key(destination))) return undefined;
      const path: Position[] = [];
      let cursor = destination;
      while (!same(cursor, start)) {
        path.push(cursor);
        cursor = parents.get(key(cursor))!;
      }
      return path.reverse();
    },
  };
}

/** Stop BFS as soon as a safe cell is found, rather than traversing the whole arena. */
export function escapePath(
  arena: Arena, start: Position, blocked: ReadonlySet<string>,
  hazard: ReadonlySet<string>, maxSteps: number,
): Position[] | undefined {
  const queue = [{ position: start, depth: 0 }];
  const parents = new Map<string, Position | null>([[key(start), null]]);
  for (let index = 0; index < queue.length; index++) {
    const { position, depth } = queue[index]!;
    if (!hazard.has(key(position))) {
      const path: Position[] = [];
      let cursor = position;
      while (!same(cursor, start)) {
        path.push(cursor);
        cursor = parents.get(key(cursor))!;
      }
      return path.reverse();
    }
    if (depth >= maxSteps) continue;
    for (const next of neighbors(position)) {
      const id = key(next);
      if (!inside(arena, next) || blocked.has(id) || parents.has(id)) continue;
      parents.set(id, position);
      queue.push({ position: next, depth: depth + 1 });
    }
  }
  return undefined;
}
