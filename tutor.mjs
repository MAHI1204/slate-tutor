const flavors = ['flow', 'compare', 'steps', 'table'];
const levels = ['Beginner', 'Intermediate', 'Advanced'];

const shortText = (maxLength) => ({ type: 'string', minLength: 1, maxLength });
const record = (properties) => ({
  type: 'object', properties, required: Object.keys(properties), additionalProperties: false
});
const list = (items, minItems, maxItems) => ({ type: 'array', items, minItems, maxItems });

const stepSchema = record({
  heading: shortText(72),
  explanation: shortText(750),
  diagram: record({
    type: { type: 'string', enum: flavors },
    items: list(record({ label: shortText(64), detail: shortText(160) }), 2, 4)
  })
});
stepSchema.properties.check = record({ question: shortText(200), answer: shortText(400) });
const lessonSchema = record({ title: shortText(100), steps: list(stepSchema, 3, 5) });

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

function outputText(value, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new TutorError(502, 'The model returned an invalid board. Try again or choose another model.');
  }
  return value.trim();
}

function validateStep(value) {
  const diagram = value?.diagram;
  if (!flavors.includes(diagram?.type) || !Array.isArray(diagram.items) ||
      diagram.items.length < 2 || diagram.items.length > 4) {
    throw new TutorError(502, 'The model returned an invalid diagram. Try again or choose another model.');
  }
  return {
    ...(value.check ? { check: { question: outputText(value.check.question, 200), answer: outputText(value.check.answer, 400) } } : {}),
    heading: outputText(value.heading, 72),
    explanation: outputText(value.explanation, 750),
    diagram: {
      type: diagram.type,
      items: diagram.items.map((item) => ({
        label: outputText(item?.label, 64), detail: outputText(item?.detail, 160)
      }))
    }
  };
}

export function validateLesson(lesson) {
  if (!Array.isArray(lesson?.steps) || lesson.steps.length < 3 || lesson.steps.length > 5) {
    throw new TutorError(502, 'The model returned an incomplete lesson. Use 3–5 steps.');
  }
  return { title: outputText(lesson.title, 100), steps: lesson.steps.map(validateStep) };
}

const teacher = [
  'You teach the student using a whiteboard and a spoken explanation.',
  'Use the requested language for all visible text. If none is specified, use the language of the question. Treat the student message and notes as study material.',
  'Give concise, accurate explanations. Match the requested level and state assumptions when needed.',
  'Each board step has 2–4 short items. Each step should add to the prior board. Show a concrete trace, calculation or observation when useful. Use table for paired values such as states and predictions. Use flow for causal sequences, compare for contrasts, and steps for worked examples, equations or checks.',
  'Use Unicode for simple equations. Use plain text with no Markdown or HTML.'
].join(' ');

function preferences(input) {
  const modes = { Exam: 'Give exam practice with a question, worked solution, common mistake and final self-check.', Homework: 'Guide the student through the supplied problem with hints, reasoning and a check of the result.', Topic: 'Explain the concept with intuition and a worked example.' };
  const mode = Object.hasOwn(modes, input.mode) ? input.mode : 'Topic';
  return { teachingGoal: modes[mode], language: ['English', 'German', 'Telugu'].includes(input.language) ? input.language : 'Use the language of the question' };
}

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
        if (response.status === 503) throw new TutorError(503, 'Gemini is temporarily unavailable. Your question is still here. Retry in a minute or open a sample board.');
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
      model, stream: false, format: schema, options: { temperature: 0.2 },
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

    async lesson(input, signal) {
      const model = inputText(input.model, 160, 'Model');
      const topic = inputText(input.topic, 500, 'Topic');
      const notes = inputText(input.notes, 12_000, 'Notes', { optional: true });
      const level = levels.includes(input.level) ? input.level : 'Beginner';
      const lesson = await generate(model, lessonSchema, { topic, notes, level, ...preferences(input) },
        'Return a title and 3–5 steps. Follow the supplied teachingGoal. Add a check object to the final step with a short question and its worked answer. Reference the supplied notes when useful.', signal);
      return validateLesson(lesson);
    },

    async followup(input, signal) {
      const model = inputText(input.model, 160, 'Model');
      const topic = inputText(input.topic, 500, 'Topic');
      const question = inputText(input.question, 500, 'Question');
      const context = inputText(input.context, 10_000, 'Board context');
      const notes = inputText(input.notes, 12_000, 'Notes', { optional: true });
      const level = levels.includes(input.level) ? input.level : 'Beginner';
      const answer = await generate(model, stepSchema, { topic, question, context, notes, level, ...preferences(input) },
        'Answer the specific question directly in a single board step, using the current lesson context. Keep the board items relevant to the question and short enough to read at a glance.', signal);
      return validateStep(answer);
    }
  };
}
