// Built-in lessons that play without a model service. Shapes are written in the
// normalized board format (see board-shapes.js); the board is 16 × 9 grid units.

const clean = (shape) => Object.fromEntries(Object.entries(shape).filter(([, value]) => value !== undefined));
const step = (heading, ...beats) => ({ heading, explanation: beats.map((beat) => beat.say).join(' '), beats });
const beat = (say, ...draw) => ({ say, draw });

const text = (at, value, { size = 'body', align = 'left', id } = {}) => clean({ kind: 'text', id, at, text: value, size, align });
const equation = (at, value, id) => clean({ kind: 'equation', id, at, text: value });
const box = (at, w, h, label, id) => clean({ kind: 'box', id, at, w, h, label });
const circle = (at, r, label, id) => clean({ kind: 'circle', id, at, r, label });
const arrow = (from, to, label) => clean({ kind: 'arrow', from, to, label });
const line = (from, to, dashed) => clean({ kind: 'line', from, to, dashed: dashed || undefined });
const axes = (id, at, w, h, xRange, yRange, xLabel, yLabel) => clean({ kind: 'axes', id, at, w, h, xRange, yRange, xLabel, yLabel });
const plot = (axesId, fn, label, domain) => clean({ kind: 'plot', axes: axesId, fn, domain, label });
const point = (axesId, at, label) => clean({ kind: 'point', at, axes: axesId, label });
const highlight = (target) => ({ kind: 'highlight', target });

export const samples = {
  moon: {
    title: 'Why the Moon changes shape',
    steps: [
      step('One Moon, changing view',
        beat('The Moon does not change shape. Sunlight always lights up the half of the Moon that faces the Sun.',
          circle([1.7, 4.5], 1.1, 'Sun'), arrow([3, 4.5], [6.2, 4.5], 'sunlight'), circle([9.5, 4.5], 0.7, 'Earth')),
        beat('As the Moon orbits Earth, it moves through different positions around us.',
          circle([9.5, 2.2], 0.4), circle([12.2, 4.5], 0.4), circle([9.5, 6.8], 0.4), circle([6.8, 4.5], 0.4)),
        beat('From Earth we see a changing fraction of that bright half, and that is what we call a phase.',
          text([0.6, 7.6], 'We see a changing part of the lit half'))),
      step('New Moon and full Moon',
        beat('At new Moon, the Moon sits roughly between Earth and the Sun.',
          circle([1.7, 4.5], 1.1, 'Sun'), circle([9.5, 4.5], 0.7, 'Earth'), circle([6.6, 4.5], 0.45, undefined, 'new'),
          text([6.6, 5.3], 'New Moon', { size: 'small', align: 'center' })),
        beat('Its lit half faces away from us, so the side we see looks dark.',
          arrow([3, 3.4], [6.1, 4.1], 'sunlight'), text([0.6, 7.4], 'New Moon: lit side faces away')),
        beat('At full Moon it is on the far side of Earth, so nearly all of its bright half faces us.',
          circle([12.6, 4.5], 0.45, undefined, 'full'), text([12.6, 5.3], 'Full Moon', { size: 'small', align: 'center' }),
          highlight('full'), text([8.6, 7.4], 'Full Moon: lit side faces us'))),
      step('Why a quarter looks like a half',
        beat('A quarter Moon looks half lit from Earth.',
          circle([4, 4], 1.6), line([4, 2.4], [4, 5.6]),
          text([4.8, 3.8], 'lit', { size: 'small' }), text([2.6, 3.8], 'dark', { size: 'small' })),
        beat('The word quarter describes how far the Moon has travelled through its cycle, not how much of it looks bright.',
          box([8.5, 2], 6.5, 0.8, 'one full cycle ≈ 29.5 days'), line([10.125, 1.7], [10.125, 3.1], true),
          text([10.125, 3.3], 'first quarter', { size: 'small', align: 'center' })),
        beat('So at first quarter the Moon is a quarter of the way round, but we see half of its face lit.',
          equation([8.5, 5], 'progress ≈ 1/4'), equation([8.5, 6.2], 'visible lit part ≈ 1/2'))),
      step('Check your mental model',
        beat('Suppose the Sun and the Moon are on nearly opposite sides of our sky.',
          line([1, 6], [15, 6]), circle([2.5, 5], 0.7, 'Sun'), circle([13.5, 5], 0.6, undefined, 'm'),
          text([13.5, 3.6], 'Moon', { size: 'small', align: 'center' })),
        beat('Which phase should you expect? Picture where the sunlit side points.',
          arrow([3.4, 4.6], [12.7, 4.6], 'sunlight'), text([5, 1.2], 'Which phase?')),
        beat('The sunlit side faces Earth, so the Moon will be near full.',
          highlight('m'), text([5, 2.2], 'Answer: near full Moon')))
    ]
  },
  search: {
    title: 'How binary search works',
    steps: [
      step('The sorted list is the clue',
        beat('Binary search works on a sorted list, like this one.',
          box([1, 2], 14, 1.2, '2 · 5 · 8 · 12 · 16 · 21 · 34', 'list'), text([1, 1.2], 'sorted values', { size: 'small' })),
        beat('One comparison with the middle value tells you which half cannot contain the target.',
          arrow([8, 4.6], 'list'), text([8, 4.7], 'middle', { size: 'small', align: 'center' })),
        beat('Ignore that half and repeat on the rest.',
          text([1, 6], 'Compare with the middle → keep one half → repeat'))),
      step('Find 21 in a seven-item list',
        beat('Start with 2, 5, 8, 12, 16, 21 and 34. The middle value is 12.',
          box([1, 1], 14, 1.1, '2 · 5 · 8 · 12 · 16 · 21 · 34', 'all'), arrow([8, 3.3], 'all'),
          text([8, 3.4], '12 is the middle', { size: 'small', align: 'center' })),
        beat('21 is larger than 12, so the lower half can be ignored.',
          equation([1, 4.6], '21 > 12'), box([6, 5.6], 6, 1.1, '16 · 21 · 34', 'upper')),
        beat('The middle of 16, 21 and 34 is 21, so the second comparison finds it.',
          arrow([9, 7.9], 'upper'), text([9, 8], 'found in 2 comparisons', { size: 'small', align: 'center' }), highlight('upper'))),
      step('Why it scales',
        beat('A linear search may have to check every item, so its worst-case work grows with n.',
          axes('g', [1, 1], 8, 6.5, [1, 64], [0, 64], 'n (items)', 'comparisons'), plot('g', 'x', 'linear')),
        beat('Binary search halves the remaining interval each time, so its work grows with log₂ n.',
          plot('g', 'ln(x)/ln(2)', 'binary')),
        beat('For 64 items that is at most about 6 comparisons instead of 64.',
          point('g', [64, 6], '6 at n = 64'), equation([10, 2], 'log₂ 64 = 6'), text([10, 3.2], 'linear: up to 64', { size: 'small' })))
    ]
  },
  derivative: {
    title: 'What a derivative means',
    steps: [
      step('Slope of a straight line',
        beat('For a straight line, the slope tells you how much y changes when x increases by one.',
          axes('a', [1, 1], 7, 6.5, [0, 4], [0, 8], 'x', 'y'), plot('a', '2x', 'y = 2x')),
        beat('Going from x = 1 to x = 3, y rises from 2 to 6.',
          point('a', [1, 2], '(1, 2)'), point('a', [3, 6], '(3, 6)')),
        beat('So the slope is the rise divided by the run: 4 over 2, which is 2.',
          text([9.5, 1.4], 'rise ÷ run'), equation([9.5, 2.5], 'slope = 4 / 2 = 2', 'm'), highlight('m'))),
      step('From secant to tangent',
        beat('A curve like y = x² has no single slope. It gets steeper as x grows.',
          axes('a', [1, 0.8], 7.5, 7, [-1, 3], [-1, 6], 'x', 'y'), plot('a', 'x^2', 'y = x²')),
        beat('Zoom in at the point (1, 1). Very close up, the curve there looks almost like a straight line.',
          point('a', [1, 1], '(1, 1)')),
        beat('That line is the tangent, y = 2x − 1. Its slope, 2, is the derivative at x = 1.',
          plot('a', '2x - 1', 'tangent', [-0.5, 3]), equation([9.6, 2], 'f′(1) = 2', 'd'), highlight('d'))),
      step('The rule for x²',
        beat('Repeating this at every point gives a rule: the derivative of x squared is 2x.',
          equation([4.5, 1.5], 'd/dx (x²) = 2x', 'rule')),
        beat('Check it at x = 3: the slope there should be 2 times 3, which is 6.',
          axes('b', [1, 3], 6.5, 5.5, [0, 4], [0, 16], 'x', 'y'), plot('b', 'x^2'),
          plot('b', '6x - 9', 'slope 6', [2, 4]), point('b', [3, 9], '(3, 9)')),
        beat('So the derivative tells you how steep the curve is at any point.',
          highlight('rule'), text([8.8, 4], 'steepness at any point')))
    ]
  }
};
