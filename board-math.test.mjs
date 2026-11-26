import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseExpression, sampleFunction } from './public/board-math.js';

const ev = (src, x) => {
  const parsed = parseExpression(src);
  assert.equal(parsed.ok, true, src + ': ' + parsed.error);
  return parsed.evaluate(x);
};

test('evaluates arithmetic with precedence and right-associative powers', () => {
  assert.equal(ev('2*x^2 - 3', 2), 5);
  assert.equal(ev('-x^2', 3), -9);
  assert.equal(ev('2^3^2', 0), 512);
  assert.equal(ev('(x+1)/2', 3), 2);
  assert.equal(ev('10 - 4 - 3', 0), 3);
  assert.equal(ev('1.5e1 + .5', 0), 15.5);
});

test('supports constants, functions and implicit multiplication', () => {
  assert.ok(Math.abs(ev('sin(pi/2)', 0) - 1) < 1e-12);
  assert.ok(Math.abs(ev('ln(e)', 0) - 1) < 1e-12);
  assert.equal(ev('log(100)', 0), 2);
  assert.equal(ev('sqrt(16) + abs(-3)', 0), 7);
  assert.equal(ev('2x', 3), 6);
  assert.equal(ev('2(x+1)', 1), 4);
  assert.equal(ev('3sin(0)', 0), 0);
  assert.equal(ev('(x+1)(x-1)', 3), 8);
  assert.ok(Math.abs(ev('2pi', 0) - 2 * Math.PI) < 1e-12);
});

test('rejects anything outside the grammar', () => {
  for (const bad of ['', '   ', 'x +', 'foo(x)', 'alert(1)', 'x; 1', '2**3', 'y+1', 'x'.repeat(121),
    'constructor', '__proto__', 'sin', 'sin x', '(x', 'x)', '1..2', 'Math.sin(x)', 'x,1']) {
    assert.equal(parseExpression(bad).ok, false, bad);
  }
  assert.equal(parseExpression(42).ok, false);
});

test('breaks 1/x at the asymptote instead of joining across it', () => {
  const segs = sampleFunction(parseExpression('1/x').evaluate, [-2, 2], [-5, 5]);
  assert.ok(segs.length >= 2);
  for (const s of segs) assert.ok(s.every(([x]) => x < 0) || s.every(([x]) => x > 0));
});

test('skips undefined regions and clamps runaway values', () => {
  const root = sampleFunction(parseExpression('sqrt(x)').evaluate, [-4, 4], [0, 3]);
  assert.ok(root.length >= 1);
  assert.ok(root.flat().every(([x]) => x >= 0));
  const log = sampleFunction(parseExpression('ln(x)').evaluate, [-1, 3], [-3, 2]);
  assert.ok(log.flat().every(([x, y]) => x > 0 && Number.isFinite(y)));
  const tan = sampleFunction(parseExpression('tan(x)').evaluate, [-3, 3], [-4, 4]);
  assert.ok(tan.length >= 2);
  assert.ok(tan.flat().every(([, y]) => y >= -20 && y <= 20));
});

test('a smooth function on its domain is one segment with samples + 1 points', () => {
  const segs = sampleFunction(parseExpression('x^2').evaluate, [-2, 2], [0, 4], 50);
  assert.equal(segs.length, 1);
  assert.equal(segs[0].length, 51);
  assert.deepEqual(segs[0][0], [-2, 4]);
});
