import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { createTutor, TutorError } from './tutor.mjs';

const files = new Map([
  ['/', ['index.html', 'text/html']],
  ['/app.js', ['app.js', 'text/javascript']],
  ['/samples.js', ['samples.js', 'text/javascript']],
  ['/board-math.js', ['board-math.js', 'text/javascript']],
  ['/board-shapes.js', ['board-shapes.js', 'text/javascript']],
  ['/board-layout.js', ['board-layout.js', 'text/javascript']],
  ['/board.js', ['board.js', 'text/javascript']],
  ['/fonts/caveat.woff2', ['fonts/caveat.woff2', 'font/woff2', true]],
  ['/styles.css', ['styles.css', 'text/css']]
]);

function json(response, status, data) {
  if (response.destroyed) return;
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(data));
}

async function input(request) {
  if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
    throw new TutorError(415, 'Send JSON input.');
  }
  if (request.headers['sec-fetch-site'] === 'cross-site') throw new TutorError(403, 'Open the app directly.');
  const chunks = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > 128_000) {
      request.resume();
      throw new TutorError(413, 'The request is too large.');
    }
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object');
    return value;
  } catch {
    throw new TutorError(400, 'Send a valid JSON object.');
  }
}

export function createApp({ ollama = 'http://127.0.0.1:11434', gemini = null, fetchImpl = fetch } = {}) {
  const tutor = createTutor(ollama, fetchImpl, gemini);
  return createServer(async (request, response) => {
    const client = new AbortController();
    response.once('close', () => { if (!response.writableEnded) client.abort(); });
    try {
      const path = new URL(request.url, 'http://localhost').pathname;
      if (request.method === 'GET' && path === '/api/models') {
        try {
          return json(response, 200, { online: true, ...await tutor.models(client.signal) });
        } catch (error) {
          return json(response, 200, { online: false, models: [], message: error.message });
        }
      }
      if (request.method === 'POST' && path === '/api/outline') {
        return json(response, 200, await tutor.outline(await input(request), client.signal));
      }
      if (request.method === 'POST' && path === '/api/step') {
        return json(response, 200, await tutor.step(await input(request), client.signal));
      }
      if (request.method === 'POST' && path === '/api/followup') {
        return json(response, 200, await tutor.followup(await input(request), client.signal));
      }
      const file = request.method === 'GET' && files.get(path);
      if (!file) return json(response, 404, { error: 'Page not found.' });
      const [name, type, binary] = file;
      const content = await readFile(new URL('./public/' + name, import.meta.url));
      response.writeHead(200, {
        'Content-Type': binary ? type : type + '; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; base-uri 'none'; object-src 'none'"
      });
      return response.end(content);
    } catch (error) {
      if (client.signal.aborted) return;
      if (error instanceof TutorError) return json(response, error.status, { error: error.message });
      console.error(error);
      return json(response, 500, { error: 'The server could not complete the request.' });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({ options: {
    port: { type: 'string' }, host: { type: 'string' }, strictPort: { type: 'boolean' }
  } });
  const port = Number(values.port ?? process.env.PORT ?? 5173);
  const host = values.host ?? process.env.HOST ?? '127.0.0.1';
  const gemini = process.env.GEMINI_API_KEY ? {
    key: process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite'
  } : null;
  const server = createApp({ ollama: process.env.TUTOR_OLLAMA_URL, gemini });
  server.listen(port, host, () => {
    const shownHost = host === '0.0.0.0' ? '127.0.0.1' : host;
    console.log('Slate Tutor is running at http://' + shownHost + ':' + server.address().port);
  });
}
