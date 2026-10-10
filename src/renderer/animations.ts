export type Frame = readonly [time: number, value: string | number];

export function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!);
}

const number = (value: number): string => String(Number(value.toFixed(6)));

/** Every animated attribute uses a complete, identical round period. */
export function animation(attribute: string, frames: readonly Frame[], duration: number, mode: 'linear' | 'discrete' = 'discrete', transform = false): string {
  const unique = new Map<number, string | number>();
  for (const [time, value] of frames) {
    const normalized = Number((Math.max(0, Math.min(duration, time)) / duration).toFixed(6));
    unique.set(normalized, value);
  }
  const ordered = [...unique.entries()].sort((a, b) => a[0] - b[0]);
  if (ordered[0]![0] > 0) ordered.unshift([0, ordered[0]![1]]);
  if (ordered.at(-1)![0] < 1) ordered.push([1, ordered.at(-1)![1]]);
  const tag = transform ? 'animateTransform' : 'animate';
  return `<${tag} attributeName="${attribute}"${transform ? ' type="translate"' : ''} dur="${number(duration)}s" repeatCount="indefinite" calcMode="${mode}" keyTimes="${ordered.map(([time]) => number(time)).join(';')}" values="${ordered.map(([, value]) => escapeXml(String(value))).join(';')}"/>`;
}

export function visibleBetween(begin: number, end: number, duration: number): string {
  return animation('opacity', [[0, 0], [begin, 1], [end, 0], [duration, 0]], duration);
}
