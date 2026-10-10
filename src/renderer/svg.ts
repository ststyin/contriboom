import { key } from '../engine/map.ts';
import type { Position, Replay } from '../engine/types.ts';
import { animation, escapeXml, visibleBetween } from './animations.ts';
import type { Frame } from './animations.ts';
import { THEMES } from './themes.ts';
import type { Theme } from './themes.ts';

export interface RenderOptions { theme?: Theme; label?: string; animated?: boolean }

export function renderSvg(replay: Replay, options: RenderOptions = {}): string {
  const theme = THEMES[options.theme ?? 'dark'];
  const animated = options.animated !== false;
  const { arena, duration } = replay;
  const stride = 22;
  const boardX = 42;
  const boardY = 150;
  const calendarX = boardX + stride;
  const calendarY = boardY + stride;
  const width = Math.max(680, (arena.width + 2) * stride + 84);
  const height = 452;
  const boardWidth = (arena.width + 2) * stride;
  const boardHeight = (arena.height + 2) * stride;
  const xy = (p: Position): string => `${calendarX + p.x * stride + 10} ${calendarY + p.y * stride + 10}`;
  const parts: string[] = [];
  const emit = (text: string): void => { parts.push(text); };
  const font = 'ui-monospace, SFMono-Regular, Consolas, monospace';

  emit(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">
<title id="title">Contriboom — Make your contributions a blast.</title>
<desc id="desc">Make your contributions a blast.${options.label ? ` ${escapeXml(options.label)}.` : ''} A robot clears the contribution calendar, then rebuilds it.</desc>
<defs>
  <g id="robot">
    <ellipse cx="0" cy="9" rx="9" ry="3" fill="#000" opacity=".24"/>
    <path d="M-7 4h5v5h-5zm9 0h5v5H2z" fill="#c86a30"/>
    <rect x="-6" y="-1" width="12" height="8" rx="2" fill="#ff9b50"/>
    <path d="M-8 0v4m16-4v4" stroke="#ffbd76" stroke-width="3" stroke-linecap="round"/>
    <rect x="-8" y="-10" width="16" height="12" rx="4" fill="#f4eee0" stroke="#27323f" stroke-width="1.5"/>
    <rect x="-5.5" y="-7" width="11" height="5" rx="2" fill="#243c46"/>
    <path d="M-3-5h1m4 0h1" stroke="#8de1d8" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M0-10v-3" stroke="#ff9b50" stroke-width="1.5"/>
    <circle cy="-14" r="1.8" fill="#ffbd76"/>
  </g>
  <g id="bomb-shape">
    <ellipse cy="7" rx="9" ry="3" fill="#000" opacity=".25"/>
    <circle r="7.5" fill="#303d4c" stroke="#ffa351" stroke-width="1.4"/>
    <path d="M2-7q0-5 5-5" fill="none" stroke="#ffc67e" stroke-width="2"/>
    <circle cx="8" cy="-12" r="2.4" fill="#ffdf8c"/>
    <path d="M-4-3q-2 2-1 4" stroke="#758798" stroke-width="2" fill="none" stroke-linecap="round"/>
  </g>
  <g id="flame">
    <rect x="-10" y="-10" width="20" height="20" rx="5" fill="#ff9551" opacity=".8"/>
    <path d="M0-9 3-4 8-3 5 1 7 6 2 5 0 10-3 5-8 4-5 0-7-5-2-4Z" fill="#ffd481"/>
    <path d="m0-4 3 4-3 5-3-5Z" fill="#fff5c6"/>
  </g>
</defs>
<rect x=".5" y=".5" width="${width - 1}" height="451" rx="24" fill="${theme.background}" stroke="${theme.border}"/>
<g font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="${theme.text}">
<g transform="translate(42 39)"><rect width="28" height="28" rx="8" fill="${theme.accent}"/><path d="m14 3 2 7 7-2-4 6 6 3-8 1-1 7-4-6-6 3 2-7-6-3 8-1Z" fill="${theme.background}"/></g>
<text x="82" y="61" font-size="29" font-weight="750" letter-spacing="-1">Contriboom<tspan fill="${theme.accent}">.</tspan></text>
<text x="42" y="91" font-size="14" fill="${theme.muted}">Make your contributions a blast.</text>
${options.label ? `<text x="${width - 42}" y="91" font-family="${font}" font-size="10" fill="${theme.muted}" text-anchor="end">${escapeXml(options.label)}</text>` : ''}
<path d="M42 111H${width - 42}" stroke="${theme.border}"/>
<text x="42" y="136" font-family="${font}" font-size="10" letter-spacing="1.8" fill="${theme.muted}">CONTRIBUTION ARENA</text>
<rect x="${width - 218}" y="38" width="176" height="31" rx="15.5" fill="${theme.panel}" stroke="${theme.border}"/>
<circle cx="${width - 199}" cy="53.5" r="3" fill="${theme.accent}"/>`);

  const stage = (text: string, intervals: Array<[number, number]>): void => {
    const frames: Frame[] = [[0, 0]];
    for (const [from, to] of intervals) frames.push([from, 1], [to, 0]);
    frames.push([duration, 0]);
    emit(`<text x="${width - 184}" y="57.5" font-family="${font}" font-size="10" font-weight="600" letter-spacing=".8" opacity="${!animated && text === 'SCOUTING' ? 1 : 0}">${text}${animated ? animation('opacity', frames, duration) : ''}</text>`);
  };
  const bombs = replay.events.filter(event => event.type === 'bomb');
  const explosions = replay.events.filter(event => event.type === 'explode');
  let last = 0;
  const scouting: Array<[number, number]> = [];
  for (let index = 0; index < bombs.length; index++) {
    const bomb = bombs[index]!;
    const explosion = explosions[index]!;
    scouting.push([last, bomb.time]);
    last = explosion.time + explosion.duration;
  }
  scouting.push([last, replay.resultTime], [duration - 0.45, duration]);
  stage('SCOUTING', scouting);
  stage('FUSE LIT', bombs.map(bomb => [bomb.time, bomb.time + bomb.fuse]));
  stage('BOOM!', explosions.map(event => [event.time, event.time + event.duration]));
  stage(replay.stats.remaining === 0 && replay.stats.totalBoxes > 0 ? 'ARENA CLEARED' : 'ROUND COMPLETE', [[replay.resultTime, replay.restoreTime]]);
  stage('REBUILDING', [[replay.restoreTime, duration - 0.45]]);

  emit(`<rect x="${boardX - 7}" y="${boardY - 7}" width="${boardWidth + 14}" height="${boardHeight + 14}" rx="12" fill="${theme.panel}" stroke="${theme.border}"/>
<g id="floor">`);
  for (let x = -1; x <= arena.width; x++) {
    for (let y = -1; y <= arena.height; y++) {
      const ring = x === -1 || x === arena.width || y === -1 || y === arena.height;
      emit(`<rect x="${calendarX + x * stride}" y="${calendarY + y * stride}" width="20" height="20" rx="3" fill="${ring ? theme.ring : theme.floor}"${ring ? ` stroke="${theme.border}" stroke-dasharray="2 4" stroke-opacity=".4"` : ''}/>`);
    }
  }
  emit('</g><g id="contributions">');
  const destroyedAt = new Map<string, number>();
  const restoredAt = new Map<string, number>();
  for (const event of replay.events) {
    if (event.type === 'explode') for (const cell of event.destroyed) destroyedAt.set(key(cell), event.time);
    if (event.type === 'restore') for (const cell of event.cells) restoredAt.set(key(cell), event.time);
  }
  for (const tile of arena.tiles) {
    if (!tile.count) continue;
    const id = key(tile);
    const hit = destroyedAt.get(id);
    emit(`<g data-cell="${id}"><title>${escapeXml(tile.date)}: ${tile.count} contributions</title>
<rect x="${calendarX + tile.x * stride}" y="${calendarY + tile.y * stride}" width="20" height="20" rx="3" fill="${theme.greens[tile.level]}"/>
<path d="M${calendarX + tile.x * stride + 3} ${calendarY + tile.y * stride + 3}h14" stroke="#fff" stroke-opacity=".16" stroke-linecap="round"/>
${animated && hit !== undefined ? animation('opacity', [[0, 1], [hit, 0], [restoredAt.get(id)!, 1], [duration, 1]], duration) : ''}</g>`);
  }
  emit('</g>');

  if (animated) {
    for (const event of explosions) {
      emit(`<g data-blast="${event.id}" opacity="0">${visibleBetween(event.time, event.time + event.duration, duration)}`);
      for (const cell of event.cells) emit(`<use href="#flame" transform="translate(${xy(cell)})"/>`);
      emit('</g>');
      // Small sparks travel out from the struck box; contribution data stays untouched.
      for (const cell of event.destroyed) {
        for (const [dx, dy] of [[-9, -13], [9, -11], [-11, 8], [12, 6]]) {
          emit(`<g opacity="0">${visibleBetween(event.time, event.time + 0.55, duration)}
<g transform="translate(${xy(cell)})">${animation('transform', [[0, xy(cell)], [event.time, xy(cell)], [event.time + 0.55, `${calendarX + cell.x * stride + 10 + dx!} ${calendarY + cell.y * stride + 10 + dy!}`], [duration, xy(cell)]], duration, 'linear', true)}<rect x="-1.5" y="-1.5" width="3" height="3" rx=".5" fill="${theme.accent}"/></g></g>`);
        }
      }
    }
    for (const bomb of bombs) {
      const frames: Frame[] = [[0, 7.5], [bomb.time, 7.5]];
      for (let t = bomb.time + 0.15, index = 0; t < bomb.time + bomb.fuse; t += 0.15, index++) frames.push([t, index % 2 ? 7.5 : 9]);
      frames.push([bomb.time + bomb.fuse, 7.5], [duration, 7.5]);
      emit(`<g data-bomb="${bomb.id}" transform="translate(${xy(bomb.position)})" opacity="0">${visibleBetween(bomb.time, bomb.time + bomb.fuse, duration)}<circle r="7.5" fill="none" stroke="${theme.accent}" stroke-width="2" opacity=".5">${animation('r', frames, duration, 'linear')}</circle><use href="#bomb-shape"/></g>`);
    }
    emit(`<rect id="rebuild-sweep" x="${calendarX - 6}" y="${calendarY - 2}" width="5" height="${arena.height * stride}" rx="2" fill="${theme.accent}" opacity="0">
${visibleBetween(replay.restoreTime, duration - 1, duration)}
${animation('x', [[0, calendarX - 6], [replay.restoreTime, calendarX - 6], [duration - 1, calendarX + arena.width * stride], [duration, calendarX - 6]], duration, 'linear')}</rect>`);
  }

  const positionFrames: Frame[] = [[0, xy(replay.start)]];
  for (const event of replay.events) if (event.type === 'move') {
    positionFrames.push([event.time, xy(event.from)], [event.time + event.duration, xy(event.to)]);
  }
  const finalPosition = positionFrames.at(-1)![1];
  positionFrames.push([replay.restoreTime, finalPosition], [duration - 0.7, xy(replay.start)], [duration, xy(replay.start)]);
  emit(`<g id="player" transform="translate(${xy(replay.start)})">
${animated ? animation('transform', positionFrames, duration, 'linear', true) : ''}
${animated ? animation('opacity', [[0, 1], [replay.restoreTime - 0.12, 1], [replay.restoreTime, 0], [duration - 0.7, 0], [duration - 0.45, 1], [duration, 1]], duration, 'linear') : ''}
<use href="#robot"/></g>`);

  emit(`<path d="M42 376H${width - 42}" stroke="${theme.border}"/>
<text x="42" y="401" font-family="${font}" font-size="10" fill="${theme.muted}" letter-spacing="1.2">YOUR CONTRIBUTIONS, AT PLAY</text>
<text x="42" y="425" font-size="14" font-weight="600">${replay.stats.contributions ? 'A little room to roam.' : 'Quiet calendar. Ready for your next commit.'}</text>`);
  emit(`<text x="${width - 210}" y="401" font-family="${font}" font-size="10" fill="${theme.muted}">${replay.stats.contributions.toLocaleString('en-US')} CONTRIBUTIONS</text>
<text x="${width - 210}" y="425" font-size="10" fill="${theme.muted}">Less</text>`);
  for (let index = 0; index < 5; index++) emit(`<rect x="${width - 179 + index * 20}" y="415" width="15" height="15" rx="3" fill="${theme.greens[index]}"/>`);
  emit(`<text x="${width - 69}" y="425" font-size="10" fill="${theme.muted}">More</text></g></svg>`);
  return parts.join('\n');
}
