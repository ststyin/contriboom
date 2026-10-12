import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const execute = promisify(execFile);
const action = fileURLToPath(new URL('../scripts/action.ts', import.meta.url));
const directories: string[] = [];

async function workspace() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'contriboom-action-'));
  directories.push(directory);
  const outputFile = path.join(directory, 'github-output');
  const preload = path.join(directory, 'github-mock.mjs');
  await writeFile(outputFile, '');
  // Run the real Action entry point and CLI with only the HTTP boundary mocked.
  await writeFile(preload, `
    const weeks = [];
    let totalContributions = 0;
    for (let time = Date.UTC(2025, 0, 1), index = 0; time <= Date.UTC(2025, 11, 31); time += 86400000, index++) {
      const date = new Date(time).toISOString().slice(0, 10);
      const weekday = new Date(time).getUTCDay();
      if (weekday === 0 || weeks.length === 0) weeks.push({ firstDay: date, contributionDays: [] });
      const contributionCount = index % 14 === 0 ? 3 : 0;
      totalContributions += contributionCount;
      weeks.at(-1).contributionDays.push({ date, weekday, contributionCount,
        contributionLevel: contributionCount ? 'FIRST_QUARTILE' : 'NONE' });
    }
    globalThis.fetch = async (url, request) => {
      if (url !== 'https://api.github.com/graphql') throw new Error('Unexpected URL');
      if (request.headers.Authorization !== 'Bearer action-test-token') throw new Error('Incorrect token');
      const { variables } = JSON.parse(request.body);
      if (variables.login !== 'octocat' || variables.from !== '2025-01-01T00:00:00.000Z') throw new Error('Incorrect query');
      if (process.env.CONTRIBOOM_TEST_FAIL === '1') return Response.json({}, { status: 401 });
      return Response.json({ data: { user: { login: 'octocat', contributionsCollection: {
        contributionCalendar: { weeks, totalContributions }
      } } } });
    };
  `);
  const env = {
    ...process.env,
    GITHUB_TOKEN: '', GH_TOKEN: '', CONTRIBOOM_USERNAME: '',
    GITHUB_WORKSPACE: directory, GITHUB_OUTPUT: outputFile,
    CONTRIBOOM_INPUT_USERNAME: 'octocat', CONTRIBOOM_INPUT_TOKEN: 'action-test-token',
    CONTRIBOOM_INPUT_YEAR: '2025', CONTRIBOOM_INPUT_OUTPUT: 'images with spaces/contriboom',
    CONTRIBOOM_INPUT_MODE: 'preview', CONTRIBOOM_INPUT_SEED: '71',
    CONTRIBOOM_INPUT_RANGE: '2', CONTRIBOOM_INPUT_MAX_BOMBS: '2',
    NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`,
  };
  return { directory, outputFile, env, run: (overrides: Record<string, string> = {}) =>
    execute(process.execPath, [action], { cwd: directory, env: { ...env, ...overrides } }) };
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

describe('GitHub Action entry point', () => {
  it('generates in the caller workspace, forwards settings and emits usable absolute paths', async () => {
    const context = await workspace();
    const icon = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP438HwHwAGmAKHX+KYDQAAAABJRU5ErkJggg==', 'base64');
    await mkdir(path.join(context.directory, 'my assets'));
    const iconPath = "my assets/player 'icon'.png";
    await writeFile(path.join(context.directory, iconPath), icon);
    const { stdout } = await context.run({ CONTRIBOOM_INPUT_THEME: 'lavender', CONTRIBOOM_INPUT_PLAYER_ICON: iconPath, CONTRIBOOM_INPUT_BLOCK_DAMAGE: 'instant' });
    const outputs = Object.fromEntries((await readFile(context.outputFile, 'utf8')).trim().split('\n').map(line => {
      const separator = line.indexOf('=');
      return [line.slice(0, separator), line.slice(separator + 1)];
    }));
    expect(outputs['output-dir']).toBe(path.join(context.directory, 'images with spaces/contriboom'));
    expect(Object.keys(outputs).sort()).toEqual(['output-dir', 'svg', 'svg-static']);
    for (const name of ['svg', 'svg-static']) {
      expect(path.isAbsolute(outputs[name]!)).toBe(true);
      expect(await readFile(outputs[name]!, 'utf8')).toContain('<svg');
    }
    expect(await readFile(outputs['svg-static']!, 'utf8')).not.toContain('<animate');
    expect(await readFile(outputs.svg!, 'utf8')).toContain('#F2EFF5');
    expect(await readFile(outputs.svg!, 'utf8')).toContain(`href="data:image/png;base64,${icon.toString('base64')}"`);
    expect(await readFile(outputs['svg-static']!, 'utf8')).not.toContain('<image');
    expect(await readFile(outputs['svg-static']!, 'utf8')).toContain('#F2EFF5');
    expect((await readdir(outputs['output-dir']!)).filter(name => name.endsWith('.svg')).sort()).toEqual(['game-static.svg', 'game.svg']);
    const replay = JSON.parse(await readFile(path.join(outputs['output-dir']!, 'replay.json'), 'utf8'));
    expect(replay.config).toMatchObject({ mode: 'preview', seed: 71, explosionRange: 2, blockDamage: 'instant', maxBombs: 2 });
    expect(replay.config).not.toHaveProperty('maxDuration');
    expect(replay.stats.bombs).toBe(2);
    expect(stdout).not.toContain(context.env.CONTRIBOOM_INPUT_TOKEN);
    expect(await readdir(context.directory)).not.toContain('.cache');
  });

  it('defaults to a complete clear, the GitHub palette and the artifacts directory', async () => {
    const context = await workspace();
    await context.run({ CONTRIBOOM_INPUT_OUTPUT: '', CONTRIBOOM_INPUT_MODE: '', CONTRIBOOM_INPUT_SEED: '', CONTRIBOOM_INPUT_RANGE: '', CONTRIBOOM_INPUT_BLOCK_DAMAGE: '' });
    const replay = JSON.parse(await readFile(path.join(context.directory, 'artifacts/replay.json'), 'utf8'));
    expect(replay.stats.remaining).toBe(0);
    expect(replay.stats.destroyed).toBe(replay.stats.totalBoxes);
    expect(replay.config).toMatchObject({ mode: 'clear', seed: 42, explosionRange: 4, blockDamage: 'fade' });
    expect(replay.config).not.toHaveProperty('explosionRangeMax');
    const output = path.join(context.directory, 'artifacts');
    for (const name of ['game.svg', 'game-static.svg']) {
      const svg = await readFile(path.join(output, name), 'utf8');
      expect(svg).toContain('#eff2f5');
      expect(svg).toContain('#aceebb');
    }
    expect((await readdir(output)).filter(name => name.endsWith('.svg')).sort()).toEqual(['game-static.svg', 'game.svg']);
  });

  it('fails without output paths when required credentials or generation fail', async () => {
    const context = await workspace();
    const failures: Record<string, string>[] = [
      { CONTRIBOOM_INPUT_USERNAME: '' }, { CONTRIBOOM_INPUT_TOKEN: '' }, { CONTRIBOOM_TEST_FAIL: '1' },
    ];
    for (const overrides of failures) {
      await expect(context.run(overrides)).rejects.toMatchObject({ code: 1 });
      expect(await readFile(context.outputFile, 'utf8')).toBe('');
    }
    expect(await readdir(context.directory)).not.toContain('images with spaces');
  });

  it('rejects workspace escapes and newlines in output paths before generating', async () => {
    const context = await workspace();
    for (const output of ['..', '../outside', context.directory, 'images\nsvg=injected', 'images\rsvg=injected']) {
      await expect(context.run({ CONTRIBOOM_INPUT_OUTPUT: output })).rejects.toMatchObject({
        stderr: expect.stringContaining('output-dir must be a directory inside the workspace'),
      });
    }
    expect(await readFile(context.outputFile, 'utf8')).toBe('');
  });

  it('rejects icons outside the caller repository, including symlink escapes', async () => {
    const context = await workspace();
    const other = await workspace();
    const external = path.join(other.directory, 'github-mock.mjs');
    await symlink(external, path.join(context.directory, 'outside.png'));
    for (const icon of [external, path.relative(context.directory, external), 'outside.png']) {
      await expect(context.run({ CONTRIBOOM_INPUT_PLAYER_ICON: icon })).rejects.toMatchObject({
        stderr: expect.stringContaining('player-icon must be a file inside the caller workspace'),
      });
    }
    await expect(context.run({ CONTRIBOOM_INPUT_PLAYER_ICON: 'missing.png' })).rejects.toMatchObject({
      stderr: expect.stringContaining('Cannot read player-icon file'),
    });
    expect(await readFile(context.outputFile, 'utf8')).toBe('');
    expect(await readdir(context.directory)).not.toContain('images with spaces');
  });

  it('forwards the icon trim setting from the workflow', async () => {
    const context = await workspace();
    await writeFile(path.join(context.directory, 'padded.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect x="40" y="40" width="20" height="20" fill="red"/></svg>');
    await context.run({ CONTRIBOOM_INPUT_PLAYER_ICON: 'padded.svg' });
    const output = path.join(context.directory, 'images with spaces/contriboom/game.svg');
    expect(await readFile(output, 'utf8')).toContain('viewBox="40 40 20 20"');
    await context.run({ CONTRIBOOM_INPUT_PLAYER_ICON: 'padded.svg', CONTRIBOOM_INPUT_PLAYER_ICON_TRIM: 'none' });
    expect(await readFile(output, 'utf8')).not.toContain('viewBox="40 40 20 20"');
  });

  it('calculates adaptive ranges from real queried dates, ignoring year padding and today', async () => {
    const context = await workspace();
    const preload = path.join(context.directory, 'github-mock.mjs');
    await writeFile(preload, (await readFile(preload, 'utf8')).replace(
      'index % 14 === 0 ? 3 : 0', 'index >= 357 && index < 364 ? 8 : index === 364 ? 200 : 0',
    ));
    for (const [mode, configuredRange, range] of [['previous-day', '', 4], ['previous-week', '2', 2], ['previous-month', '6', 2]] as const) {
      const { stdout } = await context.run({ CONTRIBOOM_INPUT_MODE: 'clear', CONTRIBOOM_INPUT_RANGE_MODE: mode, CONTRIBOOM_INPUT_RANGE: configuredRange });
      const replay = JSON.parse(await readFile(path.join(context.directory, 'images with spaces/contriboom/replay.json'), 'utf8'));
      expect(replay.config).toMatchObject({ explosionRange: range, blockDamage: 'fade' });
      expect(replay.config).not.toHaveProperty('explosionRangeMax');
      expect(replay.rangeCalculation).toMatchObject({ referenceDate: '2025-12-31', to: '2025-12-30', mode, range, configuredRange: Number(configuredRange || 4) });
      expect(stdout).toContain(`Explosion range: ${range}`);
      expect(await readFile(path.join(context.directory, 'images with spaces/contriboom/game.svg'), 'utf8')).toContain('attributeName="fill"');
    }
  });

  it('passes untrusted inputs as arguments instead of executing shell commands', async () => {
    const context = await workspace();
    await expect(context.run({ CONTRIBOOM_INPUT_USERNAME: 'octocat; touch injected' })).rejects.toMatchObject({
      stderr: expect.stringContaining('Invalid GitHub username'),
    });
    expect(await readdir(context.directory)).not.toContain('injected');
    expect(await readFile(context.outputFile, 'utf8')).toBe('');
  });
});

describe('profile publication example', () => {
  it('commits only SVGs, preserves the README and skips a second unchanged update', async () => {
    const context = await workspace();
    await context.run();
    const remote = path.join(context.directory, 'remote.git');
    const repository = path.join(context.directory, 'profile');
    await execute('git', ['init', '--bare', remote]);
    await execute('git', ['clone', remote, repository]);
    const git = (args: string[]) => execute('git', args, { cwd: repository });
    await git(['config', 'user.name', 'Profile test']);
    await git(['config', 'user.email', 'profile-test@example.com']);
    await writeFile(path.join(repository, 'README.md'), 'My existing profile\n');
    await git(['add', 'README.md']);
    await git(['commit', '-m', 'Initial profile']);
    await git(['push', '-u', 'origin', 'HEAD']);
    const directory = path.join(repository, 'images/contriboom');
    await mkdir(directory, { recursive: true });
    for (const file of await readdir(path.join(context.directory, 'images with spaces/contriboom'))) {
      await writeFile(path.join(directory, file), await readFile(path.join(context.directory, 'images with spaces/contriboom', file)));
    }
    const template = await readFile(new URL('../examples/profile.yml', import.meta.url), 'utf8');
    const script = template.slice(template.indexOf('        run: |\n') + '        run: |\n'.length)
      .split('\n').map(line => line.slice(10)).join('\n');
    const publish = () => execute('bash', ['-e', '-o', 'pipefail', '-c', script], {
      cwd: repository, env: { ...process.env,
        SVG: path.join(directory, 'game.svg'), SVG_STATIC: path.join(directory, 'game-static.svg'),
      },
    });
    await publish();
    const head = (await git(['rev-parse', 'HEAD'])).stdout;
    expect((await git(['show', '--pretty=format:', '--name-only', 'HEAD'])).stdout.trim().split('\n')).toEqual([
      'images/contriboom/game-static.svg', 'images/contriboom/game.svg',
    ]);
    expect(await readFile(path.join(repository, 'README.md'), 'utf8')).toBe('My existing profile\n');
    expect((await publish()).stdout).toContain('Contribution images are unchanged.');
    expect((await git(['rev-parse', 'HEAD'])).stdout).toBe(head);
    expect((await execute('git', ['rev-parse', 'HEAD'], { cwd: remote })).stdout).toBe(head);
  });
});
