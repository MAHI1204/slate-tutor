// The board's shape vocabulary, shared by the server and the browser.
// normalizeStep validates and repairs a step from the model (or from a sample or saved
// lesson): bad shapes are dropped one at a time, geometry is clamped to the board, and a
// step that ends up with nothing drawable gets a plain text board.

import { parseExpression } from './board-math.js';

export const GRID = { width: 16, height: 9 };
export const SHAPE_KINDS = ['text', 'equation', 'box', 'circle', 'arrow', 'line', 'axes', 'plot', 'point', 'highlight'];
export const LIMITS = { beats: 6, shapesPerBeat: 4, shapesPerStep: 16, say: 300, text: 80, heading: 72 };

const SIZES = ['title', 'body', 'small'];
const ALIGNS = ['left', 'center'];
const MIN_BOX = 0.3;
const MIN_AXES = 1;

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

function number(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function pair(value) {
  if (!Array.isArray(value) || value.length !== 2) return undefined;
  const a = number(value[0]);
  const b = number(value[1]);
  return a === undefined || b === undefined ? undefined : [a, b];
}

function range(value) {
  const values = pair(value);
  return values && values[0] < values[1] ? values : undefined;
}

function boardPoint(value, margin = [0, 0]) {
  const point = pair(value);
  if (!point) return undefined;
  return [clamp(point[0], 0, GRID.width - margin[0]), clamp(point[1], 0, GRID.height - margin[1])];
}

function truncate(value, max) {
  if (typeof value !== 'string') return undefined;
  const text = value.trim().replace(/\s+/g, ' ');
  if (!text) return undefined;
  const chars = [...text];
  if (chars.length <= max) return text;
  return chars.slice(0, max - 1).join('').trimEnd() + '…';
}

function sayText(value) {
  if (typeof value !== 'string') return undefined;
  const text = value.trim().replace(/\s+/g, ' ');
  if (!text) return undefined;
  const chars = [...text];
  if (chars.length <= LIMITS.say) return text;
  let cut = chars.slice(0, LIMITS.say - 1).join('');
  const space = cut.lastIndexOf(' ');
  if (space > 0) cut = cut.slice(0, space);
  return cut.trimEnd() + '…';
}

function identifier(value) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 40) : undefined;
}

function optional(shape, key, value) {
  if (value !== undefined) shape[key] = value;
  return shape;
}

// Resolves an arrow/line endpoint: an id (which must already exist) wins over coordinates.
function endpoint(id, coordinates, seen) {
  const ref = identifier(id) ?? (typeof coordinates === 'string' ? identifier(coordinates) : undefined);
  if (ref !== undefined) return seen.has(ref) ? ref : null;
  return boardPoint(coordinates) ?? null;
}

function sized(raw, minimum) {
  const at = boardPoint(raw.at, [minimum, minimum]);
  const w = number(raw.w);
  const h = number(raw.h);
  if (!at || w === undefined || h === undefined) return null;
  return {
    at,
    w: clamp(w, minimum, GRID.width - at[0]),
    h: clamp(h, minimum, GRID.height - at[1])
  };
}

function normalizeShape(raw, seen) {
  if (!raw || typeof raw !== 'object' || !SHAPE_KINDS.includes(raw.kind)) return null;
  const { kind } = raw;
  const label = truncate(raw.label, LIMITS.text);
  let shape;
  switch (kind) {
    case 'text':
    case 'equation': {
      const at = boardPoint(raw.at);
      const text = truncate(raw.text, LIMITS.text);
      if (!at || !text) return null;
      shape = { kind, at, text };
      if (kind === 'text') {
        shape.size = SIZES.includes(raw.size) ? raw.size : 'body';
        shape.align = ALIGNS.includes(raw.align) ? raw.align : 'left';
      }
      break;
    }
    case 'box': {
      const geometry = sized(raw, MIN_BOX);
      if (!geometry) return null;
      shape = optional({ kind, ...geometry }, 'label', label);
      break;
    }
    case 'circle': {
      const at = boardPoint(raw.at);
      const r = number(raw.r);
      if (!at || r === undefined) return null;
      shape = optional({ kind, at, r: clamp(r, 0.2, 4.5) }, 'label', label);
      break;
    }
    case 'arrow':
    case 'line': {
      const from = endpoint(raw.fromId, raw.from, seen);
      const to = endpoint(raw.toId, raw.to, seen);
      if (from === null || to === null) return null;
      shape = optional({ kind, from, to }, 'label', label);
      if (kind === 'line' && raw.dashed === true) shape.dashed = true;
      break;
    }
    case 'axes': {
      const geometry = sized(raw, MIN_AXES);
      const xRange = range(raw.xRange);
      const yRange = range(raw.yRange);
      if (!geometry || !xRange || !yRange) return null;
      shape = { kind, ...geometry, xRange, yRange };
      optional(shape, 'xLabel', truncate(raw.xLabel, LIMITS.text));
      optional(shape, 'yLabel', truncate(raw.yLabel, LIMITS.text));
      break;
    }
    case 'plot': {
      const axesId = identifier(raw.axes);
      const axes = axesId && seen.get(axesId);
      const fn = typeof raw.fn === 'string' ? raw.fn.trim() : '';
      if (!axes || axes.kind !== 'axes' || !parseExpression(fn).ok) return null;
      shape = { kind, axes: axesId, fn };
      const domain = pair(raw.domain);
      if (domain) {
        const clipped = [clamp(domain[0], ...axes.xRange), clamp(domain[1], ...axes.xRange)];
        if (clipped[0] < clipped[1]) shape.domain = clipped;
      }
      optional(shape, 'label', label);
      break;
    }
    case 'point': {
      const axesId = identifier(raw.axes);
      if (axesId !== undefined) {
        const axes = seen.get(axesId);
        const at = pair(raw.at);
        if (!axes || axes.kind !== 'axes' || !at) return null;
        shape = { kind, at: [clamp(at[0], ...axes.xRange), clamp(at[1], ...axes.yRange)], axes: axesId };
      } else {
        const at = boardPoint(raw.at);
        if (!at) return null;
        shape = { kind, at };
      }
      optional(shape, 'label', label);
      break;
    }
    case 'highlight': {
      const target = identifier(raw.target);
      if (!target || !seen.has(target)) return null;
      shape = { kind, target };
      break;
    }
  }
  // Highlights are not targets: an arrow or highlight pointing at one has nowhere to go.
  const id = kind === 'highlight' ? undefined : identifier(raw.id);
  if (id !== undefined && !seen.has(id)) {
    shape.id = id;
    seen.set(id, shape);
  }
  return shape;
}

const round = (value) => Math.round(value * 100) / 100;

function fallbackBoard(heading, beats) {
  beats.forEach((beat, index) => {
    if (index === 0) beat.draw.push({ kind: 'text', at: [0.6, 0.5], text: heading, size: 'title', align: 'left' });
    beat.draw.push({ kind: 'text', at: [0.6, round(1.7 + 1.2 * index)], text: truncate(beat.say, LIMITS.text), size: 'body', align: 'left' });
  });
}

export function normalizeStep(raw, { fallbackHeading } = {}) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.beats)) return null;
  const heading = truncate(raw.heading, LIMITS.heading) ?? truncate(fallbackHeading, LIMITS.heading);
  if (!heading) return null;
  const seen = new Map();
  const beats = [];
  let total = 0;
  for (const rawBeat of raw.beats) {
    if (beats.length >= LIMITS.beats) break;
    const say = sayText(rawBeat?.say);
    if (!say) continue;
    const draw = [];
    for (const rawShape of Array.isArray(rawBeat.draw) ? rawBeat.draw : []) {
      if (draw.length >= LIMITS.shapesPerBeat || total >= LIMITS.shapesPerStep) break;
      const shape = normalizeShape(rawShape, seen);
      if (!shape) continue;
      draw.push(shape);
      total += 1;
    }
    beats.push({ say, draw });
  }
  if (!beats.length) return null;
  if (total === 0) fallbackBoard(heading, beats);
  const step = { heading, explanation: beats.map((beat) => beat.say).join(' '), beats };
  optional(step, 'question', truncate(raw.question, 500));
  optional(step, 'goal', truncate(raw.goal, 160));
  return step;
}

export function isLegacyStep(step) {
  return Boolean(step && typeof step === 'object' && step.diagram && !Array.isArray(step.beats));
}

// Old lessons stored 2–4 text cards per step. Each card becomes a beat with its own shapes.
function legacyShapes(type, items) {
  const n = items.length;
  const margin = 0.6;
  return items.map(({ label, detail }, i) => {
    if (type === 'steps') {
      return [{ kind: 'text', at: [0.8, round(1.2 + i * 1.6)], text: (i + 1) + '. ' + label + ': ' + detail, size: 'body', align: 'left' }];
    }
    const gap = type === 'flow' ? 0.9 : 0.6;
    const w = round((GRID.width - 2 * margin - (n - 1) * gap) / n);
    const x = round(margin + i * (w + gap));
    const y = type === 'flow' ? 3 : 1.5;
    const shapes = [
      { kind: 'box', id: 'item' + i, at: [x, y], w, h: type === 'flow' ? 2.2 : 1.6, label },
      { kind: 'text', at: [round(x + w / 2), round(y + (type === 'flow' ? 2.6 : 2))], text: detail, size: 'small', align: 'center' }
    ];
    if (type === 'flow' && i > 0) shapes.push({ kind: 'arrow', from: 'item' + (i - 1), to: 'item' + i });
    return shapes;
  });
}

// Splits text into chunks of at most LIMITS.say characters, at sentence ends where
// possible and otherwise at spaces, so old explanations (up to 750 characters) survive.
function chunkText(text) {
  const words = String(text ?? '').trim().split(/\s+/).filter(Boolean);
  const chunks = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? current + ' ' + word : word;
    if ([...candidate].length <= LIMITS.say) {
      current = candidate;
      continue;
    }
    // Prefer to break after the last full sentence in the current chunk.
    const sentenceEnd = current.search(/[.!?](?=[^.!?]*$)/);
    if (sentenceEnd > 0 && sentenceEnd < current.length - 1) {
      chunks.push(current.slice(0, sentenceEnd + 1));
      current = current.slice(sentenceEnd + 1).trim() + ' ' + word;
    } else {
      if (current) chunks.push(current);
      current = word;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export function legacyToBeats(step) {
  const items = (Array.isArray(step?.diagram?.items) ? step.diagram.items : [])
    .map((item) => ({ label: String(item?.label ?? ''), detail: String(item?.detail ?? '') }));
  const type = ['flow', 'compare', 'steps'].includes(step?.diagram?.type) ? step.diagram.type : 'steps';
  const shapes = legacyShapes(type, items);
  const chunks = chunkText(step?.explanation || step?.heading);
  const beats = chunks.map((say, i) => ({ say, draw: i === 0 ? shapes[0] ?? [] : [] }));
  const itemBeats = items.slice(1).map((item, i) => ({ say: item.label + '. ' + item.detail, draw: shapes[i + 1] }));
  const room = Math.max(0, LIMITS.beats - beats.length);
  beats.push(...itemBeats.slice(0, room));
  // In the rare case that there is no room left, the remaining items' shapes join the last beat.
  for (const extra of itemBeats.slice(room)) beats[beats.length - 1].draw.push(...extra.draw);
  return normalizeStep({ heading: step?.heading, question: step?.question, beats });
}
