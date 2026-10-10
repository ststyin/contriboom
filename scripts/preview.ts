import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const files = new Map([
  ['/', ['preview.html', 'text/html; charset=utf-8']],
  ['/preview.html', ['preview.html', 'text/html; charset=utf-8']],
  ['/artifacts/game.svg', ['artifacts/game.svg', 'image/svg+xml']],
  ['/artifacts/game-dark.svg', ['artifacts/game-dark.svg', 'image/svg+xml']],
  ['/artifacts/game-light.svg', ['artifacts/game-light.svg', 'image/svg+xml']],
  ['/artifacts/game-static.svg', ['artifacts/game-static.svg', 'image/svg+xml']],
  ['/artifacts/replay.json', ['artifacts/replay.json', 'application/json']],
]);
const server = createServer(async (request, response) => {
  const file = files.get(new URL(request.url ?? '/', 'http://localhost').pathname);
  if (!file || !['GET', 'HEAD'].includes(request.method ?? 'GET')) {
    response.writeHead(404).end('Not found');
    return;
  }
  try {
    const body = await readFile(path.join(root, file[0]!));
    response.writeHead(200, { 'Content-Type': file[1]!, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch {
    response.writeHead(404).end('Run npm run generate first.');
  }
});
server.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
server.listen(4173, '127.0.0.1', () => console.log('Contriboom preview: http://127.0.0.1:4173\nPress Ctrl+C to stop.'));
