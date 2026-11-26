import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dataPoint, layoutStep } from './public/board-layout.js';

const measure = (shape) => ({ w: 0.25 * [...shape.text].length, h: 0.6 });
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-6, (message || '') + ' ' + actual + ' ≠ ' + expected);
const nearBox = (actual, expected) => ['x', 'y', 'w', 'h'].forEach((key) => near(actual[key], expected[key], key));
const byId = (result, id) => result.shapes.find((shape) => shape.id === id);

test('keeps non-overlapping shapes where the model put them', () => {
  const result = layoutStep([
    { kind: 'box', id: 'a', at: [1, 1], w: 2, h: 1 },
    { kind: 'box', id: 'b', at: [10, 6], w: 2, h: 1 },
    { kind: 'text', id: 't', at: [5, 4], text: 'hello', size: 'body', align: 'left' }], measure);
  assert.deepEqual(byId(result, 'a').at, [1, 1]);
  assert.deepEqual(byId(result, 'b').at, [10, 6]);
  nearBox(byId(result, 't').box, { x: 5, y: 4, w: 1.25, h: 0.6 });
  assert.equal(result.scale, 1);
  assert.deepEqual(result.offset, [0, 0]);
});

test('does not mutate the shapes it is given', () => {
  const shapes = [{ kind: 'box', at: [1, 1], w: 4, h: 2 }, { kind: 'text', at: [2, 2], text: 'A sentence that is long', size: 'body', align: 'left' }];
  const copy = structuredClone(shapes);
  layoutStep(shapes, measure);
  assert.deepEqual(shapes, copy);
});

test('nudges a text that overlaps an earlier box downwards', () => {
  const result = layoutStep([
    { kind: 'box', id: 'b', at: [1, 1], w: 4, h: 2 },
    { kind: 'text', id: 't', at: [2, 2], text: 'A sentence that is long', size: 'body', align: 'left' }], measure);
  const text = byId(result, 't');
  assert.ok(text.box.y >= 3.1, String(text.box.y));
  near(text.box.x, 2);
  assert.deepEqual(text.at, [2, text.box.y]);
});

test('nudges sideways when there is no room below', () => {
  const result = layoutStep([
    { kind: 'box', id: 'b', at: [1, 1], w: 6, h: 4 },
    { kind: 'axes', id: 'a', at: [2, 2], w: 5, h: 4, xRange: [0, 1], yRange: [0, 1] }], measure);
  const axes = byId(result, 'a');
  assert.deepEqual(axes.at, [7.5, 2]);
});

test('a centred text is placed around its x coordinate', () => {
  const result = layoutStep([{ kind: 'text', id: 't', at: [8, 1], text: 'abcd', size: 'body', align: 'center' }], measure);
  nearBox(byId(result, 't').box, { x: 7.5, y: 1, w: 1, h: 0.6 });
});

test('a text that sits inside a box is not treated as overlapping it', () => {
  const result = layoutStep([
    { kind: 'box', id: 'b', at: [1, 1], w: 6, h: 3 },
    { kind: 'text', id: 't', at: [2, 2], text: 'inside', size: 'body', align: 'left' }], measure);
  assert.deepEqual(byId(result, 't').at, [2, 2]);
});

test('arrow between two boxes starts and ends on their edges', () => {
  const result = layoutStep([
    { kind: 'box', id: 'a', at: [1, 1], w: 2, h: 1 },
    { kind: 'box', id: 'b', at: [6, 1], w: 2, h: 1 },
    { kind: 'arrow', id: 'r', from: 'a', to: 'b' }], measure);
  const [[x1, y1], [x2, y2]] = byId(result, 'r').points;
  near(x1, 3); near(y1, 1.5); near(x2, 6); near(y2, 1.5);
});

test('arrows meet a circle on its radius and keep plain coordinates', () => {
  const result = layoutStep([
    { kind: 'circle', id: 'c', at: [5, 5], r: 1 },
    { kind: 'arrow', id: 'r', from: [5, 1], to: 'c' }], measure);
  const [[x1, y1], [x2, y2]] = byId(result, 'r').points;
  near(x1, 5); near(y1, 1); near(x2, 5); near(y2, 4);
});

test('plot and data point follow their axes when the axes are nudged', () => {
  const result = layoutStep([
    { kind: 'box', id: 'b', at: [1, 1], w: 6, h: 4 },
    { kind: 'axes', id: 'a', at: [2, 2], w: 5, h: 4, xRange: [0, 10], yRange: [0, 4] },
    { kind: 'plot', id: 'p', axes: 'a', fn: 'x' },
    { kind: 'point', id: 'q', axes: 'a', at: [5, 2], label: 'P' }], measure);
  const axes = byId(result, 'a');
  nearBox(axes.box, { x: 7.5, y: 2, w: 5, h: 4 });
  nearBox(byId(result, 'p').box, axes.box);
  nearBox(byId(result, 'q').box, axes.box);
  const [gx, gy] = dataPoint(axes, [5, 2]);
  near(gx, 10); near(gy, 4);
});

test('highlight wraps its target with padding', () => {
  const result = layoutStep([
    { kind: 'box', id: 'b', at: [2, 2], w: 3, h: 1 },
    { kind: 'highlight', id: 'h', target: 'b' }], measure);
  nearBox(byId(result, 'h').box, { x: 1.8, y: 1.8, w: 3.4, h: 1.4 });
});

test('scales the whole drawing down when content overflows the board', () => {
  const result = layoutStep([{ kind: 'text', id: 't', at: [2, 1], text: 'x'.repeat(80), size: 'body', align: 'left' }], measure);
  assert.ok(result.scale < 1);
  near(result.scale, 0.8);
  for (const shape of result.shapes) {
    const { x, y, w, h } = shape.box;
    const [ox, oy] = result.offset;
    assert.ok(x * result.scale + ox >= -1e-9 && (x + w) * result.scale + ox <= 16 + 1e-9);
    assert.ok(y * result.scale + oy >= -1e-9 && (y + h) * result.scale + oy <= 9 + 1e-9);
  }
});
