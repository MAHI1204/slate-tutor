// Browser renderer for the drawing board. Lays out a step with board-layout.js, renders
// each shape as hand-drawn SVG, and animates one beat at a time: strokes are drawn with
// stroke-dashoffset and text is revealed left to right through an animated clip.

import { dataPoint, layoutStep } from './board-layout.js';
import { parseExpression, sampleFunction } from './board-math.js';

const NS = 'http://www.w3.org/2000/svg';
const UNIT = 100;
const FONT_PX = { title: 72, body: 52, small: 40, equation: 58, label: 40 };
const FONT_FAMILY = 'Caveat';

let fontReady;
function waitForFont() {
  if (!fontReady) {
    const load = document.fonts?.load ? document.fonts.load('48px ' + FONT_FAMILY).catch(() => {}) : Promise.resolve();
    fontReady = Promise.race([load, new Promise((resolve) => setTimeout(resolve, 1500))]);
  }
  return fontReady;
}

function node(tag, attributes = {}, parent) {
  const element = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value !== undefined && value !== null) element.setAttribute(key, String(value));
  }
  parent?.append(element);
  return element;
}

function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const f = (value) => Math.round(value * 10) / 10;

// A slightly bowed line between two points, in pixels.
function roughSegment(rand, [x1, y1], [x2, y2], move = true) {
  const j = () => (rand() - 0.5) * 3;
  const length = Math.hypot(x2 - x1, y2 - y1);
  const bow = (rand() - 0.5) * Math.min(8, length * 0.02);
  const nx = length ? -(y2 - y1) / length : 0;
  const ny = length ? (x2 - x1) / length : 0;
  const mx = (x1 + x2) / 2 + nx * bow;
  const my = (y1 + y2) / 2 + ny * bow;
  return (move ? 'M' + f(x1 + j()) + ' ' + f(y1 + j()) : '') + ' Q' + f(mx) + ' ' + f(my) + ' ' + f(x2 + j()) + ' ' + f(y2 + j());
}

function roughRect(rand, x, y, w, h) {
  const corners = [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
  let d = '';
  for (let i = 0; i < 4; i += 1) d += roughSegment(rand, corners[i], corners[i + 1], i === 0);
  return d;
}

function roughEllipse(rand, cx, cy, rx, ry, overshoot = 0.12) {
  const start = rand() * Math.PI * 2;
  const total = Math.PI * 2 * (1 + overshoot);
  const steps = 44;
  let d = '';
  for (let i = 0; i <= steps; i += 1) {
    const angle = start + (total * i) / steps;
    const wobble = 1 + (rand() - 0.5) * 0.04;
    const x = cx + Math.cos(angle) * rx * wobble;
    const y = cy + Math.sin(angle) * ry * wobble;
    d += (i === 0 ? 'M' : ' L') + f(x) + ' ' + f(y);
  }
  return d;
}

function arrowHead(rand, [x1, y1], [x2, y2], size = 20) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const spread = 0.45 + (rand() - 0.5) * 0.08;
  const a = [x2 - size * Math.cos(angle - spread), y2 - size * Math.sin(angle - spread)];
  const b = [x2 - size * Math.cos(angle + spread), y2 - size * Math.sin(angle + spread)];
  return 'M' + f(a[0]) + ' ' + f(a[1]) + ' L' + f(x2) + ' ' + f(y2) + ' L' + f(b[0]) + ' ' + f(b[1]);
}

const px = ([x, y]) => [x * UNIT, y * UNIT];

// Several boards can share a page (the cumulative slate), so clip ids carry a board number.
let boardCount = 0;

export function createBoard(svg, { reducedMotion = false } = {}) {
  const boardId = ++boardCount;
  let token = 0;
  let beats = [];
  let running = [];
  let measured = new Map();
  let measureLayer;
  let clipCount = 0;
  let defs;

  function measureText(text, size, cls = 'ink') {
    const key = size + '|' + cls + '|' + text;
    if (!measured.has(key)) {
      const probe = node('text', { x: 0, y: 0, 'font-size': FONT_PX[size], class: cls }, measureLayer);
      probe.textContent = text;
      const box = probe.getBBox();
      probe.remove();
      measured.set(key, { w: box.width, h: box.height, ascent: -box.y });
    }
    return measured.get(key);
  }

  const measure = (item) => {
    const size = item.kind === 'equation' ? 'equation' : item.kind === 'label' ? 'label' : item.size || 'body';
    const { w, h } = measureText(item.text, size);
    return { w: w / UNIT, h: h / UNIT };
  };

  function textNode(parent, text, { x, top, size, align = 'left', cls = 'ink', maxWidth }) {
    let fontSize = FONT_PX[size];
    let metrics = measureText(text, size, cls);
    if (maxWidth && metrics.w > maxWidth) {
      fontSize = Math.max(20, Math.floor((fontSize * maxWidth) / metrics.w));
      metrics = { w: (metrics.w * fontSize) / FONT_PX[size], h: (metrics.h * fontSize) / FONT_PX[size], ascent: (metrics.ascent * fontSize) / FONT_PX[size] };
    }
    const element = node('text', {
      x: f(x), y: f(top + metrics.ascent), 'font-size': fontSize, class: cls, 'text-anchor': align === 'center' ? 'middle' : 'start'
    }, parent);
    element.textContent = text;
    const left = align === 'center' ? x - metrics.w / 2 : x;
    const clipId = 'board-' + boardId + '-clip-' + token + '-' + clipCount++;
    const clip = node('clipPath', { id: clipId, clipPathUnits: 'userSpaceOnUse' }, defs);
    const rect = node('rect', { x: f(left - 6), y: f(top - 8), width: f(metrics.w + 12), height: f(metrics.h + 16) }, clip);
    element.setAttribute('clip-path', 'url(#' + clipId + ')');
    return { kind: 'text', element, rect, left: left - 6 };
  }

  function strokePath(parent, d, cls = 'stroke', extra = {}) {
    const element = node('path', { d, class: cls, ...extra }, parent);
    return { kind: 'stroke', element };
  }

  function renderShape(shape, all, seed) {
    const rand = mulberry32(seed);
    const group = node('g');
    const parts = [];
    const add = (part) => (parts.push(part), part);
    switch (shape.kind) {
      case 'text':
        add(textNode(group, shape.text, { x: shape.box.x * UNIT + (shape.align === 'center' ? (shape.box.w * UNIT) / 2 : 0), top: shape.box.y * UNIT, size: shape.size, align: shape.align }));
        break;
      case 'equation':
        add(textNode(group, shape.text, { x: shape.box.x * UNIT, top: shape.box.y * UNIT, size: 'equation', cls: 'ink accent' }));
        break;
      case 'box': {
        const { x, y, w, h } = shape.box;
        add(strokePath(group, roughRect(rand, x * UNIT, y * UNIT, w * UNIT, h * UNIT)));
        add(strokePath(group, roughRect(rand, x * UNIT, y * UNIT, w * UNIT, h * UNIT), 'stroke faint'));
        if (shape.label) {
          const size = 'body';
          const m = measureText(shape.label, size);
          add(textNode(group, shape.label, { x: (x + w / 2) * UNIT, top: (y + h / 2) * UNIT - m.h / 2, size, align: 'center', maxWidth: w * UNIT - 24 }));
        }
        break;
      }
      case 'circle': {
        const [cx, cy] = px(shape.at);
        const r = shape.r * UNIT;
        add(strokePath(group, roughEllipse(rand, cx, cy, r, r)));
        if (shape.label) {
          const m = measureText(shape.label, 'small');
          add(textNode(group, shape.label, { x: cx, top: cy - m.h / 2, size: 'small', align: 'center', maxWidth: r * 1.7 }));
        }
        break;
      }
      case 'arrow':
      case 'line': {
        const [a, b] = shape.points.map(px);
        const dashed = shape.kind === 'line' && shape.dashed;
        add(strokePath(group, roughSegment(rand, a, b), dashed ? 'stroke dashed' : 'stroke', dashed ? { 'stroke-dasharray': '14 12' } : {}));
        if (shape.kind === 'arrow') add(strokePath(group, arrowHead(rand, a, b)));
        if (shape.label) {
          const m = measureText(shape.label, 'small');
          const mx = (a[0] + b[0]) / 2;
          const my = (a[1] + b[1]) / 2;
          add(textNode(group, shape.label, { x: mx, top: my - m.h - 10, size: 'small', align: 'center', cls: 'ink dim' }));
        }
        break;
      }
      case 'axes': {
        const { x, y, w, h } = shape.box;
        const [x0, x1] = shape.xRange;
        const [y0, y1] = shape.yRange;
        const originX = x0 <= 0 && x1 >= 0 ? dataPoint(shape, [0, y0])[0] : x;
        const originY = y0 <= 0 && y1 >= 0 ? dataPoint(shape, [x0, 0])[1] : y + h;
        const xa = [x * UNIT, originY * UNIT];
        const xb = [(x + w) * UNIT, originY * UNIT];
        const ya = [originX * UNIT, (y + h) * UNIT];
        const yb = [originX * UNIT, y * UNIT];
        add(strokePath(group, roughSegment(rand, xa, xb) + ' ' + arrowHead(rand, xa, xb, 16)));
        add(strokePath(group, roughSegment(rand, ya, yb) + ' ' + arrowHead(rand, ya, yb, 16)));
        const tick = (value) => (Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100));
        add(textNode(group, tick(x1), { x: xb[0] - 30, top: xb[1] + 10, size: 'small', align: 'center', cls: 'ink dim' }));
        const yTick = tick(y1);
        add(textNode(group, yTick, { x: yb[0] - 12 - measureText(yTick, 'small', 'ink dim').w, top: yb[1] + 4, size: 'small', cls: 'ink dim' }));
        if (shape.xLabel) add(textNode(group, shape.xLabel, { x: xb[0], top: xb[1] + 40, size: 'small', align: 'center' }));
        if (shape.yLabel) add(textNode(group, shape.yLabel, { x: yb[0] + 18, top: yb[1] - 14, size: 'small' }));
        break;
      }
      case 'plot': {
        const axes = all.get(shape.axes);
        const parsed = parseExpression(shape.fn);
        if (!axes || !parsed.ok) break;
        const segments = sampleFunction(parsed.evaluate, shape.domain ?? axes.xRange, axes.yRange)
          .map((segment) => segment.map((p) => px(dataPoint(axes, p))));
        if (!segments.length) break;
        const d = segments.map((segment) => segment.map(([sx, sy], i) => (i ? 'L' : 'M') + f(sx) + ' ' + f(sy)).join(' ')).join(' ');
        const clipId = 'board-' + boardId + '-plot-' + token + '-' + clipCount++;
        const clip = node('clipPath', { id: clipId, clipPathUnits: 'userSpaceOnUse' }, defs);
        const { x, y, w, h } = axes.box;
        node('rect', { x: x * UNIT - 4, y: y * UNIT - 4, width: w * UNIT + 8, height: h * UNIT + 8 }, clip);
        add(strokePath(group, d, 'stroke accent', { 'clip-path': 'url(#' + clipId + ')' }));
        if (shape.label) {
          const visible = segments.flat().filter(([, sy]) => sy >= y * UNIT && sy <= (y + h) * UNIT);
          const [lx, ly] = visible.length ? visible[visible.length - 1] : segments[0][0];
          const m = measureText(shape.label, 'small', 'ink accent');
          const left = Math.min(lx + 10, (x + w) * UNIT - m.w);
          add(textNode(group, shape.label, { x: left, top: Math.max(y * UNIT, ly - m.h - 6), size: 'small', cls: 'ink accent' }));
        }
        break;
      }
      case 'point': {
        const at = shape.axes ? px(dataPoint(all.get(shape.axes), shape.at)) : px(shape.at);
        add(strokePath(group, roughEllipse(rand, at[0], at[1], 7, 7, 0.3), 'stroke accent dot'));
        if (shape.label) {
          const m = measureText(shape.label, 'small');
          add(textNode(group, shape.label, { x: at[0] + 14, top: at[1] - m.h - 2, size: 'small' }));
        }
        break;
      }
      case 'highlight': {
        const { x, y, w, h } = shape.box;
        add(strokePath(group, roughEllipse(rand, (x + w / 2) * UNIT, (y + h / 2) * UNIT, (w / 2) * UNIT * 1.12, (h / 2) * UNIT * 1.25, 0.18), 'stroke accent'));
        break;
      }
    }
    return { group, parts };
  }

  function cancelRunning() {
    for (const animation of running) animation.cancel();
    running = [];
  }

  function animatePart(part, delay, duration) {
    if (part.kind === 'stroke') {
      const length = Math.max(1, part.element.getTotalLength?.() ?? 1);
      if (part.element.classList.contains('dashed') || part.element.classList.contains('dot')) {
        return part.element.animate([{ opacity: 0 }, { opacity: 1 }], { duration, delay, fill: 'both', easing: 'ease-out' });
      }
      part.element.setAttribute('stroke-dasharray', f(length) + ' ' + f(length));
      const animation = part.element.animate(
        [{ strokeDashoffset: length }, { strokeDashoffset: 0 }],
        { duration, delay, fill: 'both', easing: 'ease-in-out' });
      animation.finished.then(() => part.element.removeAttribute('stroke-dasharray'), () => {});
      return animation;
    }
    const x = part.left;
    return part.rect.animate(
      [{ transform: 'translate(' + x + 'px, 0) scale(0, 1) translate(' + -x + 'px, 0)' },
        { transform: 'translate(' + x + 'px, 0) scale(1, 1) translate(' + -x + 'px, 0)' }],
      { duration, delay, fill: 'both', easing: 'linear' });
  }

  async function show(step, upToBeat) {
    const current = ++token;
    cancelRunning();
    await waitForFont();
    if (current !== token) return;
    clipCount = 0;
    svg.replaceChildren();
    defs = node('defs', {}, svg);
    measureLayer = node('g', { visibility: 'hidden', 'aria-hidden': 'true' }, svg);
    const shapes = [];
    const beatOf = [];
    step.beats.forEach((beat, index) => beat.draw.forEach((shape) => {
      shapes.push(shape);
      beatOf.push(index);
    }));
    const layout = layoutStep(shapes, measure);
    const byId = new Map(layout.shapes.filter((shape) => shape.id).map((shape) => [shape.id, shape]));
    const root = node('g', {
      transform: 'translate(' + f(layout.offset[0] * UNIT) + ' ' + f(layout.offset[1] * UNIT) + ') scale(' + layout.scale + ')'
    }, svg);
    beats = step.beats.map((_, index) => ({
      group: node('g', { class: 'beat', visibility: index <= upToBeat ? 'visible' : 'hidden' }, root),
      parts: []
    }));
    layout.shapes.forEach((shape, index) => {
      const rendered = renderShape(shape, byId, hash(step.heading + ':' + index));
      const target = beats[beatOf[index]];
      target.group.append(rendered.group);
      target.parts.push(rendered.parts);
    });
  }

  function drawBeat(beatIndex, durationMs) {
    const beat = beats[beatIndex];
    if (!beat) return { done: Promise.resolve(), finish() {} };
    beat.group.setAttribute('visibility', 'visible');
    const shapes = beat.parts.filter((parts) => parts.length);
    if (reducedMotion || !shapes.length || typeof Element.prototype.animate !== 'function') {
      return { done: Promise.resolve(), finish() {} };
    }
    const slot = durationMs / shapes.length;
    const animations = [];
    shapes.forEach((parts, shapeIndex) => {
      const each = slot / parts.length;
      parts.forEach((part, partIndex) => {
        animations.push(animatePart(part, shapeIndex * slot + partIndex * each, Math.max(each, Math.min(600, slot) / parts.length)));
      });
    });
    running.push(...animations);
    const done = Promise.all(animations.map((animation) => animation.finished)).then(() => {}, () => {});
    return {
      done,
      finish() {
        for (const animation of animations) {
          if (animation.playState !== 'finished' && animation.playState !== 'idle') animation.finish();
        }
      }
    };
  }

  function clear() {
    token += 1;
    cancelRunning();
    beats = [];
    svg.replaceChildren();
  }

  function describe(step) {
    const words = step.beats.flatMap((beat) => beat.draw.flatMap((shape) => [shape.text, shape.label, shape.xLabel, shape.yLabel].filter(Boolean)));
    return [step.heading, ...words].join('; ');
  }

  return { show, drawBeat, clear, describe };
}
