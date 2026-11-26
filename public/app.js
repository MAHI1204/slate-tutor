import { samples } from './samples.js';
import { createBoard } from './board.js';
import { isLegacyStep, legacyToBeats } from './board-shapes.js';

const ui = Object.fromEntries([...document.querySelectorAll('[id]')].map((item) => [item.id, item]));
const historyKey = 'slate-tutor-history-v1';
const speech = window.speechSynthesis;
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const board = createBoard(ui['board-svg'], { reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches });
let saved = readSaved();
let lesson = saved[0] || makeSample('moon');
let activeRequest = null;
let generation = null;
let unloading = false;
const waiters = new Map();
let models = [];
let modelCheck = 0;
let playback = null;
let resumePoint = null;
let speechTimer;
let stopTalking;
let recognition;

function makeSample(key) {
  const sample = structuredClone(samples[key]);
  return { ...sample, sample: true, topic: sample.title, cursor: 0, level: 'Beginner' };
}

// Old-format steps are converted; steps that were still being generated when the page
// closed come back as failed so their outline row offers Retry.
function loadStep(step) {
  if (isLegacyStep(step)) return legacyToBeats(step);
  if (step?.pending) return { ...step, failed: true, error: step.error || 'the page was closed before it was ready.' };
  return step;
}

function readSaved() {
  try {
    const data = JSON.parse(localStorage.getItem(historyKey) || '[]');
    if (!Array.isArray(data)) return [];
    return data
      .filter((value) => value?.id && Array.isArray(value.steps))
      .map((value) => ({ ...value, steps: value.steps.map(loadStep).filter(Boolean) }))
      .filter((value) => value.steps.length > 0);
  } catch {
    return [];
  }
}

function saveLesson(target = lesson) {
  if (!target || target.sample) return;
  saved = [target, ...saved.filter((item) => item.id !== target.id)].slice(0, 15);
  try {
    localStorage.setItem(historyKey, JSON.stringify(saved));
  } catch {
    status(ui.notice, 'Browser storage is unavailable. This lesson will be lost when you close the page.', true);
  }
}

function element(tag, text, className) {
  const item = document.createElement(tag);
  if (text) item.textContent = text;
  if (className) item.className = className;
  return item;
}

function status(target, message = '', error = false) {
  target.hidden = !message;
  target.textContent = message;
  target.dataset.error = String(error);
}

async function api(path, { body, signal } = {}) {
  const response = await fetch(path, {
    signal,
    ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'The request failed. Try again.');
  return data;
}

async function loadModels() {
  const check = ++modelCheck;
  ui['model-status'].textContent = 'Checking model settings…';
  ui['refresh-models'].disabled = true;
  let engine;
  try {
    engine = await api('/api/models');
  } catch {
    engine = { online: false, models: [], message: 'The app server is unreachable. Start it and refresh.' };
  }
  if (check !== modelCheck) return;
  const previous = ui.model.value;
  models = engine.models;
  ui.model.replaceChildren(...models.map((name) => new Option(name, name)));
  if (models.includes(previous)) ui.model.value = previous;
  ui['model-label'].hidden = models.length === 0;
  ui['model-status'].dataset.state = models.length ? 'ready' : 'offline';
  ui['model-status'].textContent = engine.provider === 'gemini' ? 'Gemini configured' : models.length ? 'Local AI ready' : engine.online ? 'No models installed' : 'Ollama offline';
  ui['model-status'].title = engine.message || '';
  ui['refresh-models'].disabled = false;
  renderControls();
}

function renderHistory() {
  const entries = saved.map((item) => {
    const button = element('button', item.title);
    button.type = 'button';
    if (item.id === lesson?.id) button.setAttribute('aria-current', 'true');
    button.addEventListener('click', () => openLesson(item));
    return button;
  });
  ui.history.replaceChildren(...(entries.length ? entries : [element('p', 'Your generated lessons will appear here.')]));
}

function activeStep() {
  return lesson?.steps[lesson.cursor];
}

const isReady = (step) => Boolean(step && !step.pending && Array.isArray(step.beats));

function stepReady(step) {
  if (isReady(step)) return Promise.resolve('ready');
  if (step.failed) return Promise.resolve('failed');
  return new Promise((resolve) => {
    waiters.set(step, [...(waiters.get(step) || []), resolve]);
  });
}

function settle(step, result) {
  for (const resolve of waiters.get(step) || []) resolve(result);
  waiters.delete(step);
}

function stopVoice() {
  stopTalking?.();
  if (speech) speech.cancel();
}

// Pauses: the board keeps every beat drawn so far (the current one is completed) and
// Play resumes from the next beat.
function stopPlayback() {
  const current = playback;
  playback = null;
  current?.drawing?.finish();
  current?.release();
  stopVoice();
  if (current && current.beat < 0) status(ui['speech-status']);
  if (current && current.beat >= 0) resumePoint = { lesson, stepIndex: current.stepIndex, beat: current.beat };
  renderControls();
}

// Stops playback for good (navigation, new lesson, follow-up): Play starts the step over.
function haltPlayback() {
  stopPlayback();
  resumePoint = null;
}

function highlightBeat(index) {
  for (const span of ui.explanation.querySelectorAll('span[data-beat]')) {
    span.dataset.active = String(Number(span.dataset.beat) === index);
  }
}

function renderControls() {
  const busy = Boolean(activeRequest);
  const generating = Boolean(generation);
  ui.generate.disabled = busy || generating;
  ui.cancel.hidden = !busy && !generating;
  ui.ask.disabled = busy || generating || Boolean(lesson?.sample) || !isReady(activeStep());
  ui.back.disabled = busy || !lesson || lesson.cursor === 0;
  ui.next.disabled = busy || !lesson || lesson.cursor === lesson.steps.length - 1;
  ui.play.disabled = busy || !lesson;
  ui.replay.disabled = busy || !isReady(activeStep());
  ui.play.textContent = playback ? 'Pause lesson' : 'Play lesson';
}

function renderBoard(step) {
  ui['board-svg'].setAttribute('aria-label', board.describe(step));
  return board.show(step, step.beats.length - 1);
}

function renderTranscript(step) {
  if (!isReady(step)) {
    ui.explanation.textContent = step.failed
      ? 'This step could not be drawn: ' + step.error + ' Use Retry in the outline.'
      : 'Preparing this step…';
    return;
  }
  const spans = step.beats.map((beat, index) => {
    const span = element('span', beat.say);
    span.dataset.beat = String(index);
    return span;
  });
  ui.explanation.replaceChildren(...spans.flatMap((span, index) => (index ? [' ', span] : [span])));
}

function renderLesson(boardMode = 'full') {
  renderHistory();
  renderControls();
  const step = activeStep();
  ui.lesson.hidden = !step;
  ui.empty.hidden = Boolean(step);
  if (!step) return;
  ui['lesson-type'].textContent = lesson.sample ? 'Sample lesson' : lesson.level;
  ui['lesson-title'].textContent = lesson.title;
  ui['step-title'].textContent = step.heading;
  ui.counter.textContent = 'Step ' + (lesson.cursor + 1) + ' of ' + lesson.steps.length;
  renderTranscript(step);
  if (lesson.sample) {
    status(ui['ask-status'], 'Create a custom lesson to ask your own follow-up questions.');
  } else if (generation?.lesson === lesson) {
    status(ui['ask-status'], 'Follow-ups open once every step is drawn.');
  } else if (!activeRequest) {
    status(ui['ask-status']);
  }
  ui.followup.disabled = Boolean(lesson.sample);
  ui['ask-mic'].disabled = Boolean(lesson.sample);
  if (boardMode === 'full') {
    if (isReady(step)) renderBoard(step);
    else {
      board.clear();
      ui['board-svg'].setAttribute('aria-label', step.failed ? 'This step could not be drawn.' : 'Preparing this step.');
    }
  }
  renderOutline();
}

function renderOutline() {
  if (!lesson) return;
  const rows = lesson.steps.map((step, index) => {
    const row = element('li');
    const button = element('button');
    button.type = 'button';
    if (index === lesson.cursor) button.setAttribute('aria-current', 'step');
    const label = element('span', step.question ? 'Follow-up: ' + step.heading : step.heading);
    if (step.pending && !step.failed) label.append(element('span', 'preparing…', 'step-state'));
    if (step.failed) label.append(element('span', 'not drawn', 'step-state'));
    button.append(element('span', String(index + 1)), label);
    button.addEventListener('click', () => {
      if (!activeRequest) moveTo(index);
    });
    row.append(button);
    if (step.failed) {
      const retry = element('button', 'Retry', 'retry');
      retry.type = 'button';
      retry.setAttribute('aria-label', 'Retry step ' + (index + 1));
      retry.addEventListener('click', () => retryStep(step));
      row.append(retry);
    }
    return row;
  });
  ui.outline.replaceChildren(...rows);
}

function cancelRequest() {
  activeRequest?.abort();
  activeRequest = null;
  renderControls();
}

function openLesson(value) {
  cancelRequest();
  haltPlayback();
  lesson = value;
  ui.followup.value = '';
  status(ui.notice);
  status(ui['speech-status']);
  renderLesson();
}

function moveTo(index) {
  haltPlayback();
  status(ui['speech-status']);
  lesson.cursor = index;
  saveLesson();
  renderLesson();
}

function hold(milliseconds) {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(speechTimer);
      stopTalking = null;
      resolve();
    };
    speechTimer = setTimeout(done, milliseconds);
    stopTalking = done;
  });
}

function readAloud(text, fallbackMs) {
  if (!speech || !ui.narration.checked || !speech.getVoices().length) {
    if (ui.narration.checked) status(ui['speech-status'], 'No browser voice is available. Follow the written explanation.');
    return hold(fallbackMs);
  }
  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text);
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      clearTimeout(speechTimer);
      stopTalking = null;
      resolve();
    };
    utterance.rate = 0.94;
    utterance.onend = done;
    utterance.onerror = (event) => {
      if (!['canceled', 'interrupted'].includes(event.error)) {
        status(ui['speech-status'], 'This browser could not play narration. The full explanation is below.');
      }
      done();
    };
    stopTalking = done;
    speechTimer = setTimeout(() => { done(); speech.cancel(); }, 60_000);
    speech.speak(utterance);
  });
}

function beatDuration(say, shapes) {
  const words = say.split(/\s+/).filter(Boolean).length;
  return Math.max((words / 2.6) * 1000, 600 * shapes, 1200);
}

// Plays from a beat: each beat's shapes are drawn while its sentence is narrated, and the
// next beat starts when both have finished. Runs on through later steps unless
// untilEndOfStep is set (Replay step). `continuing` means the board already shows the
// earlier beats of this step (resuming after a pause).
async function playFrom(stepIndex, beat, { untilEndOfStep = false, continuing = false } = {}) {
  const run = Symbol('playback');
  let release;
  const released = new Promise((resolve) => { release = resolve; });
  const current = { run, stepIndex, beat: -1, drawing: null, release: () => release('stopped') };
  const playing = lesson;
  playback = current;
  resumePoint = null;
  status(ui['speech-status']);
  renderControls();
  let redraw = !continuing;
  while (playback === current) {
    if (lesson !== playing) {
      haltPlayback();
      return;
    }
    lesson.cursor = stepIndex;
    let step = lesson.steps[stepIndex];
    if (!isReady(step)) {
      renderLesson();
      status(ui['speech-status'], 'Drawing the next step…');
      const result = await Promise.race([stepReady(step), released]);
      if (playback !== current) return;
      status(ui['speech-status']);
      if (result !== 'ready') {
        playback = null;
        renderLesson();
        status(ui['speech-status'], 'This step could not be drawn. Use Retry in the outline.', true);
        return;
      }
      step = lesson.steps[stepIndex];
      redraw = true;
    }
    if (redraw) {
      renderLesson('none');
      await board.show(step, beat - 1);
      if (playback !== current) return;
    }
    redraw = true;
    for (let index = beat; index < step.beats.length; index += 1) {
      current.stepIndex = stepIndex;
      current.beat = index;
      highlightBeat(index);
      const { say, draw } = step.beats[index];
      const duration = beatDuration(say, draw.length);
      current.drawing = board.drawBeat(index, duration);
      await Promise.all([readAloud(say, duration), current.drawing.done]);
      if (playback !== current) return;
    }
    if (untilEndOfStep || stepIndex >= lesson.steps.length - 1) break;
    stepIndex += 1;
    beat = 0;
    lesson.cursor = stepIndex;
    saveLesson();
  }
  if (playback === current) {
    playback = null;
    highlightBeat(-1);
    renderControls();
  }
}

function play() {
  const step = activeStep();
  if (!step) return;
  if (!isReady(step)) return playFrom(lesson.cursor, 0);
  const point = resumePoint;
  resumePoint = null;
  if (point && point.lesson === lesson && point.stepIndex === lesson.cursor) {
    if (point.beat + 1 < step.beats.length) return playFrom(lesson.cursor, point.beat + 1, { continuing: true });
    if (lesson.cursor < lesson.steps.length - 1) return playFrom(lesson.cursor + 1, 0);
  }
  return playFrom(lesson.cursor, 0);
}

async function createLesson(event) {
  event.preventDefault();
  const topic = ui.topic.value.trim();
  if (!topic) {
    status(ui.notice, 'Enter a topic or question.', true);
    return;
  }
  if (!models.length) {
    status(ui.notice, 'Set GEMINI_API_KEY on the server and restart it, or start Ollama and select Refresh. You can try a sample lesson now.', true);
    return;
  }
  haltPlayback();
  const request = new AbortController();
  activeRequest = request;
  const model = ui.model.value;
  const level = ui.level.value;
  const notes = ui.notes.value.trim();
  renderControls();
  status(ui.notice, 'Planning your lesson…');
  let created = null;
  try {
    const outline = await api('/api/outline', { body: { topic, notes, level, model }, signal: request.signal });
    if (activeRequest !== request) return;
    haltPlayback();
    lesson = {
      id: crypto.randomUUID(), title: outline.title, topic, level, model, notes, cursor: 0,
      steps: outline.steps.map(({ heading, goal }) => ({ heading, goal, pending: true }))
    };
    created = lesson;
    ui.followup.value = '';
    status(ui.notice);
    status(ui['speech-status']);
    saveLesson();
  } catch (error) {
    if (activeRequest === request) status(ui.notice, error.message, true);
  } finally {
    if (activeRequest === request) {
      activeRequest = null;
      renderLesson();
      if (created) runQueue(created);
    }
  }
}

function outlineFor(target) {
  const steps = target.steps.filter((step) => !step.question);
  return { steps, outline: { title: target.title, steps: steps.map((step) => ({ heading: step.heading, goal: step.goal || step.heading })) } };
}

function previousLines(target, step) {
  const before = target.steps.slice(0, target.steps.indexOf(step)).filter((item) => isReady(item) && !item.question);
  return before.map((item) => item.heading + ': ' + item.beats.map((beat) => beat.say).join(' ')).join('\n').slice(-4_000);
}

function afterStepChange(target, index) {
  if (target !== lesson) return;
  if (index === lesson.cursor && !playback && !resumePoint) renderLesson();
  else {
    renderControls();
    renderOutline();
  }
}

// Generates the lesson's pending steps one at a time, in order. Steps stay addressable by
// object, so switching lessons mid-way never writes into the wrong lesson.
async function runQueue(target) {
  if (generation) return;
  const controller = new AbortController();
  generation = { lesson: target, controller };
  if (target === lesson) renderLesson(playback || resumePoint ? 'none' : 'full');
  const { topic, notes, level, model } = target;
  try {
    for (let step = target.steps.find((item) => item.pending && !item.failed); step;
      step = target.steps.find((item) => item.pending && !item.failed)) {
      const { steps, outline } = outlineFor(target);
      try {
        const result = await api('/api/step', {
          body: { topic, notes, level, model, outline, index: steps.indexOf(step), previous: previousLines(target, step) },
          signal: controller.signal
        });
        const index = target.steps.indexOf(step);
        if (index === -1) continue;
        target.steps[index] = { ...result, goal: step.goal };
        saveLesson(target);
        settle(step, 'ready');
        afterStepChange(target, index);
      } catch (error) {
        if (controller.signal.aborted || unloading) break;
        step.failed = true;
        step.error = error.message;
        saveLesson(target);
        settle(step, 'failed');
        afterStepChange(target, target.steps.indexOf(step));
      }
    }
  } finally {
    if (controller.signal.aborted && !unloading) {
      for (const step of target.steps.filter((item) => item.pending && !item.failed)) {
        step.failed = true;
        step.error = cancelledMessage;
        settle(step, 'cancelled');
      }
      saveLesson(target);
    }
    generation = null;
    if (target === lesson) renderLesson(playback || resumePoint ? 'none' : 'full');
    else renderControls();
  }
}

const cancelledMessage = 'Generation was cancelled.';

function retryStep(step) {
  if (generation && generation.lesson !== lesson) {
    status(ui['ask-status'], 'Another lesson is still being drawn. Retry once it finishes.');
    return;
  }
  // Retrying a cancelled step resumes every step the cancel stopped.
  const cancelled = step.error === cancelledMessage;
  for (const item of lesson.steps) {
    if (item === step || (cancelled && item.failed && item.error === cancelledMessage)) {
      item.failed = false;
      delete item.error;
    }
  }
  saveLesson();
  status(ui['speech-status']);
  if (generation) renderOutline();
  else runQueue(lesson);
}

function followupContext(target, current) {
  let items = target.steps.slice(Math.max(0, current - 4), current + 1).filter(isReady).map((step) => ({
    current: step === target.steps[current],
    heading: step.heading,
    say: step.beats.map((beat) => beat.say),
    shapes: step.beats.flatMap((beat) => beat.draw.flatMap((shape) => [shape.text, shape.label].filter(Boolean))),
    question: step.question
  }));
  let text = JSON.stringify(items);
  while (text.length > 10_000 && items.length > 1) {
    items = items.slice(1);
    text = JSON.stringify(items);
  }
  return text.slice(0, 10_000);
}

async function askTutor(event) {
  event.preventDefault();
  const question = ui.followup.value.trim();
  if (!question || !lesson || lesson.sample || activeRequest || generation || !isReady(activeStep())) return;
  if (lesson.steps.length >= 45) {
    status(ui['ask-status'], 'This board has reached 45 steps. Start a new lesson to continue.');
    return;
  }
  haltPlayback();
  const request = new AbortController();
  activeRequest = request;
  const current = lesson.cursor;
  const { topic, level, notes, model } = lesson;
  const context = followupContext(lesson, current);
  renderControls();
  status(ui['ask-status'], 'Answering on the whiteboard…');
  try {
    const answer = await api('/api/followup', {
      body: { topic, level, notes, model, question, context }, signal: request.signal
    });
    if (activeRequest !== request) return;
    lesson.steps.splice(current + 1, 0, { ...answer, question });
    lesson.cursor = current + 1;
    ui.followup.value = '';
    saveLesson();
    activeRequest = null;
    renderLesson();
    status(ui['ask-status'], 'Follow-up added. Play the lesson to hear this answer.');
  } catch (error) {
    if (activeRequest !== request) return;
    activeRequest = null;
    renderLesson();
    status(ui['ask-status'], error.message, true);
  }
}

function useMic(button, target, message) {
  if (!Recognition) return;
  button.hidden = false;
  button.setAttribute('aria-pressed', 'false');
  button.addEventListener('click', () => {
    if (recognition) {
      recognition.abort();
      return;
    }
    stopPlayback();
    const listener = new Recognition();
    recognition = listener;
    listener.lang = navigator.language || 'en';
    listener.onresult = (event) => {
      const spoken = event.results[0][0].transcript.trim();
      target.value = [target.value.trim(), spoken].filter(Boolean).join(' ').slice(0, target.maxLength);
      status(message);
    };
    listener.onerror = (event) => {
      if (event.error !== 'aborted') status(message, 'Microphone input is unavailable. You can type your question.', true);
    };
    listener.onend = () => {
      recognition = null;
      button.setAttribute('aria-pressed', 'false');
    };
    try {
      listener.start();
      button.setAttribute('aria-pressed', 'true');
    } catch {
      recognition = null;
      status(message, 'Microphone input is unavailable. You can type your question.', true);
    }
  });
}

ui['topic-form'].addEventListener('submit', createLesson);
ui['followup-form'].addEventListener('submit', askTutor);
ui['refresh-models'].addEventListener('click', loadModels);
ui.cancel.addEventListener('click', () => {
  cancelRequest();
  generation?.controller.abort();
  status(ui.notice, 'Request cancelled.');
  if (lesson && !lesson.sample) status(ui['ask-status']);
});
ui['new-lesson'].addEventListener('click', () => {
  openLesson(null);
  ui.topic.value = '';
  ui.notes.value = '';
  ui['notes-file'].value = '';
  ui['notes-panel'].open = false;
  ui.topic.focus();
});
for (const button of document.querySelectorAll('[data-sample]')) {
  button.addEventListener('click', () => openLesson(makeSample(button.dataset.sample)));
}
ui.back.addEventListener('click', () => moveTo(lesson.cursor - 1));
ui.next.addEventListener('click', () => moveTo(lesson.cursor + 1));
ui.play.addEventListener('click', () => (playback ? stopPlayback() : play()));
ui.replay.addEventListener('click', () => {
  if (!activeStep()) return;
  haltPlayback();
  playFrom(lesson.cursor, 0, { untilEndOfStep: true });
});
ui.narration.addEventListener('change', () => {
  if (!ui.narration.checked) {
    stopVoice();
    status(ui['speech-status']);
  }
});
ui['notes-file'].addEventListener('change', async () => {
  const file = ui['notes-file'].files[0];
  if (!file) return;
  if (file.size > 48_000 || !/\.(txt|md|csv)$/i.test(file.name)) {
    status(ui.notice, 'Choose a TXT, MD, or CSV file up to 48 KB.', true);
    return;
  }
  const notes = await file.text();
  if (notes.length > 12_000 || notes.includes('\0')) {
    status(ui.notice, 'Choose a text file with up to 12,000 characters.', true);
    return;
  }
  ui.notes.value = notes;
  status(ui.notice, 'Study notes added.');
});

for (const event of ['beforeunload', 'pagehide']) window.addEventListener(event, () => { unloading = true; });
useMic(ui['topic-mic'], ui.topic, ui.notice);
useMic(ui['ask-mic'], ui.followup, ui['ask-status']);
renderLesson();
loadModels();
