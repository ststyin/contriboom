import { key, seededRandom } from './map.ts';
import { balancedBomb, bombCandidates } from './planner.ts';
import type { BombPlan } from './planner.ts';
import type { Arena, GameConfig, Level, Position } from './types.ts';

interface Node {
  levels: Uint8Array;
  work: number;
  bombs: number;
  bound: number;
  order: number;
  player: Position;
  parent?: Node;
  plan?: BombPlan;
}

/** Admissible: one bomb hits at most four blocks and each block at most once. */
function lowerBound(levels: Uint8Array, work: number): number {
  let largest = 0;
  for (const level of levels) largest = Math.max(largest, level);
  return Math.max(largest, Math.ceil(work / 4));
}

function route(node: Node): BombPlan[] {
  const plans: BombPlan[] = [];
  for (let cursor = node; cursor.plan; cursor = cursor.parent!) plans.push(cursor.plan);
  return plans.reverse();
}

/** A deterministic min heap; ties prefer states with less remaining work. */
class Frontier {
  private nodes: Node[] = [];
  get first(): Node | undefined { return this.nodes[0]; }
  private before(a: Node, b: Node): boolean {
    return (a.bound - b.bound || a.work - b.work || a.order - b.order) < 0;
  }
  push(node: Node): void {
    let index = this.nodes.length;
    this.nodes.push(node);
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (!this.before(node, this.nodes[parent]!)) break;
      this.nodes[index] = this.nodes[parent]!;
      index = parent;
    }
    this.nodes[index] = node;
  }
  pop(): Node {
    const first = this.nodes[0]!;
    const last = this.nodes.pop()!;
    if (!this.nodes.length) return first;
    let index = 0;
    while (index * 2 + 1 < this.nodes.length) {
      let child = index * 2 + 1;
      if (child + 1 < this.nodes.length && this.before(this.nodes[child + 1]!, this.nodes[child]!)) child++;
      if (!this.before(this.nodes[child]!, last)) break;
      this.nodes[index] = this.nodes[child]!;
      index = child;
    }
    this.nodes[index] = last;
    return first;
  }
}

/** Exact bomb count for the simulator's fixed spawn, entry and serial bomb rules. */
export function minimumBombs(
  arena: Arena, player: Position, boxes: ReadonlySet<string>, levels: ReadonlyMap<string, Level>, config: GameConfig,
): BombPlan[] {
  if (!boxes.size) return [];
  const ids = [...levels.keys()];
  const indices = new Map(ids.map((id, index) => [id, index]));
  const packed = Uint8Array.from(ids.map(id => config.blockDamage === 'instant' ? Number(boxes.has(id)) : levels.get(id)!));
  const work = packed.reduce((sum, level) => sum + level, 0);
  const initial: Node = { levels: packed, work, bombs: 0, bound: lowerBound(packed, work), order: 0, player };

  // A valid greedy solution supplies an upper bound, never an unproven result.
  let incumbent: BombPlan[] | undefined;
  const greedy: BombPlan[] = [];
  const remaining = new Set(boxes);
  const durability = new Map(levels);
  const random = seededRandom(config.seed);
  let origin = player;
  while (remaining.size) {
    const plan = balancedBomb(arena, origin, remaining, config, random);
    if (!plan) break;
    greedy.push(plan);
    for (const hit of plan.impact.hits) {
      const id = key(hit);
      const level = (config.blockDamage === 'instant' ? 0 : durability.get(id)! - 1) as Level;
      durability.set(id, level);
      if (!level) remaining.delete(id);
    }
    origin = plan.escape.at(-1)!;
  }
  if (!remaining.size) incumbent = greedy;
  if (incumbent?.length === initial.bound) return incumbent;

  const frontier = new Frontier();
  frontier.push(initial);
  const visited = new Map([[packed.join(''), 0]]);
  let states = 1;
  while (frontier.first) {
    if (incumbent && frontier.first.bound >= incumbent.length) return incumbent;
    const node = frontier.pop();
    if (visited.get(node.levels.join('')) !== node.bombs) continue;
    const occupied = new Set(ids.filter((_, index) => node.levels[index]! > 0));
    const effects = new Set<string>();
    for (const plan of bombCandidates(arena, node.player, occupied, config)) {
      const hits = plan.impact.hits.map(hit => indices.get(key(hit))!).sort((a, b) => a - b);
      const effect = hits.join(',');
      if (effects.has(effect)) continue;
      effects.add(effect);
      const nextLevels = node.levels.slice();
      for (const index of hits) nextLevels[index] = nextLevels[index]! - 1;
      const nextWork = node.work - hits.length;
      const bombs = node.bombs + 1;
      const next: Node = {
        levels: nextLevels, work: nextWork, bombs, bound: bombs + lowerBound(nextLevels, nextWork),
        order: states, player: plan.escape.at(-1)!, parent: node, plan,
      };
      if (!nextWork) {
        if (!incumbent || bombs < incumbent.length) incumbent = route(next);
        if (incumbent.length === initial.bound) return incumbent;
        continue;
      }
      if (incumbent && next.bound >= incumbent.length) continue;
      // Every escape ends in the old empty component. Once the flame ends, that
      // component only grows. Equal durability maps therefore have identical
      // future bomb choices; player coordinates affect walking, not bomb count.
      const id = nextLevels.join('');
      if ((visited.get(id) ?? Infinity) <= bombs) continue;
      if (states >= config.plannerSearchLimit) {
        throw new Error(`min-bombs search limit (${config.plannerSearchLimit} states) reached before proving the minimum bomb count. Increase planner-search-limit or use fewer-bombs.`);
      }
      visited.set(id, bombs);
      states++;
      frontier.push(next);
    }
  }
  if (incumbent) return incumbent;
  throw new Error('Cannot safely clear the calendar with min-bombs under the current movement, fuse and blast rules.');
}
