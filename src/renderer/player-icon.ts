import { open } from 'node:fs/promises';

const MAX_ICON_BYTES = 2 * 1024 * 1024;

export type PlayerIconTrim = 'auto' | 'none';
export interface PlayerIcon {
  dataUri: string;
  crop?: { left: number; top: number; width: number; height: number; imageWidth: number; imageHeight: number };
}

/** Measure the visible bounds without changing source pixels or animation frames. */
async function measureCrop(bytes: Buffer): Promise<PlayerIcon['crop']> {
  const { default: sharp } = await import('sharp');
  const image = sharp(bytes, { animated: true, limitInputPixels: 16 * 1024 * 1024 });
  const metadata = await image.metadata();
  const { data, info } = await image.autoOrient().toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const width = info.width;
  const height = info.height / (metadata.pages ?? 1);
  // White artwork on a transparent background is foreground, not white padding.
  let transparentBorder = false;
  for (let y = 0; y < info.height && !transparentBorder; y++) {
    for (let x = 0; x < width; x++) {
      if ((x === 0 || x === width - 1 || y % height === 0 || y % height === height - 1) && data[(y * width + x) * 4 + 3]! <= 8) {
        transparentBorder = true;
        break;
      }
    }
  }
  let left = width, top = height, right = -1, bottom = -1;
  // Animated GIF/WebP frames share one crop that contains artwork from every frame.
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      if (data[offset + 3]! <= 8) continue;
      if (!transparentBorder && data[offset]! >= 245 && data[offset + 1]! >= 245 && data[offset + 2]! >= 245) continue;
      left = Math.min(left, x);
      top = Math.min(top, y % height);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y % height);
    }
  }
  // Blank images and images that already fill their canvas keep the original view.
  if (right < left || (left === 0 && top === 0 && right === width - 1 && bottom === height - 1)) return undefined;
  return { left, top, width: right - left + 1, height: bottom - top + 1, imageWidth: width, imageHeight: height };
}

/** Load local artwork once, so the generated SVG needs no external image files. */
export async function loadPlayerIcon(filename: string, trim: PlayerIconTrim = 'auto'): Promise<PlayerIcon> {
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
    const dataUri = `data:${mime};base64,${bytes.toString('base64')}`;
    if (trim === 'none') return { dataUri };
    try {
      return { dataUri, crop: await measureCrop(bytes) };
    } catch (error) {
      throw new Error(`Cannot process player-icon: ${error instanceof Error ? error.message : String(error)}. Use --player-icon-trim none to embed it without trimming.`);
    }
  } finally {
    await file.close();
  }
}
