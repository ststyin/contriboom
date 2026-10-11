import { open } from 'node:fs/promises';

const MAX_ICON_BYTES = 2 * 1024 * 1024;

/** Load local artwork once, so the generated SVG needs no external image files. */
export async function loadPlayerIcon(filename: string): Promise<string> {
  const file = await open(filename, 'r').catch(() => {
    throw new Error(`Cannot read player-icon file: ${filename}`);
  });
  try {
    const info = await file.stat();
    if (!info.isFile()) throw new Error('player-icon must be an image file.');
    if (info.size > MAX_ICON_BYTES) throw new Error('player-icon must be no larger than 2 MiB.');
    const bytes = await file.readFile();
    let mime: string;
    if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) mime = 'image/png';
    else if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) mime = 'image/jpeg';
    else if (/^GIF8[79]a$/.test(bytes.toString('ascii', 0, 6))) mime = 'image/gif';
    else if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') mime = 'image/webp';
    else if (/^\s*(?:<\?xml[^?]*\?>\s*|<!--[\s\S]*?-->\s*)*<svg\b/.test(bytes.toString('utf8').replace(/^\uFEFF/, ''))) mime = 'image/svg+xml';
    else throw new Error('Unsupported player-icon image. Use PNG, JPEG, GIF, WebP, or SVG.');
    return `data:${mime};base64,${bytes.toString('base64')}`;
  } finally {
    await file.close();
  }
}
