import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import path from 'node:path';
import { createArena } from './engine/map.ts';
import { simulate } from './engine/simulator.ts';
import { mockContributions } from './fixtures/contributions.ts';
import type { Fixture } from './fixtures/contributions.ts';
import type { Contribution } from './engine/types.ts';
import { renderSvg } from './renderer/svg.ts';
import { loadPlayerIcon } from './renderer/player-icon.ts';
import { DEFAULT_THEME, THEMES } from './renderer/themes.ts';
import type { Theme } from './renderer/themes.ts';
import { getGitHubContributions } from './github/client.ts';

async function main(): Promise<void> {
  const { values } = parseArgs({ options: {
    seed: { type: 'string', default: '42' },
    fixture: { type: 'string' },
    username: { type: 'string' },
    year: { type: 'string' },
    'cache-dir': { type: 'string', default: '.cache/contriboom' },
    'cache-ttl': { type: 'string', default: '3600' },
    'no-cache': { type: 'boolean', default: false },
    refresh: { type: 'boolean', default: false },
    input: { type: 'string' },
    output: { type: 'string', default: 'artifacts' },
    theme: { type: 'string', default: DEFAULT_THEME },
    'player-icon': { type: 'string' },
    mode: { type: 'string', default: 'clear' },
    'max-bombs': { type: 'string', default: '5' },
    range: { type: 'string', default: '3' },
    duration: { type: 'string', default: '22' },
    help: { type: 'boolean', default: false },
  } });
  if (values.help) {
    console.log('Contriboom — Make your contributions a blast.\n\n' +
      'npm run generate -- --username <login> [--year 2025] [--refresh]\n' +
      '                    [--cache-dir .cache/contriboom] [--cache-ttl 3600] [--no-cache]\n' +
      'npm run generate -- [--seed 42] [--fixture demo|empty|full|sparse]\n' +
      '                    [--input contributions.json] [--output artifacts]\n' +
      '                    [--theme <name>] [--player-icon path/to/image.png]\n' +
      '                    [--mode clear|preview] [--range 3]\n' +
      '                    [--max-bombs 5] [--duration 22] (preview only)\n\n' +
      'GitHub: set GITHUB_TOKEN or GH_TOKEN. Default period is the past year.\n' +
      'CONTRIBOOM_USERNAME supplies a default account; --input or --fixture overrides it.\n' +
      `Themes: ${Object.keys(THEMES).join(', ')}. Default: ${DEFAULT_THEME}.\n` +
      'Player icon: local PNG, JPEG, GIF, WebP, or SVG, up to 2 MiB; defaults to the robot.\n' +
      'JSON input: complete chronological weeks of { date, count, level } days (up to 54 weeks).\n' +
      'Local JSON and fixtures work offline without a token.');
    return;
  }
  if (!Object.hasOwn(THEMES, values.theme!)) throw new Error(`Unknown theme. Choose ${Object.keys(THEMES).join(', ')}.`);
  const theme = values.theme as Theme;
  const fixture = values.fixture ?? 'demo';
  if (!['demo', 'empty', 'full', 'sparse'].includes(fixture)) throw new Error('Unknown fixture.');
  if (!['clear', 'preview'].includes(values.mode!)) throw new Error('Unknown mode. Choose clear or preview.');
  if ([values.username, values.input, values.fixture].filter(value => value !== undefined).length > 1) {
    throw new Error('Choose only one source: --username, --input, or --fixture.');
  }
  const username = values.username ?? (!values.input && !values.fixture ? process.env.CONTRIBOOM_USERNAME : undefined);
  if (values.year !== undefined && !username) throw new Error('--year requires a GitHub account (--username or CONTRIBOOM_USERNAME).');
  const playerIcon = values['player-icon'] === undefined ? undefined : await loadPlayerIcon(values['player-icon']);
  const seed = Number(values.seed);
  let data: Contribution[];
  let label: string | undefined;
  if (username) {
    const calendar = await getGitHubContributions({
      username, year: values.year === undefined ? undefined : Number(values.year),
      cacheDirectory: values['no-cache'] ? false : values['cache-dir'],
      cacheTtlSeconds: Number(values['cache-ttl']), refresh: values.refresh,
    });
    data = calendar.contributions;
    label = `@${calendar.login}`;
    console.log(`Contributions for ${label} (${calendar.source}, ${calendar.range.from.slice(0, 10)} to ${calendar.range.to.slice(0, 10)})`);
  } else {
    data = values.input
      ? JSON.parse(await readFile(values.input, 'utf8')) as Contribution[]
      : mockContributions(seed, fixture as Fixture);
  }
  if (!Array.isArray(data)) throw new Error('Input must be an array of contribution days.');
  const arena = createArena(data, data.length / 7);
  const replay = simulate(arena, {
    seed, mode: values.mode as 'clear' | 'preview', maxBombs: Number(values['max-bombs']),
    explosionRange: Number(values.range), maxDuration: Number(values.duration),
  });
  const output = path.resolve(values.output!);
  await mkdir(output, { recursive: true });
  await Promise.all([
    writeFile(path.join(output, 'game.svg'), renderSvg(replay, { theme, label, playerIcon })),
    writeFile(path.join(output, 'game-static.svg'), renderSvg(replay, { theme, animated: false, label })),
    writeFile(path.join(output, 'contributions.json'), JSON.stringify(data, null, 2) + '\n'),
    writeFile(path.join(output, 'replay.json'), JSON.stringify(replay, null, 2) + '\n'),
  ]);
  console.log(`Generated ${output}\n${replay.stats.bombs} bombs · ${replay.stats.destroyed}/${replay.stats.totalBoxes} blocks cleared · ${replay.duration.toFixed(2)}s loop (${replay.config.mode})`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
