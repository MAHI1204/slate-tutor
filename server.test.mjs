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

const sampleStep = {
  heading: 'Build an intuition',
  explanation: 'Start by connecting the two ideas.',
  diagram: {
    type: 'flow',
    items: [{ label: 'Input', detail: 'The first idea' }, { label: 'Output', detail: 'What follows' }]
  }
};
const sampleLesson = { title: 'An explanation', steps: [sampleStep, sampleStep, sampleStep] };
const userModel = { model: 'test-model:7b' };

const post = (base, endpoint, body) => fetch(base + endpoint, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

async function fixture(t, chooseAnswer) {
  let messages = [];
  const model = createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/api/tags') return response.end(JSON.stringify({ models: [{ name: userModel.model }] }));
    let raw = '';
    for await (const chunk of request) raw += chunk;
    const payload = JSON.parse(raw);
    messages.push(payload);
    const data = await chooseAnswer(payload);
    return response.end(JSON.stringify({ message: { content: JSON.stringify(data) } }));
  });
  const url = await start(model, t);
  const base = await start(createApp({ ollama: url }), t);
  return { base, messages };
}

test('serves the web app, static scripts and the installed model list', async (t) => {
  const { base } = await fixture(t, () => sampleLesson);
  assert.match(await (await fetch(base)).text(), /What shall we unpack/);
  assert.equal((await fetch(base + '/app.js')).status, 200);
  assert.deepEqual(await (await fetch(base + '/api/models')).json(), {
    online: true, models: [userModel.model]
  });
});

test('passes any topic and study notes to a schema-constrained Ollama chat request', async (t) => {
  const { base, messages } = await fixture(t, () => sampleLesson);
  const input = { ...userModel, topic: 'How does an RC circuit delay a signal?', notes: 'R = 1 kΩ', level: 'Advanced', mode: 'Exam', language: 'Telugu' };
  const response = await post(base, '/api/lesson', input);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), sampleLesson);
  const [call] = messages;
  assert.equal(call.model, input.model);
  assert.equal(call.stream, false);
  assert.deepEqual(call.format.required, ['title', 'steps']);
  const { teachingGoal, language, ...content } = JSON.parse(call.messages[1].content);
  assert.match(teachingGoal, /exam practice/);
  assert.equal(language, input.language);
  assert.deepEqual(content, { topic: input.topic, notes: input.notes, level: input.level });
});

test('passes the active whiteboard context when asking a follow-up', async (t) => {
  const { base, messages } = await fixture(t, () => sampleStep);
  const body = { ...userModel, topic: 'RC delay', question: 'Why this curve?', context: 'Current step: capacitor charging' };
  const response = await post(base, '/api/followup', body);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), sampleStep);
  assert.equal(JSON.parse(messages[0].messages[1].content).context, body.context);
});

test('rejects invalid input and malformed model output', async (t) => {
  const { base, messages } = await fixture(t, () => ({ title: 'Incomplete', steps: [] }));
  const invalid = await post(base, '/api/lesson', { ...userModel, topic: '' });
  assert.equal(invalid.status, 400);
  assert.equal(messages.length, 0);
  const malformed = await post(base, '/api/lesson', { ...userModel, topic: 'Sorting' });
  assert.equal(malformed.status, 502);
  assert.match((await malformed.json()).error, /incomplete lesson/);
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
  assert.equal((await post(base, '/api/lesson', { ...userModel, topic: 'Anything' })).status, 503);
});

test('Gemini serves a lesson and a contextual follow-up, keeps the key server-side and reports quota errors', async (t) => {
  const calls = [];
  const model = 'gemini-3.1-flash-lite';
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    assert.match(url, /:generateContent$/);
    assert.equal(options.headers['x-goog-api-key'], 'fixture-key');
    const prompt = JSON.parse(body.contents[0].parts[0].text);
    calls.push(prompt);
    if (prompt.topic === 'unavailable') return new Response(null, { status: 503 });
    if (prompt.topic === 'quota') return new Response(null, { status: 429 });
    const content = body.generationConfig.responseJsonSchema.properties.steps ? sampleLesson : sampleStep;
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(content) }] } }] });
  };
  const base = await start(createApp({ gemini: { key: 'fixture-key', model }, fetchImpl }), t);
  assert.deepEqual(await (await fetch(base + '/api/models')).json(), { online: true, provider: 'gemini', models: [model] });
  assert.deepEqual(await (await post(base, '/api/lesson', { model, topic: 'RC delay' })).json(), sampleLesson);
  assert.deepEqual(await (await post(base, '/api/followup', { model, topic: 'RC delay', context: 'charging', question: 'Why?' })).json(), sampleStep);
  const unavailable = await post(base, '/api/lesson', { model, topic: 'unavailable' });
  assert.equal(unavailable.status, 503);
  assert.match((await unavailable.json()).error, /temporarily unavailable/);
  assert.equal(calls[1].context, 'charging');
  assert.equal((await post(base, '/api/lesson', { model, topic: 'quota' })).status, 429);
});

test('imports the introduction from an English Wikipedia article', async (t) => {
  const base = await start(createApp({ fetchImpl: async (url) => {
    assert.equal(url.hostname, 'en.wikipedia.org');
    assert.equal(url.searchParams.get('titles'), 'Photosynthesis');
    return Response.json({ query: { pages: [{ title: 'Photosynthesis', extract: 'Leaf biology.' }] } });
  } }), t);
  const url = 'https://en.wikipedia.org/wiki/Photosynthesis';
  assert.match((await (await post(base, '/api/article', { url })).json()).text, /Leaf biology/);
  assert.equal((await post(base, '/api/article', { url: 'https://example.org' })).status, 400);
});
