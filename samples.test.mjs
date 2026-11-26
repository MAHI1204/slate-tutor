import assert from 'node:assert/strict';
import { test } from 'node:test';
import { layoutStep } from './public/board-layout.js';
import { normalizeStep } from './public/board-shapes.js';
import { samples } from './public/samples.js';

const allSteps = () => Object.values(samples).flatMap((sample) => sample.steps);
const shapesOf = (step) => step.beats.flatMap((beat) => beat.draw);
const widths = { title: 0.32, body: 0.25, small: 0.18 };
const measure = (item) => ({
  w: (item.kind === 'equation' ? 0.28 : widths[item.size] ?? 0.25) * [...item.text].length,
  h: item.size === 'title' ? 0.8 : 0.6
});

test('every sample step is already normalized (repair changes nothing)', () => {
  for (const step of allSteps()) assert.deepEqual(normalizeStep(step), step, step.heading);
});

test('samples keep their titles and add the derivative sample', () => {
  assert.equal(samples.moon.title, 'Why the Moon changes shape');
  assert.equal(samples.search.title, 'How binary search works');
  assert.equal(samples.derivative.title, 'What a derivative means');
  for (const sample of Object.values(samples)) assert.ok(sample.steps.length >= 3 && sample.steps.length <= 5, sample.title);
});

test('the derivative sample plots computed functions and the samples use the whole vocabulary', () => {
  const shapes = samples.derivative.steps.flatMap(shapesOf);
  assert.ok(shapes.some((s) => s.kind === 'axes'));
  assert.ok(shapes.filter((s) => s.kind === 'plot').length >= 2);
  const kinds = new Set(allSteps().flatMap(shapesOf).map((s) => s.kind));
  for (const k of ['text', 'equation', 'box', 'circle', 'arrow', 'line', 'axes', 'plot', 'point', 'highlight']) assert.ok(kinds.has(k), k);
});

test('no sample step needs nudging or scaling with estimated text widths', () => {
  for (const step of allSteps()) {
    const shapes = shapesOf(step);
    const result = layoutStep(shapes, measure);
    assert.equal(result.scale, 1, step.heading);
    result.shapes.forEach((placed, i) => {
      if (shapes[i].at) assert.deepEqual(placed.at, shapes[i].at, step.heading + ' / ' + (shapes[i].text || shapes[i].label || shapes[i].kind));
    });
  }
});
