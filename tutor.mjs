import { normalizeStep, SHAPE_KINDS } from './public/board-shapes.js';

const levels = ['Beginner', 'Intermediate', 'Advanced'];

const shortText = (maxLength) => ({ type: 'string', minLength: 1, maxLength });
const record = (properties) => ({
  type: 'object', properties, required: Object.keys(properties), additionalProperties: false
});
const list = (items, minItems, maxItems) => ({ type: 'array', items, minItems, maxItems });
const nullable = (type) => ({ type: [type, 'null'] });
const nullablePair = { type: ['array', 'null'], items: { type: 'number' }, minItems: 2, maxItems: 2 };

// Every field is present on every shape (null when unused) so the schema needs no unions,
// which Ollama's grammar support handles poorly.
const shapeSchema = record({
  kind: { type: 'string', enum: SHAPE_KINDS },
  id: nullable('string'),
  at: nullablePair,
  w: nullable('number'),
  h: nullable('number'),
  r: nullable('number'),
  text: nullable('string'),
  label: nullable('string'),
  // Plain string enums: Gemini's schema subset does not document null inside an enum.
  size: { type: 'string', enum: ['title', 'body', 'small'] },
  align: { type: 'string', enum: ['left', 'center'] },
  from: nullablePair,
  fromId: nullable('string'),
  to: nullablePair,
  toId: nullable('string'),
  dashed: nullable('boolean'),
  axes: nullable('string'),
  fn: nullable('string'),
  domain: nullablePair,
  xRange: nullablePair,
  yRange: nullablePair,
  xLabel: nullable('string'),
  yLabel: nullable('string'),
  target: nullable('string')
});
const stepSchema = record({
  heading: shortText(72),
  beats: list(record({ say: shortText(300), draw: list(shapeSchema, 0, 4) }), 2, 6)
});
const outlineItem = record({ heading: shortText(72), goal: shortText(160) });
const outlineSchema = record({ title: shortText(100), steps: list(outlineItem, 3, 5) });

export class TutorError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function inputText(value, max, field, { optional = false } = {}) {
  if (optional && value === undefined) return '';
  const text = typeof value === 'string' ? value.trim() : '';
  if (typeof value !== 'string' || (!text && !optional) || text.length > max) {
    throw new TutorError(400, field + ' must contain ' + (optional ? 'up to ' : '1 to ') + max + ' characters.');
  }
  return text;
}

function outlineInput(value) {
  const steps = value?.steps;
  if (!value || typeof value !== 'object' || !Array.isArray(steps) || steps.length < 3 || steps.length > 5) {
    throw new TutorError(400, 'Outline must contain a title and 3 to 5 steps.');
  }
  return {
    title: inputText(value.title, 100, 'Outline title'),
    steps: steps.map((item) => ({
      heading: inputText(item?.heading, 72, 'Outline heading'),
      goal: inputText(item?.goal, 160, 'Outline goal')
    }))
  };
}

function outputText(value, max, message) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new TutorError(502, message);
  return value.trim();
}

const incompleteOutline = 'The model returned an incomplete outline. Try again or select another model.';
const incompleteStep = 'The model returned an incomplete board step. Try again or choose another model.';

function validateOutline(value) {
  if (!Array.isArray(value?.steps) || value.steps.length < 3 || value.steps.length > 5) {
    throw new TutorError(502, incompleteOutline);
  }
  return {
    title: outputText(value.title, 100, incompleteOutline),
    steps: value.steps.map((item) => ({
      heading: outputText(item?.heading, 72, incompleteOutline),
      goal: outputText(item?.goal, 160, incompleteOutline)
    }))
  };
}

function validateStep(value, fallbackHeading) {
  const step = normalizeStep(value, { fallbackHeading });
  if (!step) throw new TutorError(502, incompleteStep);
  return step;
}

const teacher = [
  'You teach the student using a whiteboard and a spoken explanation.',
  'Write in the language used by the student. Treat the student message and notes as study material.',
  'Give concise, accurate explanations. Match the requested level and state assumptions when needed.',
  'Use Unicode for simple equations. Use plain text with no Markdown or HTML.'
].join(' ');

const boardExample = JSON.stringify({
  heading: 'Speed is the slope of distance',
  beats: [
    { say: 'Let us plot distance against time for a car moving at a steady 2 metres per second.', draw: [
      { kind: 'axes', id: 'ax', at: [1, 1], w: 7, h: 6, xRange: [0, 4], yRange: [0, 8], xLabel: 't (s)', yLabel: 'd (m)' },
      { kind: 'plot', axes: 'ax', fn: '2x', domain: [0, 4], label: 'd = 2t' }] },
    { say: 'Each second the line climbs by 2 metres, so the slope is the speed.', draw: [
      { kind: 'point', axes: 'ax', at: [3, 6], label: '(3 s, 6 m)' },
      { kind: 'equation', id: 'eq', at: [9.5, 2], text: 'v = Δd / Δt = 2 m/s' },
      { kind: 'arrow', from: [9.4, 2.8], to: [7, 3.5] }] },
    { say: 'Remember this rule.', draw: [{ kind: 'highlight', target: 'eq' }] }
  ]
});

const boardGuide = [
  'Each step is a list of beats. A beat is one or two spoken sentences ("say") plus the shapes drawn while they are spoken ("draw", 0 to 4 shapes).',
  'The board is a grid 16 units wide and 9 units tall. x grows to the right from 0 to 16 and y grows downwards from 0 to 9. Keep every shape on the board and leave space between shapes.',
  'Shape kinds and their fields:',
  'text: at [x,y] is the top-left of the line, text, size title|body|small, align left|center.',
  'equation: at, text (Unicode math).',
  'box: at is the top-left corner, w, h, optional label.',
  'circle: at is the centre, r, optional label.',
  'arrow: fromId or from [x,y], toId or to [x,y], optional label. Use arrows for forces, flows and causes.',
  'line: from/fromId, to/toId, dashed true|false.',
  'axes: id, at is the top-left corner, w, h, xRange [min,max], yRange [min,max], xLabel, yLabel.',
  'plot: axes (the id of an earlier axes), fn written in x using + - * / ^ ( ) pi e sin cos tan asin acos atan sqrt abs exp ln log, optional domain [a,b], optional label. Always use axes and plot to show a graph; the app computes the curve.',
  'point: at; if axes is set, at is in that graph\'s data coordinates; optional label.',
  'highlight: target (the id of an earlier shape) to circle it for emphasis.',
  'Give a shape an id only when a later shape refers to it, and refer only to ids defined earlier in the same step.',
  'Every shape object must include every field; set the fields a kind does not use to null, except size and align, which always need a value (use body and left when the kind does not use them).',
  'Text on the board is short: a few words per label, at most 80 characters.',
  'Example step (fields set to null are omitted here for brevity): ' + boardExample
].join(' ');

export function createTutor(baseURL, fetchImpl = fetch, gemini = null) {
  async function request(path, payload, clientSignal) {
    let response;
    try {
      const timeout = AbortSignal.timeout(payload ? 180_000 : 5_000);
      response = await fetchImpl(new URL(path, baseURL), {
        ...(payload ? {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
        } : {}),
        redirect: 'error',
        signal: clientSignal ? AbortSignal.any([timeout, clientSignal]) : timeout
      });
    } catch (error) {
      if (clientSignal?.aborted) throw error;
      if (error.name === 'TimeoutError') {
        throw new TutorError(504, 'Ollama took too long. Try a smaller model or a shorter question.');
      }
      throw new TutorError(503, 'Ollama is unreachable. Start Ollama on this computer and retry.');
    }
    if (!response.ok) {
      if (response.status === 404 && payload) {
        throw new TutorError(404, 'That model is unavailable. Install it in Ollama or pick an installed model.');
      }
      throw new TutorError(502, 'Ollama could not complete the request. Check the model and retry.');
    }
    try {
      return await response.json();
    } catch {
      throw new TutorError(502, 'Ollama returned an unreadable response.');
    }
  }

  async function generate(model, schema, userMessage, instruction, signal) {
    if (gemini) {
      if (model !== gemini.model) throw new TutorError(400, 'Choose the configured Gemini model.');
      const timeout = AbortSignal.timeout(180_000);
      let response;
      try {
        response = await fetchImpl('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', {
          method: 'POST', redirect: 'error',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': gemini.key },
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: teacher + ' ' + instruction }] },
            contents: [{ role: 'user', parts: [{ text: JSON.stringify(userMessage) }] }],
            generationConfig: { responseMimeType: 'application/json', responseJsonSchema: schema }
          })
        });
      } catch (error) {
        if (signal?.aborted) throw error;
        throw new TutorError(503, 'Gemini is unreachable or timed out. Retry later.');
      }
      if (!response.ok) {
        const messages = { 400: 'Check your Gemini key and model configuration.',
          403: 'Gemini denied access. Check key permissions.', 404: 'Gemini model unavailable.',
          429: 'Gemini quota reached. Check your project limits or retry later.' };
        throw new TutorError(response.status === 429 ? 429 : 502, messages[response.status] || 'Gemini could not complete this request.');
      }
      try {
        const data = await response.json();
        const parts = data.candidates[0].content.parts.filter(part => !part.thought);
        return JSON.parse(parts.map(part => part.text || '').join(''));
      } catch {
        throw new TutorError(502, 'Gemini did not return a complete structured lesson.');
      }
    }
    const result = await request('/api/chat', {
      model, stream: false, format: schema, options: { temperature: 0.2, num_ctx: 8192, num_predict: 3000 },
      messages: [
        { role: 'system', content: teacher + ' ' + instruction },
        { role: 'user', content: JSON.stringify(userMessage) }
      ]
    }, signal);
    try {
      return JSON.parse(result.message.content);
    } catch {
      throw new TutorError(502, 'The model did not return a structured lesson. Try a different model.');
    }
  }

  return {
    async models(signal) {
      if (gemini) return { provider: 'gemini', models: [gemini.model] };
      const result = await request('/api/tags', undefined, signal);
      if (!Array.isArray(result?.models)) throw new TutorError(502, 'Ollama did not return a model list.');
      return { models: result.models.map((item) => item.name).filter((name) => typeof name === 'string') };
    },

    async outline(input, signal) {
      const model = inputText(input.model, 160, 'Model');
      const topic = inputText(input.topic, 500, 'Topic');
      const notes = inputText(input.notes, 12_000, 'Notes', { optional: true });
      const level = levels.includes(input.level) ? input.level : 'Beginner';
      const outline = await generate(model, outlineSchema, { topic, notes, level },
        'Plan a whiteboard lesson. Return a title and 3–5 steps. The steps start with intuition, explain the mechanism, and end with a concrete worked example or application with its answer. Each step has a short heading and a one-sentence goal saying what it must teach. Reference the supplied notes when useful.', signal);
      return validateOutline(outline);
    },

    async step(input, signal) {
      const model = inputText(input.model, 160, 'Model');
      const topic = inputText(input.topic, 500, 'Topic');
      const notes = inputText(input.notes, 12_000, 'Notes', { optional: true });
      const level = levels.includes(input.level) ? input.level : 'Beginner';
      const outline = outlineInput(input.outline);
      const { index } = input;
      if (!Number.isInteger(index) || index < 0 || index >= outline.steps.length) {
        throw new TutorError(400, 'Step index must refer to a step in the outline.');
      }
      const previous = inputText(input.previous, 4_000, 'Previous steps', { optional: true });
      const step = await generate(model, stepSchema, { topic, notes, level, outline, index, previous },
        boardGuide + ' Teach only step number ' + (index + 1) + ' of the outline, working towards its goal. "previous" holds what earlier steps already said: continue from it without repeating it. Use 2–6 beats and draw something meaningful in most beats.', signal);
      return validateStep(step, outline.steps[index].heading);
    },

    async followup(input, signal) {
      const model = inputText(input.model, 160, 'Model');
      const topic = inputText(input.topic, 500, 'Topic');
      const question = inputText(input.question, 500, 'Question');
      const context = inputText(input.context, 10_000, 'Board context');
      const notes = inputText(input.notes, 12_000, 'Notes', { optional: true });
      const level = levels.includes(input.level) ? input.level : 'Beginner';
      const answer = await generate(model, stepSchema, { topic, question, context, notes, level },
        boardGuide + ' Answer the specific question directly in one step of 2–4 beats on a fresh board, using the current lesson context.', signal);
      return validateStep(answer);
    }
  };
}
