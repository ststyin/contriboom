import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
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
  it('generates offline with an explicit fixture even when a default GitHub account is configured', async () => {
    const output = await directory();
    await run(['--fixture', 'empty', '--output', output], { ...environment, CONTRIBOOM_USERNAME: 'octocat' });
    expect((await readdir(output)).sort()).toEqual([
      'contributions.json', 'game-dark.svg', 'game-light.svg', 'game-static.svg', 'game.svg', 'replay.json',
    ]);
    const svg = await readFile(path.join(output, 'game.svg'), 'utf8');
    expect(svg).toContain('#e4e9dd');
    expect(svg).not.toMatch(/<text\b|Contriboom|Make your contributions/);
    expect(svg).not.toMatch(/M1|FULL CLEAR|DEMO DATA|SHORT PREVIEW|blocks cleared/);
    expect(await readFile(path.join(output, 'game-light.svg'), 'utf8')).toBe(svg);
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
});
