import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { createApp } from './server.mjs';

async function start(server, t) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return 'http://127.0.0.1:' + server.address().port;
}

const shapeFields = ['kind', 'id', 'at', 'w', 'h', 'r', 'text', 'label', 'size', 'align', 'from', 'fromId', 'to', 'toId',
  'dashed', 'axes', 'fn', 'domain', 'xRange', 'yRange', 'xLabel', 'yLabel', 'target'];
const raw = (values) => ({ ...Object.fromEntries(shapeFields.map((name) => [name, null])), ...values });

const sampleOutline = { title: 'RC delay', steps: [
  { heading: 'Intuition', goal: 'Why charging takes time' },
  { heading: 'Mechanism', goal: 'The exponential curve' },
  { heading: 'Example', goal: 'Compute τ for 1 kΩ, 1 mF' }] };
const sampleStep = { heading: 'The charging curve', beats: [
  { say: 'Here is the voltage over time.', draw: [raw({ kind: 'axes', id: 'a', at: [1, 1], w: 8, h: 6, xRange: [0, 5], yRange: [0, 1], xLabel: 't', yLabel: 'V' })] },
  { say: 'It rises quickly, then levels off.', draw: [raw({ kind: 'plot', axes: 'a', fn: '1-exp(-x)', label: 'charging' })] }] };
const userModel = { model: 'test-model:7b' };

const post = (base, endpoint, body) => fetch(base + endpoint, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

async function fixture(t, chooseAnswer) {
  const messages = [];
  const model = createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/api/tags') return response.end(JSON.stringify({ models: [{ name: userModel.model }] }));
    let rawBody = '';
    for await (const chunk of request) rawBody += chunk;
    const payload = JSON.parse(rawBody);
    messages.push(payload);
    const data = await chooseAnswer(payload);
    return response.end(JSON.stringify({ message: { content: JSON.stringify(data) } }));
  });
  const url = await start(model, t);
  const base = await start(createApp({ ollama: url }), t);
  return { base, messages };
}

test('serves the web app, static scripts and the installed model list', async (t) => {
  const { base } = await fixture(t, () => sampleOutline);
  assert.match(await (await fetch(base)).text(), /What do you want/);
  assert.equal((await fetch(base + '/app.js')).status, 200);
  assert.deepEqual(await (await fetch(base + '/api/models')).json(), {
    online: true, models: [userModel.model]
  });
});

test('serves the board modules and the handwriting font', async (t) => {
  const { base } = await fixture(t, () => sampleOutline);
  for (const path of ['/board-math.js', '/board-shapes.js', '/board-layout.js', '/board.js']) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get('content-type'), 'text/javascript; charset=utf-8', path);
  }
  const font = await fetch(base + '/fonts/caveat.woff2');
  assert.equal(font.status, 200);
  assert.match(font.headers.get('content-type'), /^font\/woff2$/);
  const bytes = new Uint8Array(await font.arrayBuffer());
  assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), 'wOF2');
});

test('outline request is schema-constrained and passes topic, notes and level', async (t) => {
  const { base, messages } = await fixture(t, () => sampleOutline);
  const input = { ...userModel, topic: 'How does an RC circuit delay a signal?', notes: 'R = 1 kΩ', level: 'Advanced' };
  const response = await post(base, '/api/outline', input);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), sampleOutline);
  const [call] = messages;
  assert.equal(call.model, input.model);
  assert.equal(call.stream, false);
  assert.deepEqual(call.format.required, ['title', 'steps']);
  assert.deepEqual(JSON.parse(call.messages[1].content), { topic: input.topic, notes: input.notes, level: input.level });
});

test('step request carries outline, index and previous lines, and sets Ollama context options', async (t) => {
  const { base, messages } = await fixture(t, () => sampleStep);
  const input = { ...userModel, topic: 'RC delay', level: 'Beginner', outline: sampleOutline, index: 1, previous: 'Intuition: A capacitor fills like a bucket.' };
  const response = await post(base, '/api/step', input);
  assert.equal(response.status, 200);
  const step = await response.json();
  const [call] = messages;
  assert.deepEqual(call.format.required, ['heading', 'beats']);
  assert.deepEqual(call.options, { temperature: 0.2, num_ctx: 8192, num_predict: 3000 });
  const sent = JSON.parse(call.messages[1].content);
  assert.deepEqual(sent.outline, sampleOutline);
  assert.equal(sent.index, 1);
  assert.equal(sent.previous, input.previous);
  assert.equal(step.explanation, 'Here is the voltage over time. It rises quickly, then levels off.');
  assert.deepEqual(step.beats[1].draw[0], { kind: 'plot', axes: 'a', fn: '1-exp(-x)', label: 'charging' });
  assert.ok(Object.values(step.beats[0].draw[0]).every((value) => value !== null));
});

test('repairs a step with invalid shapes instead of rejecting it', async (t) => {
  const { base } = await fixture(t, () => ({ heading: 'Repair', beats: [{ say: 'Look at this.', draw: [
    raw({ kind: 'box', at: [1, 1], w: 2, h: 2 }),
    raw({ kind: 'axes', id: 'a', at: [5, 1], w: 6, h: 5, xRange: [0, 1], yRange: [0, 1] }),
    raw({ kind: 'plot', axes: 'a', fn: 'foo(' }),
    raw({ kind: 'arrow', fromId: 'ghost', to: [3, 3] })] }] }));
  const response = await post(base, '/api/step', { ...userModel, topic: 'RC', outline: sampleOutline, index: 0 });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).beats[0].draw.map((shape) => shape.kind), ['box', 'axes']);
});

test('rejects structurally broken steps and out-of-range indices', async (t) => {
  const { base, messages } = await fixture(t, () => ({ heading: 'x', beats: [] }));
  const broken = await post(base, '/api/step', { ...userModel, topic: 'RC', outline: sampleOutline, index: 0 });
  assert.equal(broken.status, 502);
  assert.match((await broken.json()).error, /incomplete board step/);
  const calls = messages.length;
  for (const index of [7, -1, 1.5, '1']) {
    const invalid = await post(base, '/api/step', { ...userModel, topic: 'RC', outline: sampleOutline, index });
    assert.equal(invalid.status, 400, String(index));
  }
  const badOutline = await post(base, '/api/step', { ...userModel, topic: 'RC', outline: { title: 'x', steps: [] }, index: 0 });
  assert.equal(badOutline.status, 400);
  assert.equal(messages.length, calls);
});

test('the old lesson endpoint is gone', async (t) => {
  const { base } = await fixture(t, () => sampleOutline);
  assert.equal((await post(base, '/api/lesson', { ...userModel, topic: 'x' })).status, 404);
});

test('passes the active whiteboard context when asking a follow-up', async (t) => {
  const { base, messages } = await fixture(t, () => sampleStep);
  const body = { ...userModel, topic: 'RC delay', question: 'Why this curve?', context: 'Current step: capacitor charging' };
  const response = await post(base, '/api/followup', body);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).heading, sampleStep.heading);
  assert.equal(JSON.parse(messages[0].messages[1].content).context, body.context);
  assert.deepEqual(messages[0].format.required, ['heading', 'beats']);
});

test('rejects invalid input and malformed model output', async (t) => {
  const { base, messages } = await fixture(t, () => ({ title: 'Incomplete', steps: [] }));
  const invalid = await post(base, '/api/outline', { ...userModel, topic: '' });
  assert.equal(invalid.status, 400);
  assert.equal(messages.length, 0);
  const malformed = await post(base, '/api/outline', { ...userModel, topic: 'Sorting' });
  assert.equal(malformed.status, 502);
  assert.match((await malformed.json()).error, /incomplete outline/);
});

test('reports a disconnected model service and keeps serving the two built-in samples', async (t) => {
  const unused = createServer();
  unused.listen(0, '127.0.0.1');
  await once(unused, 'listening');
  const address = 'http://127.0.0.1:' + unused.address().port;
  await new Promise((resolve) => unused.close(resolve));
  const base = await start(createApp({ ollama: address }), t);
  const state = await (await fetch(base + '/api/models')).json();
  assert.equal(state.online, false);
  const sources = await (await fetch(base + '/samples.js')).text();
  assert.match(sources, /Why the Moon changes shape/);
  assert.match(sources, /How binary search works/);
  assert.equal((await post(base, '/api/outline', { ...userModel, topic: 'Anything' })).status, 503);
});

test('Gemini serves an outline, a step and a follow-up, keeps the key server-side and reports quota errors', async (t) => {
  const calls = [];
  const model = 'gemini-3.1-flash-lite';
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    assert.match(url, /:generateContent$/);
    assert.equal(options.headers['x-goog-api-key'], 'fixture-key');
    const prompt = JSON.parse(body.contents[0].parts[0].text);
    calls.push(prompt);
    if (prompt.topic === 'quota') return new Response(null, { status: 429 });
    const content = body.generationConfig.responseJsonSchema.required[0] === 'title' ? sampleOutline : sampleStep;
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(content) }] } }] });
  };
  const base = await start(createApp({ gemini: { key: 'fixture-key', model }, fetchImpl }), t);
  assert.deepEqual(await (await fetch(base + '/api/models')).json(), { online: true, provider: 'gemini', models: [model] });
  assert.deepEqual(await (await post(base, '/api/outline', { model, topic: 'RC delay' })).json(), sampleOutline);
  const step = await (await post(base, '/api/step', { model, topic: 'RC delay', outline: sampleOutline, index: 0 })).json();
  assert.equal(step.heading, sampleStep.heading);
  const followup = await (await post(base, '/api/followup', { model, topic: 'RC delay', context: 'charging', question: 'Why?' })).json();
  assert.equal(followup.beats.length, 2);
  assert.equal(calls[2].context, 'charging');
  assert.equal((await post(base, '/api/outline', { model, topic: 'quota' })).status, 429);
});
