import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { loadPlayerIcon } from '../src/renderer/player-icon.ts';
import { renderSvg } from '../src/renderer/svg.ts';
import { createArena } from '../src/engine/map.ts';
import { simulate } from '../src/engine/simulator.ts';
import { mockContributions } from '../src/fixtures/contributions.ts';

const directories: string[] = [];
async function save(bytes: Buffer): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'contriboom-icon-test-'));
  directories.push(directory);
  const filename = path.join(directory, 'icon');
  await writeFile(filename, bytes);
  return filename;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

describe('player icon margins', () => {
  it.each(['png', 'jpeg', 'webp'] as const)('fits the character instead of near-white padding in %s images', async format => {
    const bytes = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80"><rect width="100" height="80" fill="#fafafa"/><rect x="35" y="25" width="30" height="30" fill="#000"/><rect x="45" y="35" width="10" height="10" fill="#fff"/></svg>'))
      .toFormat(format).toBuffer();
    const filename = await save(bytes);
    const icon = await loadPlayerIcon(filename);
    expect(icon.crop).toMatchObject({ imageWidth: 100, imageHeight: 80 });
    expect(icon.crop!.left).toBeGreaterThanOrEqual(30);
    expect(icon.crop!.top).toBeGreaterThanOrEqual(20);
    expect(icon.crop!.left).toBeLessThanOrEqual(35);
    expect(icon.crop!.top).toBeLessThanOrEqual(25);
    expect(icon.crop!.width).toBeLessThanOrEqual(40);
    expect(icon.crop!.height).toBeLessThanOrEqual(40);
    expect(Buffer.from(icon.dataUri.split(',')[1]!, 'base64')).toEqual(bytes);
    expect(await readFile(filename)).toEqual(bytes);
  });

  it('trims transparent margins while preserving white body parts', async () => {
    const bytes = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80"><rect x="20" y="30" width="60" height="20" fill="#fff"/><rect x="40" y="35" width="20" height="10" fill="#000"/></svg>')).png().toBuffer();
    expect((await loadPlayerIcon(await save(bytes))).crop).toEqual({ left: 20, top: 30, width: 60, height: 20, imageWidth: 100, imageHeight: 80 });
  });

  it.each(['white', 'transparent', 'colored'] as const)('keeps the canvas for %s images with nothing to trim', async kind => {
    const bytes = await sharp({ create: { width: 40, height: 20, channels: 4,
      background: kind === 'white' ? '#fff' : kind === 'colored' ? '#369' : { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    expect((await loadPlayerIcon(await save(bytes))).crop).toBeUndefined();
  });

  it.each(['gif', 'webp'] as const)('uses all %s animation frames, preserving frame data and timing', async format => {
    const pixels = Buffer.alloc(30 * 20 * 2 * 4);
    for (const [frame, left, top, width, height] of [[0, 2, 4, 5, 6], [1, 20, 12, 8, 7]]) {
      for (let y = top!; y < top! + height!; y++) for (let x = left!; x < left! + width!; x++) {
        const offset = ((frame! * 20 + y) * 30 + x) * 4;
        pixels[offset] = 255;
        pixels[offset + 3] = 255;
      }
    }
    const bytes = await sharp(pixels, { raw: { width: 30, height: 40, channels: 4, pageHeight: 20 } })
      .toFormat(format, { delay: [100, 200], loop: 2, lossless: true }).toBuffer();
    const icon = await loadPlayerIcon(await save(bytes));
    expect(icon.crop).toEqual({ left: 2, top: 4, width: 26, height: 15, imageWidth: 30, imageHeight: 20 });
    expect(Buffer.from(icon.dataUri.split(',')[1]!, 'base64')).toEqual(bytes);
    expect(await sharp(bytes, { animated: true }).metadata()).toMatchObject({ pages: 2, delay: [100, 200], loop: 2 });
  });

  it('can bypass decoding for disabled trimming and fails oversized decoded images with a useful error', async () => {
    const bytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100000" height="100000"><rect width="100000" height="100000" fill="red"/></svg>');
    const filename = await save(bytes);
    await expect(loadPlayerIcon(filename)).rejects.toThrow('Cannot process player-icon');
    expect(await loadPlayerIcon(filename, 'none')).toEqual({ dataUri: `data:image/svg+xml;base64,${bytes.toString('base64')}` });
  });

  it('clips padding outside a tall character rather than filling the letterbox with white', async () => {
    const bytes = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#fff"/><rect x="40" y="30" width="20" height="40" fill="red"/></svg>')).png().toBuffer();
    const playerIcon = await loadPlayerIcon(await save(bytes));
    const svg = renderSvg(simulate(createArena(mockContributions(42, 'sparse')), { mode: 'preview' }), { playerIcon });
    const artwork = svg.match(/<g id="robot">([\s\S]*?)<\/g>/)![1];
    const { data, info } = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><g transform="translate(10 10)">${artwork}</g></svg>`))
      .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(data[3]).toBe(0);
    expect(data[(10 * info.width + 10) * 4]).toBe(255);
    expect(data[(10 * info.width + 10) * 4 + 3]).toBe(255);
  });
});
