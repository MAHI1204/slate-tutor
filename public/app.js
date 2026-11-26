import { samples } from './samples.js';

const ui = Object.fromEntries([...document.querySelectorAll('[id]')].map((item) => [item.id, item]));
const historyKey = 'slate-tutor-history-v1';
const speech = window.speechSynthesis;
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let saved = readSaved();
let lesson = null;
let libraryOpen = false;
let activeRequest = null;
let models = [];
let modelCheck = 0;
let playback = null;
let speechTimer;
let stopTalking;
let recognition;

function makeSample(key) {
  const sample = structuredClone(samples[key]);
  return { ...sample, sample: true, topic: sample.title, cursor: 0, level: 'Beginner' };
}

function readSaved() {
  try {
    const data = JSON.parse(localStorage.getItem(historyKey) || '[]');
    return Array.isArray(data) ? data.filter((value) => value?.id && value.steps?.length > 0) : [];
  } catch {
    return [];
  }
}

function saveLesson() {
  if (!lesson || lesson.sample) return;
  saved = [lesson, ...saved.filter((item) => item.id !== lesson.id)].slice(0, 15);
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
  ui['recent-section'].hidden = !entries.length;
  ui.recent.replaceChildren(...saved.slice(0, 3).map((item) => {
    const button = element('button', item.title);
    button.prepend(element('small', 'Resume · Step ' + (item.cursor + 1)));
    button.addEventListener('click', () => openLesson(item));
    return button;
  }));
  ui.history.replaceChildren(...(entries.length ? entries : [element('p', 'Your generated lessons will appear here.')]));
}

function activeStep() {
  return lesson?.steps[lesson.cursor];
}

function revealAll() {
  for (const item of ui.diagram.children) item.classList.remove('pending');
}

function stopVoice() {
  stopTalking?.();
  if (speech) speech.cancel();
}

function stopPlayback() {
  playback = null;
  stopVoice();
  revealAll();
  renderControls();
}

function renderControls() {
  const busy = Boolean(activeRequest);
  ui.generate.disabled = busy;
  ui.cancel.hidden = !busy;
  ui.ask.disabled = busy || Boolean(lesson?.sample);
  ui.back.disabled = busy || !lesson || lesson.cursor === 0;
  ui.next.disabled = busy || !lesson || lesson.cursor === lesson.steps.length - 1;
  ui.play.disabled = busy || !lesson;
  ui.play.textContent = playback ? 'Pause lesson' : 'Play lesson';
}

function renderBoard(step) {
  const diagram = step.diagram;
  ui.diagram.className = 'diagram diagram-' + diagram.type;
  const fragment = document.createDocumentFragment();
  diagram.items.forEach(({ label, detail }, index) => {
    if (index > 0 && diagram.type === 'flow') {
      const arrow = element('span', '→', 'connector');
      arrow.setAttribute('aria-hidden', 'true');
      fragment.append(arrow);
    }
    const card = element('div', '', 'board-card');
    if (diagram.type === 'steps') card.append(element('span', String(index + 1), 'board-number'));
    card.append(element('strong', label), element('p', detail));
    fragment.append(card);
  });
  ui.diagram.replaceChildren(fragment);
  ui.board.classList.remove('stage-forward');
  if (!playback) {
    requestAnimationFrame(() => {
      if (!playback) ui.board.classList.add('stage-forward');
    });
  }
}

function renderLesson() {
  renderHistory();
  renderControls();
  const step = activeStep();
  ui.lesson.hidden = !step;
  ui.home.hidden = Boolean(step) || libraryOpen;
  ui.library.hidden = !libraryOpen;
  if (!step) return;
  ui['lesson-type'].textContent = lesson.sample ? 'Sample lesson' : lesson.level;
  ui['lesson-title'].textContent = lesson.title;
  ui['step-title'].textContent = step.heading;
  ui.counter.textContent = 'Step ' + (lesson.cursor + 1) + ' of ' + lesson.steps.length;
  ui.explanation.textContent = step.explanation;
  if (lesson.sample) {
    status(ui['ask-status'], 'Create a custom lesson to ask your own follow-up questions.');
  } else if (!activeRequest) {
    status(ui['ask-status']);
  }
  ui.followup.disabled = Boolean(lesson.sample);
  ui['ask-mic'].disabled = Boolean(lesson.sample);
  renderBoard(step);
  const steps = lesson.steps.map(({ heading, question }, index) => {
    const row = element('li');
    const button = element('button');
    button.type = 'button';
    if (index === lesson.cursor) button.setAttribute('aria-current', 'step');
    button.append(element('span', String(index + 1)), element('span', question ? 'Follow-up: ' + heading : heading));
    button.addEventListener('click', () => {
      if (!activeRequest) moveTo(index);
    });
    row.append(button);
    return row;
  });
  ui.outline.replaceChildren(...steps);
}

function cancelRequest() {
  activeRequest?.abort();
  activeRequest = null;
  renderControls();
}

function openLesson(value) {
  cancelRequest();
  stopPlayback();
  libraryOpen = false;
  lesson = value;
  ui.followup.value = '';
  status(ui.notice);
  status(ui['speech-status']);
  renderLesson();
}

function moveTo(index) {
  stopPlayback();
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

function readAloud(text) {
  if (!speech || !ui.narration.checked || !speech.getVoices().length) {
    if (ui.narration.checked) status(ui['speech-status'], 'No browser voice is available. Follow the written explanation.');
    return hold(1400);
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
    utterance.lang = { German: 'de-DE', Telugu: 'te-IN' }[lesson.language] || 'en-US';
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

async function playFromHere() {
  const run = Symbol();
  playback = run;
  status(ui['speech-status']);
  while (playback === run) {
    renderLesson();
    const step = activeStep();
    const blocks = [...ui.diagram.children];
    for (const node of blocks.slice(1)) node.classList.add('pending');
    await readAloud(step.explanation);
    if (playback !== run) return;
    for (const node of blocks.slice(1)) {
      node.classList.remove('pending');
      if (node.classList.contains('connector')) continue;
      await readAloud(node.textContent);
      if (playback !== run) return;
    }
    if (lesson.cursor === lesson.steps.length - 1) break;
    lesson.cursor += 1;
    saveLesson();
  }
  if (playback === run) stopPlayback();
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
  stopPlayback();
  const request = new AbortController();
  activeRequest = request;
  const model = ui.model.value;
  const level = ui.level.value;
  const notes = ui.notes.value.trim();
  const mode = document.querySelector('input[name="mode"]:checked').value;
  const language = ui.language.value;
  renderControls();
  status(ui.notice, 'Preparing your whiteboard lesson…');
  try {
    const response = await api('/api/lesson', { body: { topic, notes, level, model, mode, language }, signal: request.signal });
    if (activeRequest !== request) return;
    lesson = { ...response, id: crypto.randomUUID(), topic, level, model, notes, mode, language, cursor: 0 };
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
    }
  }
}

async function askTutor(event) {
  event.preventDefault();
  const question = ui.followup.value.trim();
  if (!question || !lesson || lesson.sample || activeRequest) return;
  if (lesson.steps.length >= 45) {
    status(ui['ask-status'], 'This board has reached 45 steps. Start a new lesson to continue.');
    return;
  }
  stopPlayback();
  const request = new AbortController();
  activeRequest = request;
  const current = lesson.cursor;
  const { topic, level, notes, model } = lesson;
  const prior = lesson.steps.slice(Math.max(0, current - 4), current + 1).map((step, index, context) => ({
    current: index === context.length - 1,
    heading: step.heading, explanation: step.explanation, diagram: step.diagram, question: step.question
  }));
  renderControls();
  status(ui['ask-status'], 'Answering on the whiteboard…');
  try {
    const answer = await api('/api/followup', {
      body: { topic, level, notes, model, language: lesson.language, mode: lesson.mode, question, context: JSON.stringify(prior) }, signal: request.signal
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
  status(ui.notice, 'Request cancelled.');
  if (lesson && !lesson.sample) status(ui['ask-status']);
});
ui['library-tab'].addEventListener('click', () => {
  openLesson(null);
  libraryOpen = true;
  renderLesson();
});
ui['import-article'].addEventListener('click', async () => {
  const button = ui['import-article'];
  button.disabled = true;
  try {
    const source = await api('/api/article', {body: {url: ui.article.value.trim()}});
    const combined = [ui.notes.value.trim(), source.text].filter(Boolean).join('\n\n');
    if (combined.length > 12000) throw new Error('Shorten your existing notes before importing this article.');
    ui.notes.value = combined;
    if (!ui.topic.value.trim()) ui.topic.value = source.title.slice(0, 500);
    status(ui.notice, 'Introduction added to your notes. Review it before starting.');
  } catch (error) { status(ui.notice, error.message, true); }
  finally { button.disabled = false; }
});
ui['new-lesson'].addEventListener('click', () => {
  openLesson(null);
  ui.topic.value = '';
  ui.notes.value = '';
  ui.article.value = '';
  ui['notes-file'].value = '';
  ui['notes-panel'].open = false;
  ui.topic.focus();
});
for (const button of document.querySelectorAll('[data-sample]')) {
  button.addEventListener('click', () => openLesson(makeSample(button.dataset.sample)));
}
ui.back.addEventListener('click', () => moveTo(lesson.cursor - 1));
ui.next.addEventListener('click', () => moveTo(lesson.cursor + 1));
ui.play.addEventListener('click', () => playback ? stopPlayback() : playFromHere());
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

useMic(ui['topic-mic'], ui.topic, ui.notice);
useMic(ui['ask-mic'], ui.followup, ui['ask-status']);
renderLesson();
loadModels();
