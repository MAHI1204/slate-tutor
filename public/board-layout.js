// Pure board layout in grid units. Shapes stay where the model put them unless they
// overlap an earlier shape, in which case they are nudged down, then right. Arrows are
// attached to the edges of the shapes they connect, and a drawing that still overflows
// the 16 × 9 board is scaled down to fit.
//
// measure(item) returns { w, h } in grid units for item = { kind: 'text' | 'equation' | 'label', text, size }.

import { GRID } from './board-shapes.js';

const PAD = 0.1;
const STEP_Y = 0.25;
const STEP_X = 0.5;
const HIGHLIGHT_PAD = 0.2;
const SOLID = new Set(['text', 'equation', 'box', 'circle', 'axes', 'point']);
const CONTAINERS = new Set(['box', 'circle', 'axes']);

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

function intersects(a, b) {
  return a.x < b.x + b.w + PAD && b.x < a.x + a.w + PAD && a.y < b.y + b.h + PAD && b.y < a.y + a.h + PAD;
}

function contains(outer, inner) {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
}

function insideBoard(box) {
  return box.x >= 0 && box.y >= 0 && box.x + box.w <= GRID.width && box.y + box.h <= GRID.height;
}

function solidBox(shape, measure) {
  const [x, y] = shape.at;
  switch (shape.kind) {
    case 'text':
    case 'equation': {
      const { w, h } = measure({ kind: shape.kind, text: shape.text, size: shape.size });
      return { x: shape.align === 'center' ? x - w / 2 : x, y, w, h };
    }
    case 'box':
    case 'axes':
      return { x, y, w: shape.w, h: shape.h };
    case 'circle':
      return { x: x - shape.r, y: y - shape.r, w: 2 * shape.r, h: 2 * shape.r };
    case 'point': {
      const label = shape.label ? measure({ kind: 'label', text: shape.label, size: 'small' }) : { w: 0, h: 0 };
      const h = Math.max(0.2, label.h);
      return { x: x - 0.1, y: y - h / 2, w: 0.25 + label.w, h };
    }
  }
  return null;
}

// Converts a point in an axes shape's data coordinates to grid coordinates.
export function dataPoint(axes, [px, py]) {
  const { x, y, w, h } = axes.box;
  const [x0, x1] = axes.xRange;
  const [y0, y1] = axes.yRange;
  return [x + ((px - x0) / (x1 - x0)) * w, y + h - ((py - y0) / (y1 - y0)) * h];
}

function center(shape) {
  if (shape.kind === 'circle') return shape.at;
  const { x, y, w, h } = shape.box;
  return [x + w / 2, y + h / 2];
}

// Where a line from the shape's centre towards `toward` leaves the shape.
function edgePoint(shape, toward) {
  const c = center(shape);
  const dx = toward[0] - c[0];
  const dy = toward[1] - c[1];
  const length = Math.hypot(dx, dy);
  if (length === 0) return c;
  if (shape.kind === 'circle') {
    const t = Math.min(1, shape.r / length);
    return [c[0] + dx * t, c[1] + dy * t];
  }
  const halfW = shape.box.w / 2;
  const halfH = shape.box.h / 2;
  const t = Math.min(1, dx ? halfW / Math.abs(dx) : Infinity, dy ? halfH / Math.abs(dy) : Infinity);
  return [c[0] + dx * t, c[1] + dy * t];
}

function boundsOf(points) {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

function place(shape, box, placed) {
  const free = (candidate) => placed.every((other) =>
    !intersects(candidate, other.box) ||
    ((shape.kind === 'text' || shape.kind === 'equation') && CONTAINERS.has(other.kind) && contains(other.box, candidate)));
  if (free(box)) return box;
  for (let k = 1; box.y + k * STEP_Y + box.h <= GRID.height; k += 1) {
    const candidate = { ...box, y: box.y + k * STEP_Y };
    if (insideBoard(candidate) && free(candidate)) return candidate;
  }
  for (let m = 1; box.x + m * STEP_X + box.w <= GRID.width; m += 1) {
    const candidate = { ...box, x: box.x + m * STEP_X };
    if (insideBoard(candidate) && free(candidate)) return candidate;
  }
  return box;
}

export function layoutStep(shapes, measure) {
  const byId = new Map();
  const placedSolids = [];
  const result = shapes.map((original) => {
    const shape = structuredClone(original);
    if (shape.id) byId.set(shape.id, shape);
    return shape;
  });

  for (const shape of result) {
    if (!SOLID.has(shape.kind) || (shape.kind === 'point' && shape.axes)) continue;
    const box = solidBox(shape, measure);
    const final = place(shape, box, placedSolids);
    const dx = final.x - box.x;
    const dy = final.y - box.y;
    if (dx || dy) shape.at = [shape.at[0] + dx, shape.at[1] + dy];
    shape.box = final;
    placedSolids.push(shape);
  }

  for (const shape of result) {
    if (shape.kind === 'plot' || (shape.kind === 'point' && shape.axes)) {
      shape.box = { ...byId.get(shape.axes).box };
    }
  }

  const resolve = (end, other) => {
    if (Array.isArray(end)) return end;
    const target = byId.get(end);
    const toward = Array.isArray(other) ? other : center(byId.get(other));
    return edgePoint(target, toward);
  };
  const withBox = (id) => byId.get(id)?.box;
  for (const shape of result) {
    if (shape.kind !== 'arrow' && shape.kind !== 'line') continue;
    for (const end of [shape.from, shape.to]) {
      if (!Array.isArray(end) && !withBox(end)) {
        // A reference to something without a box (e.g. another arrow): use its points' bounds.
        const target = byId.get(end);
        target.box = target.points ? boundsOf(target.points) : { x: 0, y: 0, w: 0, h: 0 };
      }
    }
    shape.points = [resolve(shape.from, shape.to), resolve(shape.to, shape.from)];
    shape.box = boundsOf(shape.points);
  }

  for (const shape of result) {
    if (shape.kind !== 'highlight') continue;
    const target = byId.get(shape.target).box;
    shape.box = { x: target.x - HIGHLIGHT_PAD, y: target.y - HIGHLIGHT_PAD, w: target.w + 2 * HIGHLIGHT_PAD, h: target.h + 2 * HIGHLIGHT_PAD };
  }

  const boxes = result.map((shape) => shape.box).filter(Boolean);
  if (!boxes.length) return { shapes: result, scale: 1, offset: [0, 0] };
  const minX = Math.min(...boxes.map((b) => b.x));
  const minY = Math.min(...boxes.map((b) => b.y));
  const maxX = Math.max(...boxes.map((b) => b.x + b.w));
  const maxY = Math.max(...boxes.map((b) => b.y + b.h));
  if (minX >= 0 && minY >= 0 && maxX <= GRID.width && maxY <= GRID.height) {
    return { shapes: result, scale: 1, offset: [0, 0] };
  }
  const scale = Math.min(1, GRID.width / (maxX - minX), GRID.height / (maxY - minY));
  const offset = [
    clamp(0, -minX * scale, GRID.width - maxX * scale),
    clamp(0, -minY * scale, GRID.height - maxY * scale)
  ];
  return { shapes: result, scale, offset };
}
