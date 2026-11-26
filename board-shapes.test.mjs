import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GRID, LIMITS, SHAPE_KINDS, isLegacyStep, legacyToBeats, normalizeStep } from './public/board-shapes.js';

const fields = ['kind', 'id', 'at', 'w', 'h', 'r', 'text', 'label', 'size', 'align', 'from', 'fromId', 'to', 'toId',
  'dashed', 'axes', 'fn', 'domain', 'xRange', 'yRange', 'xLabel', 'yLabel', 'target'];
const raw = (values) => ({ ...Object.fromEntries(fields.map((name) => [name, null])), ...values });

test('exports the board constants', () => {
  assert.deepEqual(GRID, { width: 16, height: 9 });
  assert.deepEqual(LIMITS, { beats: 6, shapesPerBeat: 4, shapesPerStep: 16, say: 300, text: 80, heading: 72 });
  assert.deepEqual(SHAPE_KINDS, ['text', 'equation', 'box', 'circle', 'arrow', 'line', 'axes', 'plot', 'point', 'highlight']);
});

test('turns raw flat shapes into normalized shapes and derives the explanation', () => {
  const step = normalizeStep({ heading: 'Forces', beats: [
    { say: 'A box sits on a table.', draw: [raw({ kind: 'box', id: 'b', at: [2, 2], w: 3, h: 2, label: 'Box' })] },
    { say: 'Gravity pulls it down.', draw: [raw({ kind: 'arrow', fromId: 'b', from: [0, 0], to: [3.5, 8], label: 'mg' })] }] });
  assert.deepEqual(step.beats[0].draw[0], { kind: 'box', id: 'b', at: [2, 2], w: 3, h: 2, label: 'Box' });
  assert.deepEqual(step.beats[1].draw[0], { kind: 'arrow', from: 'b', to: [3.5, 8], label: 'mg' });
  assert.equal(step.explanation, 'A box sits on a table. Gravity pulls it down.');
  assert.equal(step.heading, 'Forces');
});

test('normalizes each kind with defaults and keeps optional fields only when set', () => {
  const step = normalizeStep({ heading: 'h', beats: [
    { say: 'one', draw: [
      raw({ kind: 'text', at: [1, 1], text: 'Hi' }),
      raw({ kind: 'equation', at: [1, 2], text: 'F = ma' }),
      raw({ kind: 'circle', id: 'c', at: [8, 4], r: 1 }),
      raw({ kind: 'line', from: [0, 0], toId: 'c', dashed: true })] },
    { say: 'two', draw: [
      raw({ kind: 'axes', id: 'a', at: [1, 3], w: 6, h: 4, xRange: [-2, 2], yRange: [0, 4], xLabel: 'x' }),
      raw({ kind: 'plot', axes: 'a', fn: 'x^2', domain: [-5, 1] }),
      raw({ kind: 'point', axes: 'a', at: [1, 1], label: 'P' }),
      raw({ kind: 'highlight', target: 'c' })] }] });
  const [a, b] = step.beats;
  assert.deepEqual(a.draw[0], { kind: 'text', at: [1, 1], text: 'Hi', size: 'body', align: 'left' });
  assert.deepEqual(a.draw[1], { kind: 'equation', at: [1, 2], text: 'F = ma' });
  assert.deepEqual(a.draw[2], { kind: 'circle', id: 'c', at: [8, 4], r: 1 });
  assert.deepEqual(a.draw[3], { kind: 'line', from: [0, 0], to: 'c', dashed: true });
  assert.deepEqual(b.draw[0], { kind: 'axes', id: 'a', at: [1, 3], w: 6, h: 4, xRange: [-2, 2], yRange: [0, 4], xLabel: 'x' });
  assert.deepEqual(b.draw[1], { kind: 'plot', axes: 'a', fn: 'x^2', domain: [-2, 1] });
  assert.deepEqual(b.draw[2], { kind: 'point', at: [1, 1], axes: 'a', label: 'P' });
  assert.deepEqual(b.draw[3], { kind: 'highlight', target: 'c' });
});

test('clamps geometry to the 16×9 board and coerces numeric strings', () => {
  const [s] = normalizeStep({ heading: 'h', beats: [{ say: 's', draw: [raw({ kind: 'box', at: ['15', -2], w: 9, h: 3 })] }] }).beats[0].draw;
  assert.deepEqual(s.at, [15, 0]);
  assert.equal(s.w, 1);
  assert.equal(s.h, 3);
  const [c] = normalizeStep({ heading: 'h', beats: [{ say: 's', draw: [raw({ kind: 'circle', at: [4, 4], r: -3 })] }] }).beats[0].draw;
  assert.equal(c.r, 0.2);
});

test('drops bad shapes one at a time, never the step', () => {
  const step = normalizeStep({ heading: 'h', beats: [{ say: 's', draw: [
    raw({ kind: 'text', id: 't', at: [1, 1], text: 'ok' }),
    raw({ kind: 'blob', at: [1, 1] }),
    raw({ kind: 'arrow', fromId: 'later', to: [5, 5] }),
    raw({ kind: 'plot', axes: 't', fn: 'x^2' }),
    raw({ kind: 'axes', id: 'a', at: [1, 3], w: 6, h: 4, xRange: [-2, 2], yRange: [0, 4] }),
    raw({ kind: 'plot', axes: 'a', fn: 'x^' }),
    raw({ kind: 'circle', at: [NaN, 2], r: 1 }),
    raw({ kind: 'text', id: 't', at: [9, 1], text: 'dup' })] }] });
  assert.deepEqual(step.beats[0].draw.map((s) => s.kind), ['text', 'axes', 'text']);
  assert.equal(step.beats[0].draw[2].id, undefined);
});

test('drops axes with an empty range and arrows that refer to an id defined later in the step', () => {
  const step = normalizeStep({ heading: 'h', beats: [
    { say: 'a', draw: [raw({ kind: 'arrow', fromId: 'b', to: [1, 1] }), raw({ kind: 'axes', id: 'a', at: [1, 1], w: 4, h: 3, xRange: [2, 2], yRange: [0, 1] })] },
    { say: 'b', draw: [raw({ kind: 'box', id: 'b', at: [5, 5], w: 1, h: 1 })] }] });
  assert.deepEqual(step.beats.map((beat) => beat.draw.map((s) => s.kind)), [[], ['box']]);
});

test('enforces per-beat and per-step shape limits and the beat limit', () => {
  const dot = (i) => raw({ kind: 'text', at: [i % 16, 1], text: 't' + i });
  const beats = Array.from({ length: 8 }, (_, b) => ({ say: 'beat ' + b, draw: Array.from({ length: 5 }, (_, i) => dot(b * 5 + i)) }));
  const step = normalizeStep({ heading: 'h', beats });
  assert.equal(step.beats.length, 6);
  assert.ok(step.beats.every((b) => b.draw.length <= 4));
  assert.equal(step.beats.flatMap((b) => b.draw).length, 16);
});

test('truncates by code point without splitting emoji or CJK', () => {
  const long = '光'.repeat(50) + '😀'.repeat(50);
  const step = normalizeStep({ heading: long, beats: [{ say: long.repeat(4), draw: [raw({ kind: 'text', at: [0, 0], text: long })] }] });
  for (const value of [step.heading, step.beats[0].say, step.beats[0].draw[0].text]) {
    assert.ok(!/[\uD800-\uDBFF]$/.test(value.replace(/…$/, '')), value);
    assert.ok(value.endsWith('…'));
  }
  assert.ok([...step.heading].length <= 72);
  assert.ok([...step.beats[0].draw[0].text].length <= 80);
  assert.ok([...step.beats[0].say].length <= 300);
});

test('cuts a long say at a word boundary', () => {
  const say = 'word '.repeat(100);
  const step = normalizeStep({ heading: 'h', beats: [{ say, draw: [raw({ kind: 'text', at: [1, 1], text: 'x' })] }] });
  assert.match(step.beats[0].say, /word…$/);
  assert.ok([...step.beats[0].say].length <= 300);
});

test('uses the fallback heading, and returns null for structurally broken steps', () => {
  assert.equal(normalizeStep({ heading: ' ', beats: [{ say: 's', draw: [] }] }, { fallbackHeading: 'Outline H' }).heading, 'Outline H');
  assert.equal(normalizeStep({ heading: 'h', beats: [] }), null);
  assert.equal(normalizeStep({ heading: 'h', beats: [{ say: '  ', draw: [] }] }), null);
  assert.equal(normalizeStep({ heading: '', beats: [{ say: 's', draw: [] }] }), null);
  assert.equal(normalizeStep(null), null);
  assert.equal(normalizeStep({ heading: 'h', beats: 'nope' }), null);
});

test('keeps question and goal when present', () => {
  const step = normalizeStep({ heading: 'h', question: 'Why?', goal: 'Teach it', beats: [{ say: 's', draw: [raw({ kind: 'text', at: [1, 1], text: 'x' })] }] });
  assert.equal(step.question, 'Why?');
  assert.equal(step.goal, 'Teach it');
});

test('a step with nothing drawable gets a text fallback board', () => {
  const step = normalizeStep({ heading: 'Plan', beats: [{ say: 'First idea.', draw: [] }, { say: 'Second idea.', draw: [raw({ kind: 'blob' })] }] });
  const shapes = step.beats.flatMap((b) => b.draw);
  assert.equal(shapes[0].kind, 'text');
  assert.equal(shapes[0].size, 'title');
  assert.equal(shapes[0].text, 'Plan');
  assert.deepEqual(shapes[0].at, [0.6, 0.5]);
  assert.deepEqual(shapes.slice(1).map((s) => s.text), ['First idea.', 'Second idea.']);
  assert.deepEqual(step.beats[1].draw[0].at, [0.6, 2.9]);
});

test('normalizeStep is idempotent on its own output', () => {
  const step = normalizeStep({ heading: 'h', beats: [{ say: 's', draw: [raw({ kind: 'box', id: 'b', at: [1, 1], w: 2, h: 2 })] },
    { say: 't', draw: [raw({ kind: 'arrow', fromId: 'b', to: [8, 8] })] }] });
  assert.deepEqual(normalizeStep(step), step);
});

test('converts old diagram steps, keeping question, and the result survives normalizeStep unchanged', () => {
  const old = { heading: 'Loop', explanation: 'Why it loops.', question: 'Why?', diagram: { type: 'flow',
    items: [{ label: 'A', detail: 'a' }, { label: 'B', detail: 'b' }, { label: 'C', detail: 'c' }] } };
  assert.ok(isLegacyStep(old));
  const step = legacyToBeats(old);
  assert.equal(isLegacyStep(step), false);
  assert.equal(step.question, 'Why?');
  assert.equal(step.beats[0].say, 'Why it loops.');
  assert.equal(step.beats.length, 3);
  const kinds = step.beats.flatMap((b) => b.draw).map((s) => s.kind);
  assert.equal(kinds.filter((k) => k === 'box').length, 3);
  assert.equal(kinds.filter((k) => k === 'arrow').length, 2);
  assert.deepEqual(normalizeStep(step), step);
  for (const type of ['compare', 'steps']) {
    const converted = legacyToBeats({ ...old, diagram: { ...old.diagram, type } });
    assert.ok(converted.beats.length >= 2, type);
    assert.deepEqual(normalizeStep(converted), converted, type);
  }
  const steps = legacyToBeats({ ...old, diagram: { ...old.diagram, type: 'steps' } });
  assert.ok(steps.beats.flatMap((b) => b.draw).some((s) => s.kind === 'text' && s.text.startsWith('1. A')));
});

test('arrows cannot target a highlight', () => {
  const step = normalizeStep({ heading: 'h', beats: [{ say: 's', draw: [
    raw({ kind: 'box', id: 'b', at: [1, 1], w: 2, h: 1 }),
    raw({ kind: 'highlight', id: 'hl', target: 'b' }),
    raw({ kind: 'arrow', from: [14, 8], toId: 'hl' })] }] });
  assert.deepEqual(step.beats[0].draw.map((s) => s.kind), ['box', 'highlight']);
  assert.equal(step.beats[0].draw[1].id, undefined);
});

test('converting an old lesson keeps its whole explanation', () => {
  const sentence = 'This sentence explains one more part of the idea in some detail. ';
  const explanation = sentence.repeat(13).trim();
  assert.ok(explanation.length > 750);
  const step = legacyToBeats({ heading: 'Long', explanation, diagram: { type: 'flow',
    items: [{ label: 'A', detail: 'a' }, { label: 'B', detail: 'b' }, { label: 'C', detail: 'c' }] } });
  assert.ok(step.explanation.startsWith(explanation), step.explanation.slice(0, 80));
  assert.ok(!step.beats.some((b) => b.say.endsWith('…')));
  assert.ok(step.beats.every((b) => [...b.say].length <= 300));
  assert.equal(step.beats.flatMap((b) => b.draw).filter((s) => s.kind === 'box').length, 3);
  assert.deepEqual(normalizeStep(step), step);
});

test('keeps a valid knowledge check and drops a broken one', () => {
  const base = { heading: 'h', beats: [{ say: 's', draw: [raw({ kind: 'text', at: [1, 1], text: 'x' })] }] };
  const kept = normalizeStep({ ...base, check: { question: ' What next? ', answer: 'Taken.' } });
  assert.deepEqual(kept.check, { question: 'What next?', answer: 'Taken.' });
  assert.equal(normalizeStep({ ...base, check: { question: 'Only a question' } }).check, undefined);
  assert.equal(normalizeStep({ ...base, check: null }).check, undefined);
  assert.deepEqual(normalizeStep(kept), kept);
});

test('converts old table cards into drawn rows and keeps the check', () => {
  const old = { heading: 'States', explanation: 'Each state predicts a direction.', check: { question: 'Predict from 10?', answer: 'Taken.' },
    diagram: { type: 'table', items: [{ label: '00', detail: 'not taken' }, { label: '01', detail: 'not taken' }, { label: '10', detail: 'taken' }] } };
  const step = legacyToBeats(old);
  assert.deepEqual(step.check, old.check);
  const shapes = step.beats.flatMap((b) => b.draw);
  const texts = shapes.filter((s) => s.kind === 'text').map((s) => s.text);
  for (const value of ['00', '01', '10', 'not taken', 'taken']) assert.ok(texts.includes(value), value);
  assert.ok(shapes.filter((s) => s.kind === 'line').length >= 3);
  assert.deepEqual(normalizeStep(step), step);
});
