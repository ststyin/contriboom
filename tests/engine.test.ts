import { describe, expect, it } from 'vitest';
import { blast } from '../src/engine/bomb.ts';
import { createArena, initialBoxes, inside, key, same } from '../src/engine/map.ts';
import { reachable } from '../src/engine/pathfinding.ts';
import { simulate } from '../src/engine/simulator.ts';
import { mockContributions } from '../src/fixtures/contributions.ts';
import type { Fixture } from '../src/fixtures/contributions.ts';
import type { GameConfig, Position, Replay } from '../src/engine/types.ts';
import { renderSvg } from '../src/renderer/svg.ts';
import { THEMES } from '../src/renderer/themes.ts';
import type { Theme } from '../src/renderer/themes.ts';

describe('blast geometry', () => {
  const arena = createArena(mockContributions(42, 'empty'));
  it('stops at the first box in each ray, without altering the board', () => {
    const boxes = new Set(['7,3', '8,3', '3,3', '5,1', '5,5']);
    const before = [...boxes];
    const result = blast(arena, { x: 5, y: 3 }, boxes, 4);
    expect(result.hits.map(key).sort()).toEqual(['3,3', '5,1', '5,5', '7,3']);
    expect(result.cells.map(key)).not.toContain('8,3');
    expect(result.cells.map(key)).not.toContain('5,0');
    expect(result.cells.map(key)).not.toContain('4,2');
    expect([...boxes]).toEqual(before);
  });
  it('clips all rays to the contribution grid', () => {
    const result = blast(arena, { x: 0, y: 0 }, new Set(), 10);
    expect(result.cells.every(cell => inside(arena, cell))).toBe(true);
    expect(result.cells.map(key)).toContain('0,0');
    expect(result.cells.filter(cell => cell.x === 0)).toHaveLength(7);
    expect(result.cells.filter(cell => cell.y === 0)).toHaveLength(11);
  });
  it('rejects bombs on contribution blocks or outside the grid', () => {
    expect(() => blast(arena, { x: 0, y: 0 }, new Set(['0,0']), 3)).toThrow(/empty cell/);
    expect(() => blast(arena, { x: -1, y: 0 }, new Set(), 3)).toThrow(/inside/);
  });
});

describe('pathfinding', () => {
  const arena = createArena(mockContributions(42, 'empty'));
  it('finds a shortest four-neighbor path around a blocking box', () => {
    const path = reachable(arena, { x: 0, y: 0 }, new Set(['1,0'])).pathTo({ x: 2, y: 0 })!;
    expect(path).toHaveLength(4);
    expect(path.map(key)).not.toContain('1,0');
    expect(path.at(-1)).toEqual({ x: 2, y: 0 });
  });
  it('can leave a bomb origin but never cross it again', () => {
    const map = reachable(arena, { x: 0, y: 0 }, new Set(['0,0']));
    expect(map.pathTo({ x: 2, y: 0 })!.map(key)).toEqual(['1,0', '2,0']);
    for (const position of map.positions) expect(map.pathTo(position)!.map(key)).not.toContain('0,0');
  });
});

/** Independently replay events against current boxes, bomb positions and active flames. */
function verifyRound(fixture: Fixture, seed: number, options: Partial<GameConfig> = {}, data = mockContributions(seed, fixture)): Replay {
  const original = structuredClone(data);
  const arena = createArena(data, data.length / 7);
  const replay = simulate(arena, { mode: 'preview', seed, ...options });
  const boxes = initialBoxes(arena);
  const originalLevels = new Map(arena.tiles.map(tile => [key(tile), tile.level]));
  const levels = new Map(originalLevels);
  const pristine = new Set(boxes);
  const entry = replay.events.find(event => event.type === 'entry');
  let player: Position | null = entry ? null : replay.start;
  if (player) {
    expect(inside(arena, player)).toBe(true);
    expect(boxes.has(key(player))).toBe(false);
  } else if (!entry) {
    expect(replay.events).toEqual([]);
  }
  let lastTime = 0;
  let lastMoveEnd = 0;
  let cleared = 0;
  let placed = 0;
  let activeBomb: { position: Position; time: number; fuse: number } | undefined;
  let flames: { cells: Set<string>; until: number } | undefined;
  for (const event of replay.events) {
    expect(event.time + 1e-8).toBeGreaterThanOrEqual(lastTime);
    lastTime = event.time;
    expect(event.time).toBeLessThan(replay.duration);
    if (event.type === 'entry') {
      expect(event).toBe(replay.events[0]);
      expect(player).toBeNull();
      expect(event.position).toEqual(replay.start);
      expect(new Set(event.cells.map(key)).size).toBe(event.cells.length);
      expect(event.cleared).toEqual(event.cells.filter(cell => boxes.has(key(cell))));
      for (const cell of event.cells) expect(inside(arena, cell)).toBe(true);
      for (const cell of event.cleared) {
        expect(boxes.delete(key(cell))).toBe(true);
        expect(levels.get(key(cell))).toBeGreaterThan(0);
        levels.set(key(cell), 0);
        cleared++;
      }
      player = event.position;
      expect(boxes.has(key(player))).toBe(false);
      lastMoveEnd = event.time + event.duration;
    } else if (event.type === 'move') {
      expect(player).not.toBeNull();
      expect(same(event.from, player!)).toBe(true);
      expect(Math.abs(event.to.x - player!.x) + Math.abs(event.to.y - player!.y)).toBe(1);
      expect(inside(arena, event.to)).toBe(true);
      expect(boxes.has(key(event.to))).toBe(false);
      expect(event.time + 1e-8).toBeGreaterThanOrEqual(lastMoveEnd);
      expect(event.time + event.duration).toBeLessThan(replay.restoreTime);
      if (activeBomb) expect(same(event.to, activeBomb.position)).toBe(false);
      if (flames && event.time < flames.until) expect(flames.cells.has(key(event.to))).toBe(false);
      player = event.to;
      lastMoveEnd = event.time + event.duration;
    } else if (event.type === 'bomb') {
      expect(activeBomb).toBeUndefined();
      expect(player).not.toBeNull();
      expect(same(event.position, player!)).toBe(true);
      expect(boxes.has(key(player!))).toBe(false);
      expect(event.time + 1e-8).toBeGreaterThanOrEqual(lastMoveEnd);
      activeBomb = event;
      placed++;
    } else if (event.type === 'explode') {
      expect(activeBomb).toBeDefined();
      expect(event.time).toBeCloseTo(activeBomb!.time + activeBomb!.fuse, 8);
      expect(lastMoveEnd + replay.config.safetyMargin).toBeLessThan(event.time);
      expect(event.cells.some(cell => same(cell, player!))).toBe(false);
      const expected = blast(arena, event.position, boxes, replay.config.explosionRange);
      expect(event.cells).toEqual(expected.cells);
      expect(event.damaged.map(hit => hit.position)).toEqual(expected.hits);
      for (const hit of event.damaged) {
        expect(hit.fromLevel).toBe(levels.get(key(hit.position)));
        expect(hit.toLevel).toBe(replay.config.blockDamage === 'fade' ? hit.fromLevel - 1 : 0);
        levels.set(key(hit.position), hit.toLevel);
      }
      expect(event.destroyed).toEqual(event.damaged.filter(hit => hit.toLevel === 0).map(hit => hit.position));
      for (const cell of event.destroyed) {
        expect(boxes.delete(key(cell))).toBe(true);
        cleared++;
      }
      flames = { cells: new Set(event.cells.map(key)), until: event.time + event.duration };
      activeBomb = undefined;
    } else {
      expect(event.time).toBeGreaterThanOrEqual(replay.restoreTime);
      for (const cell of event.cells) {
        expect(levels.get(key(cell))).toBeLessThan(originalLevels.get(key(cell))!);
        levels.set(key(cell), originalLevels.get(key(cell))!);
        boxes.add(key(cell));
      }
    }
  }
  expect(data).toEqual(original);
  expect(boxes).toEqual(pristine);
  expect(levels).toEqual(originalLevels);
  expect(replay.stats.bombs).toBe(placed);
  expect(replay.stats.destroyed).toBe(cleared);
  if (replay.config.mode === 'preview') expect(placed).toBeLessThanOrEqual(replay.config.maxBombs);
  else expect(cleared).toBe(pristine.size);
  expect(replay.stats.remaining).toBe(pristine.size - cleared);
  expect(replay.stats.totalBoxes).toBe(pristine.size);
  expect(replay.resultTime).toBeLessThan(replay.restoreTime);
  if (fixture === 'empty') expect(placed).toBe(0);
  if (fixture === 'full') {
    expect(replay.start).not.toBeNull();
    expect(entry?.cleared).toHaveLength(arena.width === 1 ? 7 : 4);
    if (replay.config.maxBombs > 0 && arena.width > 1) expect(placed).toBeGreaterThan(0);
  }
  return replay;
}

describe('simulation invariants', () => {
  it('keeps the start, every move, bomb and blast inside the contribution grid', () => {
    for (const fixture of ['demo', 'empty', 'full', 'sparse'] as const) {
      const replay = simulate(createArena(mockContributions(42, fixture)), { mode: 'preview' });
      const positions = [...(replay.start ? [replay.start] : []), ...replay.events.flatMap(event => {
        if (event.type === 'move') return [event.from, event.to];
        if (event.type === 'bomb') return [event.position];
        if (event.type === 'explode') return [event.position, ...event.cells];
        return event.cells;
      })];
      for (const position of positions) {
        expect(position.x).toBeGreaterThanOrEqual(0);
        expect(position.x).toBeLessThan(replay.arena.width);
        expect(position.y).toBeGreaterThanOrEqual(0);
        expect(position.y).toBeLessThan(replay.arena.height);
      }
    }
  });
  for (const fixture of ['demo', 'empty', 'full', 'sparse'] as const) {
    it(`safely handles ${fixture} input across twelve seeds`, () => {
      for (let seed = 0; seed < 12; seed++) verifyRound(fixture, seed);
    }, 30000);
  }
  it('respects different blast ranges and bomb budgets', () => {
    for (const range of [1, 2, 4, 8]) verifyRound('demo', range, { explosionRange: range, maxBombs: 2 });
  });
  it('defaults to range four with fading blocks and honors explicit fixed ranges', () => {
    expect(verifyRound('sparse', 42).config).toMatchObject({ explosionRange: 4, blockDamage: 'fade' });
    expect(verifyRound('sparse', 42, { explosionRange: 10 }).config.explosionRange).toBe(10);
    expect(verifyRound('sparse', 42, { explosionRange: 1 }).config.explosionRange).toBe(1);
  });
  it('handles zero bombs and includes the complete patrol in the replay', () => {
    const replay = verifyRound('empty', 42, { maxBombs: 0, stepDuration: 100 });
    expect(replay.events.some(event => event.type === 'move')).toBe(true);
    expect(replay.duration).toBeGreaterThan(60);
  });
  it('uses the preview bomb budget even when the round takes longer than a minute', () => {
    const replay = verifyRound('demo', 42, { maxBombs: 20, fuse: 5 });
    expect(replay.stats.bombs).toBe(20);
    expect(replay.duration).toBeGreaterThan(100);
    expect(replay.config).not.toHaveProperty('maxDuration');
  });
  it('generates byte-identical replays and SVGs from identical inputs', () => {
    const arena = createArena(mockContributions(71));
    const first = simulate(arena, { seed: 71 });
    const second = simulate(arena, { seed: 71 });
    expect(first).toEqual(second);
    expect(renderSvg(first)).toBe(renderSvg(second));
  });
  for (const fixture of ['demo', 'empty', 'sparse', 'full'] as const) {
    it(`clears every ${fixture} box and safely restores it across four seeds`, () => {
      for (let seed = 0; seed < 4; seed++) verifyRound(fixture, seed, { mode: 'clear' });
    }, 30000);
  }
  it('full clear ignores the preview bomb cap', () => {
    const replay = verifyRound('demo', 42, { mode: 'clear', maxBombs: 1 });
    expect(replay.stats.destroyed).toBe(replay.stats.totalBoxes);
    expect(replay.stats.remaining).toBe(0);
    expect(replay.stats.bombs).toBeGreaterThan(5);
    expect(replay.duration).toBeGreaterThan(60);
  });
  it('creates a safe entry on full calendars across blast ranges and damage modes', () => {
    for (const explosionRange of [1, 4, 10]) for (const blockDamage of ['fade', 'instant'] as const) {
      verifyRound('full', 42, { mode: 'clear', explosionRange, blockDamage });
    }
  }, 30000);
  it('keeps entry clearing separate from a zero or one-bomb preview budget', () => {
    const zero = verifyRound('full', 42, { maxBombs: 0 });
    expect(zero.stats).toMatchObject({ bombs: 0, destroyed: 4, remaining: 367 });
    expect(zero.events.some(event => event.type === 'move')).toBe(true);
    const one = verifyRound('full', 42, { maxBombs: 1 });
    expect(one.stats.bombs).toBe(1);
    expect(one.events.filter(event => event.type === 'entry')).toHaveLength(1);
    expect(one.events.filter(event => event.type === 'explode')).toHaveLength(1);
  });
  it('opens the smallest required area when existing padding has no safe escape', () => {
    const data = mockContributions(42, 'full');
    for (const i of [0, 1, 2]) data[i] = { ...data[i]!, count: 0, level: 0 };
    const replay = verifyRound('demo', 42, { maxBombs: 1 }, data);
    const entry = replay.events.find(event => event.type === 'entry');
    expect(entry?.cells).toHaveLength(4);
    expect(entry?.cleared).toHaveLength(2);
    expect(replay.stats.bombs).toBe(1);
  });
  it('reuses an existing safe spawn without introducing entry clearing', () => {
    for (const fixture of ['empty', 'sparse', 'demo'] as const) {
      expect(verifyRound(fixture, 42).events.some(event => event.type === 'entry')).toBe(false);
    }
  });
  it('uses a smaller safe component instead of clearing blocks around a larger trapped component', () => {
    const data = mockContributions(42, 'full');
    const empty = [0, 1, 2, 3, 4, 10 * 7 + 2, 10 * 7 + 3, 11 * 7 + 2, 11 * 7 + 3];
    for (const i of empty) data[i] = { ...data[i]!, count: 0, level: 0 };
    const replay = verifyRound('demo', 42, { explosionRange: 10, maxBombs: 1 }, data);
    expect(replay.events.some(event => event.type === 'entry')).toBe(false);
    expect(replay.start?.x).toBeGreaterThanOrEqual(10);
    expect(replay.start?.x).toBeLessThanOrEqual(11);
    expect(replay.stats.bombs).toBe(1);
  });
  it('clears a full two-column calendar with a capped two-by-two entry', () => {
    const data = mockContributions(42, 'full').slice(0, 14);
    const replay = verifyRound('full', 42, { mode: 'clear', explosionRange: 10 }, data);
    expect(replay.stats).toMatchObject({ totalBoxes: 14, destroyed: 14, remaining: 0 });
  });
  it('safely handles a full single-column calendar without a diagonal escape', () => {
    const data = mockContributions(42, 'full').slice(0, 7);
    const replay = verifyRound('full', 42, { mode: 'clear' }, data);
    expect(replay.stats).toMatchObject({ bombs: 0, destroyed: 7, remaining: 0 });
  });
  it('safely clears and restores durable blocks, including repeated hits and changed routes', () => {
    for (const seed of [3, 42, 71]) {
      const replay = verifyRound('demo', seed, { mode: 'clear', blockDamage: 'fade', maxBombs: 1 });
      const hitCount = replay.events.reduce((sum, event) => sum + (event.type === 'explode' ? event.damaged.length : 0), 0);
      expect(hitCount).toBe(replay.arena.tiles.reduce((sum, tile) => sum + tile.level, 0));
    }
    for (const range of [1, 2, 3]) verifyRound('sparse', 42, { blockDamage: 'fade', explosionRange: range, maxBombs: 3 });
  }, 30000);
  it('needs four hits for a level-four block and restores partially damaged blocks in a preview', () => {
    const data = mockContributions(42, 'empty');
    data[7 * 7 + 3] = { ...data[7 * 7 + 3]!, count: 12, level: 4 };
    const arena = createArena(data);
    const full = simulate(arena);
    expect(full.stats).toMatchObject({ bombs: 4, destroyed: 1, remaining: 0 });
    expect(full.events.flatMap(event => event.type === 'explode' ? event.damaged.map(hit => [hit.fromLevel, hit.toLevel]) : [])).toEqual([[4, 3], [3, 2], [2, 1], [1, 0]]);
    const instant = simulate(arena, { blockDamage: 'instant' });
    expect(instant.stats).toMatchObject({ bombs: 1, destroyed: 1, remaining: 0 });
    expect(instant.events.flatMap(event => event.type === 'explode' ? event.damaged.map(hit => [hit.fromLevel, hit.toLevel]) : [])).toEqual([[4, 0]]);
    const partial = simulate(arena, { mode: 'preview', blockDamage: 'fade', maxBombs: 1 });
    expect(partial.stats).toMatchObject({ bombs: 1, destroyed: 0, remaining: 1 });
    expect(partial.events.filter(event => event.type === 'restore').flatMap(event => event.cells.map(key))).toEqual(['7,3']);
    const svg = renderSvg(partial, { theme: 'mint' });
    const cell = svg.match(/<g data-cell="7,3">[\s\S]*?<\/g>/)![0];
    expect(cell).toContain(`values="${THEMES.mint.colors[4]};${THEMES.mint.colors[3]};${THEMES.mint.colors[4]};${THEMES.mint.colors[4]}"`);
    expect(cell).not.toContain('attributeName="opacity"');
    expect(renderSvg(full, { animated: false })).toBe(renderSvg(simulate(arena), { animated: false }));
    expect(data[7 * 7 + 3]!.level).toBe(4);
  });
  it('never presents an unsafe or incomplete run as a full clear', () => {
    expect(() => simulate(createArena(mockContributions(42, 'demo')), { mode: 'clear', fuse: 0.1 })).toThrow(/Cannot safely clear/);
    expect(() => simulate(createArena(mockContributions(42, 'full')), { mode: 'clear', fuse: 0.1 })).toThrow(/Cannot safely clear/);
  });
});

describe('input validation', () => {
  it('rejects inconsistent days, duplicate dates and wrong calendar dimensions', () => {
    const data = mockContributions();
    expect(() => createArena(data.slice(1))).toThrow();
    expect(() => createArena([{ ...data[0]!, count: -1 }, ...data.slice(1)])).toThrow();
    expect(() => createArena([{ ...data[0]!, count: 1, level: 0 }, ...data.slice(1)])).toThrow();
    expect(() => createArena([{ ...data[0]!, date: data[1]!.date }, ...data.slice(1)])).toThrow();
    expect(() => createArena([{ ...data[0]!, date: '2025-02-31' }, ...data.slice(1)])).toThrow();
    expect(() => createArena([...data].reverse())).toThrow();
  });
  it('rejects unsafe or nonsensical configuration', () => {
    const arena = createArena(mockContributions());
    for (const options of [{ maxBombs: -1 }, { seed: NaN }, { explosionRange: 0 }, { explosionRange: 11 }, { explosionRange: 2.5 }, { fuse: Infinity }, { stepDuration: 0 }]) {
      expect(() => simulate(arena, options)).toThrow();
    }
  });
});

describe('SVG output', () => {
  const replay = simulate(createArena(mockContributions()));
  it('places every robot keyframe over a calendar cell without an outer route', () => {
    const svg = renderSvg(replay);
    const floor = svg.match(/<g id="floor">\s*<rect x="([\d.]+)" y="([\d.]+)"/)!
    const left = Number(floor[1]) + 10;
    const top = Number(floor[2]) + 10;
    const player = svg.slice(svg.indexOf('<g id="player"'));
    const positions = player.match(/<animateTransform[^>]+values="([^"]+)"/)![1]!.split(';');
    for (const value of positions) {
      const [x, y] = value.split(' ').map(Number);
      expect(x).toBeGreaterThanOrEqual(left);
      expect(x).toBeLessThanOrEqual(left + (replay.arena.width - 1) * 22);
      expect(y).toBeGreaterThanOrEqual(top);
      expect(y).toBeLessThanOrEqual(top + (replay.arena.height - 1) * 22);
    }
  });
  it('preserves the original robot size', () => {
    expect(renderSvg(replay).match(/<use href="#robot"[^>]*\/>/)?.[0]).toBe('<use href="#robot"/>');
  });
  it('replaces only character artwork, retaining the player route and all effects', () => {
    const playerIcon = 'data:image/png;base64,aGVsbG8=';
    const original = renderSvg(replay);
    const customized = renderSvg(replay, { playerIcon });
    const artwork = /<g id="robot">[\s\S]*?<\/g>/;
    expect(customized.match(artwork)?.[0]).toContain('<image');
    expect(customized.match(artwork)?.[0]).toContain('x="-10" y="-10" width="20" height="20"');
    expect(customized.replace(artwork, '').replace('A character clears', 'A robot clears')).toBe(original.replace(artwork, ''));
    expect(renderSvg(replay, { playerIcon, animated: false })).toBe(renderSvg(replay, { animated: false }));
  });
  it('requires embedded images instead of external paths or injected SVG attributes', () => {
    for (const playerIcon of ['https://example.com/player.png', 'assets/player.png', 'data:image/png;base64,aGVsbG8=" onload="alert(1)']) {
      expect(() => renderSvg(replay, { playerIcon })).toThrow('embedded image data URI');
    }
  });
  it('animates entry on a full calendar and keeps the original static image', () => {
    const full = simulate(createArena(mockContributions(42, 'full')), { mode: 'preview' });
    const svg = renderSvg(full);
    expect(svg).toContain('id="entry-effect"');
    expect(svg).toContain('id="player" opacity="0"');
    const entry = full.events.find(event => event.type === 'entry')!;
    for (const cell of entry.cleared) {
      const block = svg.match(new RegExp(`<g data-cell="${key(cell)}">[\\s\\S]*?<\\/g>`))![0];
      expect(block).toContain('attributeName="opacity"');
      expect(block).toContain('calcMode="linear"');
      expect(block).toContain('values="1;1;0;0;1;1"');
    }
    const player = svg.slice(svg.indexOf('<g id="player"'));
    expect(player).toContain('values="0;0;1;1;0;0;0;0"');
    expect([...svg.matchAll(/data-cell=/g)]).toHaveLength(371);
    const staticSvg = renderSvg(full, { animated: false });
    expect(staticSvg).not.toMatch(/<animate|id="player"|id="entry-effect"/);
    expect([...staticSvg.matchAll(/data-cell=/g)]).toHaveLength(371);
    for (const cell of entry.cleared) {
      const tile = full.arena.tiles.find(tile => same(tile, cell))!;
      const block = staticSvg.match(new RegExp(`<g data-cell="${key(cell)}">[\\s\\S]*?<\\/g>`))![0];
      expect(block).toContain(`fill="${THEMES.github.colors[tile.level]}"`);
    }
  });
  it('contains only self-contained artwork and escapes input labels', () => {
    const svg = renderSvg(replay, { label: '<script>"&\'' });
    expect(svg).not.toMatch(/<script|<foreignObject|onload=|href="https?:|url\(https?:|@import/i);
    expect(svg).toContain('&lt;script&gt;&quot;&amp;&apos;');
    expect(svg).not.toMatch(/<text\b|Contriboom|Make your contributions|stroke-dasharray/);
    for (const reference of svg.matchAll(/href="([^"]+)"/g)) expect(reference[1]).toMatch(/^#/);
  });
  it('synchronizes every animation and has well-formed keyframe arrays', () => {
    for (const round of [replay, simulate(createArena(mockContributions(42, 'full')), { mode: 'preview' })]) {
      const svg = renderSvg(round);
      const animations = [...svg.matchAll(/<(?:animate|animateTransform)\s[^>]+\/>/g)];
      expect(animations.length).toBeGreaterThan(10);
      for (const [tag] of animations) {
        expect(Number(tag.match(/dur="([\d.]+)s"/)![1])).toBeCloseTo(round.duration, 5);
        const times = tag.match(/keyTimes="([^"]+)"/)![1]!.split(';').map(Number);
        const values = tag.match(/values="([^"]+)"/)![1]!.split(';');
        expect(times).toHaveLength(values.length);
        expect(times[0]).toBe(0);
        expect(times.at(-1)).toBe(1);
        for (let index = 1; index < times.length; index++) expect(times[index]!).toBeGreaterThan(times[index - 1]!);
      }
    }
  });
  it('renders a static alternative and distinct themes from the same replay', () => {
    const svg = renderSvg(replay, { animated: false });
    expect(svg).not.toMatch(/<animate|<text\b|<defs>|id="player"/);
    expect(renderSvg(replay)).toBe(renderSvg(replay, { theme: 'github' }));
    expect(svg).toBe(renderSvg(replay, { theme: 'github', animated: false }));
    for (const color of ['#eff2f5', '#aceebb', '#4ac26b', '#2da44e', '#116329']) expect(svg).toContain(color);
    expect(renderSvg(replay, { theme: 'dark' })).toContain('#202b36');
    expect(renderSvg(replay, { theme: 'light' })).toContain('#e4e9dd');
  });
  it('changes only tile fills for every added palette, preserving artwork and animation', () => {
    for (const theme of Object.keys(THEMES) as Theme[]) {
      if (theme === 'dark' || theme === 'light') continue;
      for (const animated of [true, false]) {
        const original = renderSvg(replay, { theme: 'light', animated });
        const expected = original.replace(/#[a-f0-9]{6}\b/gi, (color: string) => {
          const level = THEMES.light.colors.indexOf(color);
          return level < 0 ? color : THEMES[theme].colors[level]!;
        });
        expect(renderSvg(replay, { theme, animated })).toBe(expected);
      }
    }
  });
});
