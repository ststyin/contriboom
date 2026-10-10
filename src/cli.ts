import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import path from 'node:path';
import { createArena } from './engine/map.ts';
import { simulate } from './engine/simulator.ts';
import { mockContributions } from './fixtures/contributions.ts';
import type { Fixture } from './fixtures/contributions.ts';
import type { Contribution } from './engine/types.ts';
import { renderSvg } from './renderer/svg.ts';

async function main(): Promise<void> {
  const { values } = parseArgs({ options: {
    seed: { type: 'string', default: '42' },
    fixture: { type: 'string', default: 'demo' },
    input: { type: 'string' },
    output: { type: 'string', default: 'artifacts' },
    mode: { type: 'string', default: 'clear' },
    'max-bombs': { type: 'string', default: '5' },
    range: { type: 'string', default: '3' },
    duration: { type: 'string', default: '22' },
    help: { type: 'boolean', default: false },
  } });
  if (values.help) {
    console.log('Contriboom — Make your contributions a blast.\n\n' +
      'npm run generate -- [--seed 42] [--fixture demo|empty|full|sparse]\n' +
      '                    [--input contributions.json] [--output artifacts]\n' +
      '                    [--mode clear|preview] [--range 3]\n' +
      '                    [--max-bombs 5] [--duration 22] (preview only)\n\n' +
      'JSON input: a column-major array of 53 × 7 { date, count, level } days.\n' +
      'No GitHub token or network connection is needed.');
    return;
  }
  if (!['demo', 'empty', 'full', 'sparse'].includes(values.fixture!)) throw new Error('Unknown fixture.');
  if (!['clear', 'preview'].includes(values.mode!)) throw new Error('Unknown mode. Choose clear or preview.');
  const seed = Number(values.seed);
  const data: Contribution[] = values.input
    ? JSON.parse(await readFile(values.input, 'utf8')) as Contribution[]
    : mockContributions(seed, values.fixture as Fixture);
  if (!Array.isArray(data)) throw new Error('Input must be an array of contribution days.');
  const arena = createArena(data);
  const replay = simulate(arena, {
    seed, mode: values.mode as 'clear' | 'preview', maxBombs: Number(values['max-bombs']),
    explosionRange: Number(values.range), maxDuration: Number(values.duration),
  });
  const output = path.resolve(values.output!);
  await mkdir(output, { recursive: true });
  const label = values.input ? 'LOCAL CONTRIBUTION DATA' : `${values.fixture!.toUpperCase()} DATA`;
  await Promise.all([
    writeFile(path.join(output, 'game.svg'), renderSvg(replay, { theme: 'dark', label })),
    writeFile(path.join(output, 'game-light.svg'), renderSvg(replay, { theme: 'light', label })),
    writeFile(path.join(output, 'game-static.svg'), renderSvg(replay, { theme: 'dark', label, animated: false })),
    writeFile(path.join(output, 'replay.json'), JSON.stringify(replay, null, 2) + '\n'),
  ]);
  console.log(`Generated ${output}\n${replay.stats.bombs} bombs · ${replay.stats.destroyed}/${replay.stats.totalBoxes} blocks cleared · ${replay.duration.toFixed(2)}s loop (${replay.config.mode})`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
