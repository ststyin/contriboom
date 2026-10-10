import { inside, key } from './map.ts';
import type { Arena, Position } from './types.ts';

export function blast(arena: Arena, position: Position, boxes: ReadonlySet<string>, range: number): {
  cells: Position[]; destroyed: Position[];
} {
  if (!inside(arena, position) || boxes.has(key(position))) throw new Error('A bomb must be placed on an empty cell inside the contribution grid.');
  const cells: Position[] = [position];
  const destroyed: Position[] = [];
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    for (let distance = 1; distance <= range; distance++) {
      const cell = { x: position.x + dx! * distance, y: position.y + dy! * distance };
      if (!inside(arena, cell)) break;
      cells.push(cell);
      if (boxes.has(key(cell))) {
        destroyed.push(cell);
        break;
      }
    }
  }
  return { cells, destroyed };
}
