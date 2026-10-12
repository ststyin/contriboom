import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const directories: string[] = [];
const environment = { ...process.env, GITHUB_TOKEN: '', GH_TOKEN: '', CONTRIBOOM_USERNAME: '' };

async function directory() {
  const value = await mkdtemp(path.join(os.tmpdir(), 'contriboom-cli-test-'));
  directories.push(value);
  return value;
}
const run = (args: string[], env = environment) => execute(process.execPath, ['src/cli.ts', ...args], { cwd: root, env });

afterEach(async () => {
  for (const value of directories.splice(0)) await rm(value, { recursive: true, force: true });
});

describe('generation CLI', () => {
  it('generates a full calendar with automatic entry in clear and zero-bomb preview modes', async () => {
    const output = await directory();
    for (const mode of ['clear', 'preview']) {
      await run(['--fixture', 'full', '--mode', mode, '--max-bombs', '0', '--output', output]);
      const replay = JSON.parse(await readFile(path.join(output, 'replay.json'), 'utf8'));
      expect(replay.events[0]).toMatchObject({ type: 'entry' });
      expect(replay.events[0].cleared).toHaveLength(4);
      expect(replay.stats.totalBoxes).toBe(371);
      expect(replay.stats.contributions).toBe(replay.arena.tiles.reduce((sum: number, tile: { count: number }) => sum + tile.count, 0));
      expect(replay.stats.remaining).toBe(mode === 'clear' ? 0 : 367);
      if (mode === 'preview') expect(replay.stats.bombs).toBe(0);
      expect(await readFile(path.join(output, 'game.svg'), 'utf8')).toContain('id="entry-effect"');
      const staticSvg = await readFile(path.join(output, 'game-static.svg'), 'utf8');
      expect(staticSvg).not.toContain('<animate');
      expect([...staticSvg.matchAll(/data-cell=/g)]).toHaveLength(371);
    }
  });
  it('uses only a bomb budget for previews and rejects the removed duration option', async () => {
    const output = await directory();
    await run(['--fixture', 'demo', '--mode', 'preview', '--max-bombs', '20', '--output', output]);
    const replay = JSON.parse(await readFile(path.join(output, 'replay.json'), 'utf8'));
    expect(replay.stats.bombs).toBe(20);
    expect(replay.duration).toBeGreaterThan(22);
    expect(replay.config).not.toHaveProperty('maxDuration');
    const help = await run(['--help']);
    expect(help.stdout).not.toContain('--duration');
    await expect(run(['--duration', '22', '--output', output])).rejects.toMatchObject({
      stderr: expect.stringContaining('--duration'),
    });
  });
  it('generates offline with an explicit fixture even when a default GitHub account is configured', async () => {
    const output = await directory();
    await run(['--fixture', 'empty', '--output', output], { ...environment, CONTRIBOOM_USERNAME: 'octocat' });
    expect((await readdir(output)).sort()).toEqual([
      'contributions.json', 'game-static.svg', 'game.svg', 'replay.json',
    ]);
    const svg = await readFile(path.join(output, 'game.svg'), 'utf8');
    expect(svg).toContain('#eff2f5');
    expect(svg).not.toMatch(/<text\b|Contriboom|Make your contributions/);
    expect(svg).not.toMatch(/M1|FULL CLEAR|DEMO DATA|SHORT PREVIEW|blocks cleared/);
    expect(await readFile(path.join(output, 'game-static.svg'), 'utf8')).toContain('#eff2f5');
  });

  it('reuses exported contributions as local input with identical replay and SVG', async () => {
    const first = await directory();
    const second = await directory();
    await run(['--fixture', 'sparse', '--mode', 'preview', '--output', first]);
    await run(['--input', path.join(first, 'contributions.json'), '--mode', 'preview', '--output', second]);
    for (const name of ['replay.json', 'game.svg']) {
      expect(await readFile(path.join(second, name), 'utf8')).toBe(await readFile(path.join(first, name), 'utf8'));
    }
  });

  it.each([
    ['PNG', 'image/png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP438HwHwAGmAKHX+KYDQAAAABJRU5ErkJggg==', 'base64')],
    ['SVG', 'image/svg+xml', Buffer.from('<?xml version="1.0"?>\n<!-- custom artwork -->\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8" fill="red"/></svg>')],
  ])('embeds a local %s icon and keeps the replay and static calendar unchanged', async (_format, mime, bytes) => {
    const assets = await directory();
    const original = await directory();
    const customized = await directory();
    // The content determines the image type, regardless of the filename.
    const icon = path.join(assets, 'my icon.data');
    await writeFile(icon, bytes);
    const args = ['--fixture', 'sparse', '--mode', 'preview', '--theme', 'mint'];
    await run([...args, '--output', original]);
    await run([...args, '--player-icon', icon, '--output', customized]);
    const svg = await readFile(path.join(customized, 'game.svg'), 'utf8');
    expect(svg).toContain(`href="data:${mime};base64,${bytes.toString('base64')}"`);
    expect(svg).toContain('preserveAspectRatio="xMidYMid meet"');
    expect(svg).not.toContain('fill="#f4eee0"');
    expect(svg).not.toContain(icon);
    expect(svg).toContain('#EDF3F0');
    for (const name of ['replay.json', 'game-static.svg']) {
      expect(await readFile(path.join(customized, name), 'utf8')).toBe(await readFile(path.join(original, name), 'utf8'));
    }
  });

  it('rejects missing, unsupported, oversized or directory icons before reading contributions or writing output', async () => {
    const assets = await directory();
    const output = await directory();
    await writeFile(path.join(assets, 'invalid.png'), 'This is not an image');
    await writeFile(path.join(assets, 'large.png'), Buffer.alloc(2 * 1024 * 1024 + 1));
    for (const [icon, error] of [
      [path.join(assets, 'missing.png'), 'Cannot read player-icon file'],
      [path.join(assets, 'invalid.png'), 'Unsupported player-icon image'],
      [path.join(assets, 'large.png'), 'no larger than 2 MiB'],
      [assets, 'must be an image file'],
    ]) {
      await expect(run(['--player-icon', icon!, '--input', 'missing.json', '--output', output])).rejects.toMatchObject({
        stderr: expect.stringContaining(error!),
      });
    }
    expect(await readdir(output)).toEqual([]);
  });

  it('can preserve deliberate icon padding, and rejects unknown trim settings', async () => {
    const assets = await directory();
    const output = await directory();
    const icon = path.join(assets, 'padded.svg');
    await writeFile(icon, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect x="40" y="40" width="20" height="20" fill="red"/></svg>');
    const args = ['--fixture', 'sparse', '--mode', 'preview', '--player-icon', icon, '--output', output];
    await run(args);
    expect(await readFile(path.join(output, 'game.svg'), 'utf8')).toContain('viewBox="40 40 20 20"');
    await run([...args, '--player-icon-trim', 'none']);
    expect(await readFile(path.join(output, 'game.svg'), 'utf8')).not.toContain('viewBox="40 40 20 20"');
    await expect(run(['--player-icon-trim', 'invalid', '--input', 'missing.json', '--output', output])).rejects.toMatchObject({
      stderr: expect.stringContaining('Unknown player-icon-trim'),
    });
  });

  it.each([
    ['mint', '#EDF3F0'], ['light', '#e4e9dd'], ['dark', '#202b36'],
  ])('generates only the selected %s palette in animated and static output', async (theme, floor) => {
    const output = await directory();
    await run(['--fixture', 'sparse', '--mode', 'preview', '--theme', theme, '--output', output]);
    expect((await readdir(output)).filter(name => name.endsWith('.svg')).sort()).toEqual(['game-static.svg', 'game.svg']);
    for (const name of ['game.svg', 'game-static.svg']) {
      const svg = await readFile(path.join(output, name), 'utf8');
      expect(svg).toContain(floor);
    }
    expect(await readFile(path.join(output, 'game-static.svg'), 'utf8')).not.toContain('<animate');
  });

  it('rejects unknown palettes before reading input or writing artifacts', async () => {
    const output = await directory();
    for (const theme of ['unknown', '__proto__', 'toString']) {
      await expect(run(['--theme', theme, '--input', 'missing.json', '--output', output])).rejects.toMatchObject({
        stderr: expect.stringContaining('Unknown theme.'),
      });
    }
    expect(await readdir(output)).toEqual([]);
  });

  it('rejects conflicting sources and a year without an account before producing artifacts', async () => {
    const output = await directory();
    for (const args of [['--username', 'octocat', '--fixture', 'empty'], ['--input', 'missing.json', '--fixture', 'empty']]) {
      await expect(run([...args, '--output', output])).rejects.toMatchObject({ stderr: expect.stringContaining('Choose only one source') });
    }
    await expect(run(['--year', '2025', '--output', output])).rejects.toMatchObject({ stderr: expect.stringContaining('--year requires') });
    expect(await readdir(output)).toEqual([]);
  });

  it('fails an explicit GitHub source without a token instead of generating simulated data', async () => {
    const output = await directory();
    await expect(run(['--username', 'octocat', '--output', output])).rejects.toMatchObject({ stderr: expect.stringContaining('Set GITHUB_TOKEN or GH_TOKEN') });
    expect(await readdir(output)).toEqual([]);
  });

  it('defaults to range four and fading blocks, supports instant damage, and rejects unsupported modes', async () => {
    const output = await directory();
    await run(['--fixture', 'sparse', '--output', output]);
    const replay = JSON.parse(await readFile(path.join(output, 'replay.json'), 'utf8'));
    expect(replay.config).toMatchObject({ explosionRange: 4, blockDamage: 'fade' });
    expect(replay.stats.remaining).toBe(0);
    expect(await readFile(path.join(output, 'game.svg'), 'utf8')).toContain('attributeName="fill"');
    expect(await readFile(path.join(output, 'game-static.svg'), 'utf8')).not.toContain('<animate');
    await run(['--fixture', 'sparse', '--range', '10', '--block-damage', 'instant', '--output', output]);
    const instant = JSON.parse(await readFile(path.join(output, 'replay.json'), 'utf8'));
    expect(instant.config).toMatchObject({ explosionRange: 10, blockDamage: 'instant' });
    expect(await readFile(path.join(output, 'game.svg'), 'utf8')).not.toContain('attributeName="fill"');
    await expect(run(['--username', 'octocat', '--block-damage', 'invalid', '--output', output])).rejects.toMatchObject({ stderr: expect.stringContaining('Unknown block-damage') });
  });

  it('computes adaptive ranges from exported daily counts and records the calculation', async () => {
    const source = await directory();
    const output = await directory();
    await run(['--fixture', 'empty', '--output', source]);
    const days = JSON.parse(await readFile(path.join(source, 'contributions.json'), 'utf8'));
    for (let offset = 1; offset <= 7; offset++) days[days.length - 1 - offset] = { ...days[days.length - 1 - offset], count: 8, level: 3 };
    days[days.length - 1] = { ...days[days.length - 1], count: 1000, level: 4 };
    const input = path.join(source, 'activity.json');
    await writeFile(input, JSON.stringify(days));
    for (const [mode, range] of [['previous-day', 4], ['previous-week', 4], ['previous-month', 2]] as const) {
      await run(['--input', input, '--mode', 'preview', '--max-bombs', '0', '--range-mode', mode, '--output', output]);
      const replay = JSON.parse(await readFile(path.join(output, 'replay.json'), 'utf8'));
      expect(replay.config).toMatchObject({ explosionRange: range });
      expect(replay.config).not.toHaveProperty('explosionRangeMax');
      expect(replay.rangeCalculation).toMatchObject({ mode, range, configuredRange: 4, referenceDate: days.at(-1).date });
    }
    for (const args of [['--range-mode', 'unknown'], ['--range', '11'], ['--range', '0'], ['--range', '2.5'], ['--range-max', '4']]) {
      await expect(run(['--username', 'octocat', ...args, '--output', output])).rejects.toMatchObject({ stderr: expect.stringContaining('range') });
    }
  });
});
