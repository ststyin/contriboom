import { blast } from './bomb.ts';
import { key, seededRandom } from './map.ts';
import { escapePath, reachable } from './pathfinding.ts';
import type { Arena, GameConfig, Level, Position } from './types.ts';

export const PLANNERS = ['balanced', 'fewer-bombs', 'fast-clear', 'min-bombs'] as const;
export const POST_BLAST_DELAY = 0.28;

export function validatePlannerOptions(planner: string, mode: string, searchLimit: number): void {
  if (!(PLANNERS as readonly string[]).includes(planner)) throw new Error(`Unknown planner. Choose ${PLANNERS.join(', ')}.`);
  if (planner === 'min-bombs' && mode !== 'clear') throw new Error('min-bombs requires mode clear. Use fewer-bombs or fast-clear for previews.');
  if (!Number.isSafeInteger(searchLimit) || searchLimit < 1) throw new Error('planner-search-limit must be a positive safe integer.');
}

export interface BombPlan {
  position: Position;
  approach: Position[];
  escape: Position[];
  impact: ReturnType<typeof blast>;
}

/** Every planner uses the same geometry, movement and strict escape deadline. */
export function* bombCandidates(
  arena: Arena, origin: Position, boxes: ReadonlySet<string>, config: GameConfig,
  consider: (hits: number, approach: number) => boolean = () => true,
): Generator<BombPlan> {
  const destinations = reachable(arena, origin, boxes);
  const maxSteps = Math.max(0, Math.ceil((config.fuse - config.safetyMargin) / config.stepDuration) - 1);
  for (const position of destinations.positions) {
    const impact = blast(arena, position, boxes, config.explosionRange);
    if (!impact.hits.length) continue;
    const approach = destinations.pathTo(position)!;
    if (!consider(impact.hits.length, approach.length)) continue;
    const hazard = new Set(impact.cells.map(key));
    const blocked = new Set([...boxes, key(position)]);
    const escape = escapePath(arena, position, blocked, hazard, maxSteps);
    if (!escape || escape.length * config.stepDuration + config.safetyMargin >= config.fuse) continue;
    yield { position, approach, escape, impact };
  }
}

/** Preserve the original scoring, pruning and seeded random sequence. */
export function balancedBomb(
  arena: Arena, origin: Position, boxes: ReadonlySet<string>, config: GameConfig,
  random: () => number, probe = false,
): BombPlan | undefined {
  let best: (BombPlan & { score: number }) | undefined;
  const consider = (hits: number, approach: number) => !best || 3 * hits - approach - 2 + 0.01 >= best.score;
  for (const candidate of bombCandidates(arena, origin, boxes, config, consider)) {
    if (probe) return candidate;
    const score = 3 * candidate.impact.hits.length - candidate.approach.length - 2 * candidate.escape.length + random() * 0.01;
    if (!best || score > best.score) best = { ...candidate, score };
  }
  return best;
}

interface State {
  boxes: Set<string>;
  levels: Map<string, Level>;
  player: Position;
  work: number;
  steps: number;
  time: number;
  plans: BombPlan[];
}

function planDuration(plan: BombPlan, config: GameConfig): number {
  return plan.approach.length * config.stepDuration + config.fuse + config.blastDuration + POST_BLAST_DELAY;
}

function advance(state: State, plan: BombPlan, config: GameConfig): State {
  const boxes = new Set(state.boxes);
  const levels = new Map(state.levels);
  for (const position of plan.impact.hits) {
    const id = key(position);
    const level = (config.blockDamage === 'fade' ? levels.get(id)! - 1 : 0) as Level;
    levels.set(id, level);
    if (level === 0) boxes.delete(id);
  }
  return {
    boxes, levels, player: plan.escape.at(-1)!,
    work: state.work - plan.impact.hits.length,
    steps: state.steps + plan.approach.length + plan.escape.length,
    // Escape movement fits inside the fuse and adds no extra waiting time.
    time: state.time + planDuration(plan, config),
    plans: [...state.plans, plan],
  };
}

// At equal bomb counts, prefer damage, cleared cells, then shorter routes.
function progress(a: State, b: State): number {
  return a.work - b.work || a.boxes.size - b.boxes.size || a.steps - b.steps;
}

function branches(arena: Arena, state: State, config: GameConfig, random: () => number): BombPlan[] {
  type Choice = { plan: BombPlan; hits: number; clears: number; steps: number; time: number; tie: number };
  const fast = config.planner === 'fast-clear';
  const effects = new Map<string, Choice>();
  for (const plan of bombCandidates(arena, state.player, state.boxes, config)) {
    const ids = plan.impact.hits.map(key).sort();
    const effect = ids.join(';') + (fast ? `@${key(plan.escape.at(-1)!)}` : '');
    const choice: Choice = {
      plan, hits: ids.length,
      clears: config.blockDamage === 'instant' ? ids.length : ids.filter(id => state.levels.get(id) === 1).length,
      steps: plan.approach.length + plan.escape.length, tie: random(),
      time: planDuration(plan, config),
    };
    // Equal hit sets yield the same board and reachable component after the blast.
    // Retain one representative to bound this approximate search.
    const previous = effects.get(effect);
    const cost = previous ? (fast ? choice.time - previous.time : choice.steps - previous.steps) : 0;
    if (!previous || cost < 0 || (cost === 0 && choice.tie < previous.tie)) {
      effects.set(effect, choice);
    }
  }
  const choices = [...effects.values()];
  const byDamage = [...choices].sort((a, b) =>
    (fast ? b.hits / b.time - a.hits / a.time : b.hits - a.hits) || b.clears - a.clears || a.steps - b.steps || a.tie - b.tie);
  const byClearing = [...choices].sort((a, b) =>
    (fast ? b.clears / b.time - a.clears / a.time : b.clears - a.clears) || b.hits - a.hits || a.steps - b.steps || a.tie - b.tie);
  // Include routes that open cells even when their immediate damage is lower.
  return [...new Set([...byDamage.slice(0, 4), ...byClearing.slice(0, 2)])].map(choice => choice.plan);
}

/** Compare at most three bombs ahead, retaining four states per search layer. */
function lookAhead(arena: Arena, initial: State, config: GameConfig, limit: number, random: () => number): State {
  let beam = [initial];
  const fast = config.planner === 'fast-clear';
  const finished: State[] = [];
  const order = fast ? (a: State, b: State) =>
    (initial.work - b.work) / (b.time - initial.time) - (initial.work - a.work) / (a.time - initial.time) ||
    a.boxes.size - b.boxes.size || a.time - b.time || a.steps - b.steps : progress;
  const depth = Math.min(3, limit - initial.plans.length);
  for (let step = 0; step < depth; step++) {
    const next: State[] = [];
    for (const state of beam) {
      for (const plan of branches(arena, state, config, random)) next.push(advance(state, plan, config));
    }
    if (!next.length) break;
    const complete = next.filter(state => !state.boxes.size).sort((a, b) => a.steps - b.steps);
    if (complete.length && !fast) return complete[0]!;
    finished.push(...complete);
    // The original empty component can only grow, so identical durability maps
    // have the same future bomb possibilities, regardless of the escape endpoint.
    const unique = new Map<string, State>();
    for (const state of next) {
      if (!state.boxes.size) continue;
      const id = [...state.levels.values()].join('') + (fast ? `@${key(state.player)}` : '');
      const previous = unique.get(id);
      if (!previous || (fast ? state.time < previous.time : state.steps < previous.steps)) unique.set(id, state);
    }
    if (!unique.size) break;
    beam = [...unique.values()].sort(order).slice(0, 4);
  }
  return finished.sort((a, b) => a.time - b.time || a.steps - b.steps)[0] ?? beam.sort(order)[0]!;
}

/** A bounded heuristic with the original complete plan as a fallback. */
export function heuristicPlans(
  arena: Arena, player: Position, boxes: ReadonlySet<string>, levels: ReadonlyMap<string, Level>,
  config: GameConfig, limit: number,
): BombPlan[] {
  const initial: State = {
    boxes: new Set(boxes), levels: new Map(levels), player, steps: 0, time: 0, plans: [],
    work: config.blockDamage === 'fade' ? [...levels.values()].reduce<number>((sum, level) => sum + level, 0) : boxes.size,
  };
  let baseline = initial;
  const baselineRandom = seededRandom(config.seed);
  while (baseline.boxes.size && baseline.plans.length < limit) {
    const plan = balancedBomb(arena, baseline.player, baseline.boxes, config, baselineRandom);
    if (!plan) break;
    baseline = advance(baseline, plan, config);
  }
  let optimized = initial;
  const random = seededRandom(config.seed);
  while (optimized.boxes.size && optimized.plans.length < limit) {
    const next = lookAhead(arena, optimized, config, limit, random);
    if (next.plans.length === optimized.plans.length) break;
    optimized = next;
  }
  let comparison: number;
  if (!optimized.boxes.size && !baseline.boxes.size) {
    comparison = (config.planner === 'fast-clear' ? optimized.time - baseline.time : 0) ||
      optimized.plans.length - baseline.plans.length || optimized.steps - baseline.steps;
  } else if (!optimized.boxes.size || !baseline.boxes.size) {
    comparison = optimized.boxes.size ? 1 : -1;
  } else {
    // Preview budgets optimize damage first; a shorter incomplete plan is not a win.
    comparison = optimized.work - baseline.work || optimized.boxes.size - baseline.boxes.size ||
      (config.planner === 'fast-clear' ? optimized.time - baseline.time : 0) ||
      optimized.plans.length - baseline.plans.length || optimized.steps - baseline.steps;
  }
  return comparison < 0 ? optimized.plans : baseline.plans;
}
