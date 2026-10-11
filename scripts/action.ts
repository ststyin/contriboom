import { execFileSync } from 'node:child_process';
import { appendFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_THEME } from '../src/renderer/themes.ts';
import { DEFAULT_RANGE } from '../src/engine/range.ts';
import { DEFAULT_CONFIG } from '../src/engine/simulator.ts';

async function main(): Promise<void> {
  const username = process.env.CONTRIBOOM_INPUT_USERNAME?.trim();
  const token = process.env.CONTRIBOOM_INPUT_TOKEN?.trim();
  if (!username) throw new Error('The username input is required.');
  if (!token) throw new Error('The github-token input is required to read contributions.');
  const workspace = process.env.GITHUB_WORKSPACE;
  const outputFile = process.env.GITHUB_OUTPUT;
  if (!workspace || !outputFile) throw new Error('Missing GitHub Actions workspace or output file.');

  const output = path.resolve(workspace, process.env.CONTRIBOOM_INPUT_OUTPUT || 'artifacts');
  const relative = path.relative(workspace, output);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || /[\r\n]/.test(output)) {
    throw new Error('output-dir must be a directory inside the workspace.');
  }
  const args = [fileURLToPath(new URL('../src/cli.ts', import.meta.url)), '--username', username, '--output', output, '--no-cache'];
  const playerIcon = process.env.CONTRIBOOM_INPUT_PLAYER_ICON;
  if (playerIcon) {
    const iconPath = await realpath(path.resolve(workspace, playerIcon)).catch(() => {
      throw new Error(`Cannot read player-icon file: ${playerIcon}`);
    });
    const iconRelative = path.relative(await realpath(workspace), iconPath);
    if (iconRelative === '..' || iconRelative.startsWith(`..${path.sep}`) || path.isAbsolute(iconRelative)) {
      throw new Error('player-icon must be a file inside the caller workspace.');
    }
    args.push('--player-icon', iconPath);
  }
  for (const [input, flag, fallback] of [
    ['YEAR', 'year', ''], ['MODE', 'mode', 'clear'], ['SEED', 'seed', '42'], ['THEME', 'theme', DEFAULT_THEME],
    ['PLAYER_ICON_TRIM', 'player-icon-trim', 'auto'],
    ['BLOCK_DAMAGE', 'block-damage', DEFAULT_CONFIG.blockDamage],
    ['RANGE_MODE', 'range-mode', 'fixed'],
    ['RANGE', 'range', String(DEFAULT_RANGE)], ['MAX_BOMBS', 'max-bombs', '5'], ['DURATION', 'duration', '22'],
  ] as const) {
    const value = process.env[`CONTRIBOOM_INPUT_${input}`] ?? fallback;
    if (value) args.push(`--${flag}`, value);
  }
  // Pass each input as one argument; credentials never appear on the command line.
  try {
    execFileSync(process.execPath, args, {
      cwd: workspace, stdio: 'inherit', env: { ...process.env, GITHUB_TOKEN: token },
    });
  } catch {
    throw new Error('Contribution generation failed. See the preceding CLI error.');
  }

  const outputs = {
    'output-dir': output,
    svg: path.join(output, 'game.svg'),
    'svg-static': path.join(output, 'game-static.svg'),
  };
  await appendFile(outputFile, Object.entries(outputs).map(([name, value]) => `${name}=${value}\n`).join(''));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
