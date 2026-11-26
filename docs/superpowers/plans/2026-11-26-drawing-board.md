# Drawing Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the text-card board with a board that draws hand-sketched shapes, equations and computed graphs stroke by stroke in time with narration, with lessons generated outline-first and then step by step.

**Architecture:**
- **Shared pure ES modules in `public/`**, imported by both the Node server and the browser:
  - `board-math.js`: expression parsing and sampling.
  - `board-shapes.js`: shape vocabulary, repair, and the old-format converter.
  - `board-layout.js`: overlap resolution.
- **Browser-only `board.js`:** SVG rendering and animation.
- **Server (`tutor.mjs`, `server.mjs`):** gains `/api/outline` and `/api/step` and loses `/api/lesson`.
- **`app.js`:** drives the generation queue and beat-by-beat playback.

**Tech Stack:** Node ≥22 (`node:http`, `node:test`), vanilla browser ES modules, SVG + Web Animations API, Web Speech API. No dependencies, no build step.

**Spec:** [docs/superpowers/specs/2026-11-26-drawing-board-design.md](../specs/2026-11-26-drawing-board-design.md). Read it before starting any task.

## Global Constraints

- **Toolchain:** Node 22 or newer. No npm dependencies and no build step. `npm test` runs `node --test`, which finds every `*.test.mjs` in the repo root.
- **CSP stays exactly** `default-src 'self'; script-src 'self'; style-src 'self'; base-uri 'none'; object-src 'none'`:
  - no inline `<style>`, `<script>` or `style=""` in markup;
  - no `eval` or `new Function`;
  - setting styles through `element.style` from JS is allowed.
- **Model output never reaches the DOM as markup.** Use only `textContent` or SVG text nodes. Never use `innerHTML`.
- **Board coordinates:** grid 16 × 9 (x 0–16, y 0–9, top-left origin). SVG `viewBox="0 0 1600 900"`, so 1 grid unit = 100 px.
- **Limits:**
  - 3–5 steps per lesson;
  - 2–6 beats requested per step, 1–6 accepted after repair;
  - at most 4 shapes per beat and 16 per step;
  - `say` ≤ 300 chars; shape `text`/`label` ≤ 80; `heading` ≤ 72; outline `goal` ≤ 160; `previous` ≤ 4,000.
- **Ollama request options:** `{ temperature: 0.2, num_ctx: 8192, num_predict: 3000 }`. The timeout is 180 s per request.
- **Gemini default model** stays `gemini-3.1-flash-lite`.
- **Handwriting font:** Caveat, self-hosted at `public/fonts/caveat.woff2` with `public/fonts/OFL.txt`. CSS fallback stack: `"Segoe Print", "Comic Sans MS", cursive`.
- **`prefers-reduced-motion: reduce`** means beats appear instantly, with no stroke animation.
- **localStorage key** stays `slate-tutor-history-v1`.
- **Every new static file** gets an entry in the `files` map in `server.mjs`. JS uses `text/javascript`; the font uses `font/woff2`.

## Review Focus

1. **Functions with asymptotes or undefined regions** (`1/x`, `tan(x)`, `sqrt(x)` for x < 0, `ln(x)` for x ≤ 0) are split into separate segments. They never draw a vertical stroke across the board and never throw. *Pinned in Task 1.*
2. **Model output with wrong types** (numeric strings, `NaN`, negative sizes, duplicate ids, references to later ids, `plot.axes` pointing at a non-axes shape) is coerced or dropped shape by shape. It never fails the whole step. *Pinned in Task 2.*
3. **Long or non-Latin text** (CJK, emoji) is truncated by code point and never splits a surrogate pair. Oversized text still fits on the board through scaling. *Pinned in Tasks 2 and 4.*
4. **Cancel, Back/Next, Replay, or opening another lesson while playback waits for a step that isn't ready** stops playback cleanly. The button returns to "Play lesson", speech stops, and nothing is left hanging. *Pinned in Task 8 (manual check).*
5. **Old saved lessons** open without error:
   - old-format steps, including follow-up steps that carry `question`, are converted and keep `question`;
   - steps saved mid-generation show Retry.
   *Pinned in Task 2 (converter test) and Task 8 (manual check).*

---

## File Structure

| File | Responsibility |
|---|---|
| `public/board-math.js` (new) | Parse a math expression safely, evaluate it, sample it into polyline segments |
| `public/board-shapes.js` (new) | Shape vocabulary, `normalizeStep` (validate + repair + fallback board + derived explanation), old-format converter |
| `public/board-layout.js` (new) | Pure layout: bounding boxes, overlap nudging, arrow endpoints, fit-to-board scaling |
| `public/board.js` (new) | Browser SVG renderer: sketchy paths, text reveal, beat animation, measuring |
| `public/fonts/caveat.woff2`, `public/fonts/OFL.txt` (new) | Handwriting font and its licence |
| `tutor.mjs` | Schemas, prompts, `outline()` / `step()` / `followup()`, Ollama options |
| `server.mjs` | Routes and static file map |
| `public/samples.js` | Three sample lessons in the beat format |
| `public/app.js` | Old-format conversion on load, board display, beat playback, generation queue, follow-ups |
| `public/index.html`, `public/styles.css` | SVG board, Replay control, slate theme, font-face |
| `board-math.test.mjs`, `board-shapes.test.mjs`, `board-layout.test.mjs`, `samples.test.mjs` (new), `server.test.mjs` | Tests |
| `README.md` | Document the drawing board and the step-by-step generation |

### Normalized step and shape format (used by every task)

```js
Step  = { heading, explanation, beats: [{ say, draw: Shape[] }], question?, goal? }
// Each Shape omits fields that are absent (no nulls). `id` is optional on every kind.
text      { kind, id, at:[x,y], text, size:'title'|'body'|'small' /*default body*/, align:'left'|'center' /*default left*/ }
equation  { kind, id, at, text }
box       { kind, id, at /*top-left*/, w, h, label }
circle    { kind, id, at /*centre*/, r, label }
arrow     { kind, id, from: id|[x,y], to: id|[x,y], label }
line      { kind, id, from, to, dashed: boolean }
axes      { kind, id, at /*top-left*/, w, h, xRange:[a,b], yRange:[a,b], xLabel, yLabel }
plot      { kind, id, axes: id, fn, domain:[a,b], label }
point     { kind, id, at /*grid, or data coords when axes set*/, axes: id, label }
highlight { kind, id, target: id }
```

For `text` and `equation`, `at` is the top of the line. With `align: 'left'`, x is the left edge; with `align: 'center'`, x is the centre.

**Raw model shape** (flat, every field present, `null` when unused): `kind, id, at, w, h, r, text, label, size, align, from, fromId, to, toId, dashed, axes, fn, domain, xRange, yRange, xLabel, yLabel, target`. Here `from`/`to` are `[x,y]|null` and `fromId`/`toId` are `string|null`, and the id wins when both are set. `normalizeStep` accepts both the raw and the normalized form.

---

### Task 1: Expression parser and sampler

**Files:**
- Create: `public/board-math.js`
- Create: `board-math.test.mjs`
- Modify: `server.mjs` (`files` map: `/board-math.js`)

**Interfaces:**
- Produces:
  - `parseExpression(source: string): { ok: true, evaluate: (x: number) => number } | { ok: false, error: string }`
  - `sampleFunction(evaluate, domain: [a, b], yRange: [yMin, yMax], samples = 200): Array<Array<[x, y]>>`, which returns polyline segments in data coordinates.

- [ ] **Step 1: Write the failing tests** in `board-math.test.mjs`

```js
const ev = (src, x) => parseExpression(src).evaluate(x);
test('evaluates arithmetic with precedence and right-associative powers', () => {
  assert.equal(ev('2*x^2 - 3', 2), 5);
  assert.equal(ev('-x^2', 3), -9);
  assert.equal(ev('2^3^2', 0), 512);
  assert.equal(ev('(x+1)/2', 3), 2);
});
test('supports constants, functions and implicit multiplication', () => {
  assert.ok(Math.abs(ev('sin(pi/2)', 0) - 1) < 1e-12);
  assert.ok(Math.abs(ev('ln(e)', 0) - 1) < 1e-12);
  assert.equal(ev('log(100)', 0), 2);           // log is base 10
  assert.equal(ev('sqrt(16) + abs(-3)', 0), 7);
  assert.equal(ev('2x', 3), 6);
  assert.equal(ev('2(x+1)', 1), 4);
  assert.equal(ev('3sin(0)', 0), 0);
});
test('rejects anything outside the grammar', () => {
  for (const bad of ['', 'x +', 'foo(x)', 'alert(1)', 'x; 1', '2**3', 'y+1', 'x'.repeat(121), 'constructor', '__proto__'])
    assert.equal(parseExpression(bad).ok, false, bad);
});
test('breaks 1/x at the asymptote instead of joining across it', () => {
  const segs = sampleFunction(parseExpression('1/x').evaluate, [-2, 2], [-5, 5]);
  assert.ok(segs.length >= 2);
  for (const s of segs) assert.ok(s.every(([x]) => x < 0) || s.every(([x]) => x > 0));
});
test('skips undefined regions and clamps runaway values', () => {
  const root = sampleFunction(parseExpression('sqrt(x)').evaluate, [-4, 4], [0, 3]);
  assert.ok(root.flat().every(([x]) => x >= 0));
  const tan = sampleFunction(parseExpression('tan(x)').evaluate, [-3, 3], [-4, 4]);
  assert.ok(tan.length >= 2);
  assert.ok(tan.flat().every(([, y]) => y >= -20 && y <= 20));   // clamp to [yMin−2·span, yMax+2·span]
});
```

- [ ] **Step 2: Run the tests to check they fail.** Run `node --test board-math.test.mjs`. Expected: FAIL with a module-not-found error.

- [ ] **Step 3: Implement `parseExpression` and `sampleFunction` in `public/board-math.js`.**
  - Write a tokenizer plus a recursive-descent parser that builds closures. Do not use `eval`.
  - Input is limited to 120 chars.
  - Identifiers are whitelisted: `x`, `pi`, `e`, `sin cos tan asin acos atan sqrt abs exp ln log`. `log` is `Math.log10`.
  - Implicit multiplication applies when a number or `)` is followed by `x`, a function name, a constant or `(`.
  - **Sampler rules:**
    - Take `samples + 1` evenly spaced x values.
    - Start a new segment on a non-finite y.
    - Also start a new segment when consecutive points lie on opposite sides outside the range (one > yMax and the other < yMin).
    - Clamp y into `[yMin − 2·span, yMax + 2·span]`.
    - Drop segments with fewer than 2 points.

- [ ] **Step 4: Run the tests to check they pass.** Run `node --test board-math.test.mjs`. Expected: PASS.

- [ ] **Step 5: Serve the module.** Add `['/board-math.js', ['board-math.js', 'text/javascript']]` to `files` in `server.mjs`. Then run `npm test`; expected: all PASS.

- [ ] **Step 6: Commit.** Run `git add public/board-math.js board-math.test.mjs server.mjs && git commit -m "Add safe expression parser and function sampler for board plots"`.

---

### Task 2: Shape vocabulary, step repair and the old-format converter

**Files:**
- Create: `public/board-shapes.js`
- Create: `board-shapes.test.mjs`
- Modify: `server.mjs` (`files` map: `/board-shapes.js`)

**Interfaces:**
- Consumes: `parseExpression` (Task 1).
- Produces:
  - `GRID = { width: 16, height: 9 }`
  - `SHAPE_KINDS` (the 10 kinds above)
  - `LIMITS = { beats: 6, shapesPerBeat: 4, shapesPerStep: 16, say: 300, text: 80, heading: 72 }`
  - `normalizeStep(raw, { fallbackHeading } = {}): Step | null`. It returns `null` only when the structure is broken: there is no usable heading, or no beat with a non-empty `say`. It keeps `question` and `goal` when they are present.
  - `isLegacyStep(step): boolean`, true when the step has `diagram` and no `beats`.
  - `legacyToBeats(step): Step`

- [ ] **Step 1: Write the failing tests** in `board-shapes.test.mjs`. Add a helper `raw(fields)` that returns a raw shape with all 23 fields set to `null` and then overrides them with `fields`.

```js
test('turns raw flat shapes into normalized shapes and derives the explanation', () => {
  const step = normalizeStep({ heading: 'Forces', beats: [
    { say: 'A box sits on a table.', draw: [raw({ kind: 'box', id: 'b', at: [2, 2], w: 3, h: 2, label: 'Box' })] },
    { say: 'Gravity pulls it down.', draw: [raw({ kind: 'arrow', fromId: 'b', to: [3.5, 8], label: 'mg' })] }] });
  assert.deepEqual(step.beats[0].draw[0], { kind: 'box', id: 'b', at: [2, 2], w: 3, h: 2, label: 'Box' });
  assert.deepEqual(step.beats[1].draw[0], { kind: 'arrow', from: 'b', to: [3.5, 8], label: 'mg' });
  assert.equal(step.explanation, 'A box sits on a table. Gravity pulls it down.');
});
test('clamps geometry to the 16×9 board and coerces numeric strings', () => {
  const [s] = normalizeStep({ heading: 'h', beats: [{ say: 's', draw: [raw({ kind: 'box', at: ['15', -2], w: 9, h: 3 })] }] }).beats[0].draw;
  assert.deepEqual(s.at, [15, 0]); assert.equal(s.w, 1); assert.equal(s.h, 3);
});
test('drops bad shapes one at a time, never the step', () => {
  const step = normalizeStep({ heading: 'h', beats: [{ say: 's', draw: [
    raw({ kind: 'text', id: 't', at: [1, 1], text: 'ok' }),
    raw({ kind: 'blob', at: [1, 1] }),                                 // unknown kind
    raw({ kind: 'arrow', fromId: 'later', to: [5, 5] }),               // forward / unknown reference
    raw({ kind: 'plot', axes: 't', fn: 'x^2' }),                       // axes id is not an axes shape
    raw({ kind: 'axes', id: 'a', at: [1, 3], w: 6, h: 4, xRange: [-2, 2], yRange: [0, 4] }),
    raw({ kind: 'plot', axes: 'a', fn: 'x^' }),                        // fn does not parse
    raw({ kind: 'circle', at: [NaN, 2], r: 1 }),                       // missing coordinate
    raw({ kind: 'text', id: 't', at: [9, 1], text: 'dup' }) ] }] });   // duplicate id → kept without id
  assert.deepEqual(step.beats[0].draw.map((s) => s.kind), ['text', 'axes', 'text']);
  assert.equal(step.beats[0].draw[2].id, undefined);
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
    assert.ok(!/[\uD800-\uDBFF]$/.test(value.replace(/…$/, '')));
  }
  assert.ok([...step.heading].length <= 72 && [...step.beats[0].draw[0].text].length <= 80);
});
test('uses the fallback heading, and returns null for structurally broken steps', () => {
  assert.equal(normalizeStep({ heading: ' ', beats: [{ say: 's', draw: [] }] }, { fallbackHeading: 'Outline H' }).heading, 'Outline H');
  assert.equal(normalizeStep({ heading: 'h', beats: [] }), null);
  assert.equal(normalizeStep({ heading: 'h', beats: [{ say: '  ', draw: [] }] }), null);
  assert.equal(normalizeStep({ heading: '', beats: [{ say: 's', draw: [] }] }), null);
});
test('a step with nothing drawable gets a text fallback board', () => {
  const step = normalizeStep({ heading: 'Plan', beats: [{ say: 'First idea.', draw: [] }, { say: 'Second idea.', draw: [] }] });
  const shapes = step.beats.flatMap((b) => b.draw);
  assert.equal(shapes[0].kind, 'text'); assert.equal(shapes[0].size, 'title'); assert.equal(shapes[0].text, 'Plan');
  assert.deepEqual(shapes.slice(1).map((s) => s.text), ['First idea.', 'Second idea.']);
});
test('converts old diagram steps, keeping question, and the result survives normalizeStep unchanged', () => {
  const old = { heading: 'Loop', explanation: 'Why it loops.', question: 'Why?', diagram: { type: 'flow',
    items: [{ label: 'A', detail: 'a' }, { label: 'B', detail: 'b' }, { label: 'C', detail: 'c' }] } };
  assert.ok(isLegacyStep(old));
  const step = legacyToBeats(old);
  assert.equal(step.question, 'Why?');
  assert.equal(step.beats[0].say, 'Why it loops.');
  const kinds = step.beats.flatMap((b) => b.draw).map((s) => s.kind);
  assert.equal(kinds.filter((k) => k === 'box').length, 3);
  assert.equal(kinds.filter((k) => k === 'arrow').length, 2);
  assert.deepEqual(normalizeStep(step), step);
  for (const type of ['compare', 'steps']) assert.ok(legacyToBeats({ ...old, diagram: { ...old.diagram, type } }).beats.length >= 2);
});
```

- [ ] **Step 2: Run the tests to check they fail.** Run `node --test board-shapes.test.mjs`. Expected: FAIL with a module-not-found error.

- [ ] **Step 3: Implement the module in `public/board-shapes.js`.**
  - **Processing order:** go through beats in order and shapes in order, keeping a map of the ids seen so far and their kinds. That map is how references are checked: a reference may point only to an earlier id, and `plot.axes`/`point.axes` must name an `axes`.
  - **Numbers** are finite numbers or numeric strings. Anything else counts as a missing field, and a missing required field drops the shape.
  - **Clamping:**
    - `at` goes into [0,16]×[0,9].
    - `box`/`axes`: `w`, `h` ≥ 0.3 (axes ≥ 1) and trimmed so they fit on the board.
    - `circle`: `r` in [0.2, 4.5].
    - `xRange`/`yRange` need a < b, otherwise drop the shape.
    - `domain` is clamped into `xRange`.
  - **Text** is trimmed and truncated by code point to its limit, with a trailing `…`. `say` is cut at the last whitespace before the limit, or by code point if it has no whitespace.
  - **Shape limits** (4 per beat, 16 per step) count only the shapes that survive validation. An invalid shape never uses up a slot.
  - **Beats:** a beat with an empty `say` is dropped. Keep at most 6 beats.
  - **Fallback board:** when the repaired step has zero shapes, beat 0 gets a `title` text of the heading at `[0.6, 0.5]`. Beat *i* gets a `body` text of its `say` (truncated to 80) at `[0.6, 1.7 + 1.2·i]`.
  - **`legacyToBeats`:**
    - Beat 0 has `say` set to the explanation and draws the first item's shapes.
    - Every further item gets its own beat, with `say` = `label + '. ' + detail` and draws that item's shapes.
    - `flow`: equal-width boxes in a row with arrows between neighbours, each arrow drawn in the beat of the box it points to.
    - `compare`: columns of a box plus a `small` detail text.
    - `steps`: `body` text lines `"1. label: detail"`.
    - Pass the result through `normalizeStep`.

- [ ] **Step 4: Run the tests to check they pass.** Run `node --test board-shapes.test.mjs`. Expected: PASS.

- [ ] **Step 5: Serve the module.** Add `/board-shapes.js` to `files`, then run `npm test`. Expected: all PASS.

- [ ] **Step 6: Commit.** Run `git add public/board-shapes.js board-shapes.test.mjs server.mjs && git commit -m "Add board shape vocabulary, lenient step repair and old-format converter"`.

---

### Task 3: Server: outline, step and follow-up generation

**Files:**
- Modify: `tutor.mjs` (replace `stepSchema`/`lessonSchema`/`lesson()`/`validateStep`)
- Modify: `server.mjs:58-63` (routes)
- Modify: `server.test.mjs` (rewrite the lesson tests)

**Interfaces:**
- Consumes: `normalizeStep`, `LIMITS`, `SHAPE_KINDS` (Task 2).
- Produces, via `createTutor(baseURL, fetchImpl, gemini)`, an object `{ models, outline, step, followup }`:
  - `outline({ model, topic, notes?, level }, signal)` → `{ title, steps: [{ heading, goal }] }`, with 3–5 steps.
  - `step({ model, topic, notes?, level, outline: { title, steps: [{ heading, goal }] }, index, previous? }, signal)` → `Step`. An `index` that isn't an integer inside the outline returns 400. `previous` is a string of up to 4,000 chars.
  - `followup({ model, topic, notes?, level, question, context }, signal)` → `Step`. Same input limits as today.
  - Any `null` from `normalizeStep` becomes `TutorError(502, 'The model returned an incomplete board step. Try again or choose another model.')`.
- HTTP routes:
  - `POST /api/outline`, `POST /api/step` and `POST /api/followup` return 200 JSON.
  - `POST /api/lesson` now returns 404.

- [ ] **Step 1: Write the failing tests** in `server.test.mjs`.
  - Replace `sampleStep`/`sampleLesson` with:
    - `sampleOutline = { title: 'RC delay', steps: [{ heading: 'Intuition', goal: 'Why charging takes time' }, { heading: 'Mechanism', goal: 'The exponential curve' }, { heading: 'Example', goal: 'Compute τ for 1 kΩ, 1 mF' }] }`;
    - a raw `sampleStep` with two beats, one `axes` and one `plot` with `fn: '1-exp(-x)'`, using a local `raw()` helper like the one in Task 2.
  - Keep the existing tests for the models list, invalid input, the disconnected service and Gemini, but move them onto the new endpoints.
  - Add these tests:

```js
test('outline request is schema-constrained and passes topic, notes and level', async (t) => {
  // fixture returns sampleOutline; POST /api/outline {model, topic, notes, level:'Advanced'}
  // assert 200, body deepEqual sampleOutline, call.format.required deepEqual ['title','steps'],
  // user message JSON deepEqual { topic, notes, level }
});
test('step request carries outline, index and previous lines, and sets Ollama context options', async (t) => {
  // fixture returns sampleStep; POST /api/step {model, topic, level, outline: sampleOutline, index: 1, previous: 'Intuition: …'}
  // assert 200; call.format.required deepEqual ['heading','beats'];
  // call.options deepEqual { temperature: 0.2, num_ctx: 8192, num_predict: 3000 };
  // user JSON has outline deepEqual sampleOutline, index 1, previous string;
  // response.explanation === beats' say joined with ' '; response.beats[1].draw[0] has no null-valued keys
});
test('repairs a step with invalid shapes instead of rejecting it', async (t) => {
  // model step: valid box + plot with fn 'foo(' + arrow fromId 'ghost' → 200 and only the box remains
});
test('rejects structurally broken steps and out-of-range indices', async (t) => {
  // model returns { heading: 'x', beats: [] } → 502 /incomplete board step/
  // index 7 with a 3-step outline → 400, and the model was not called
});
test('the old lesson endpoint is gone', async (t) => { /* POST /api/lesson → 404 */ });
```

  - The Gemini test should drive outline, step, follow-up and a quota error (429). Pick the canned response by checking `responseJsonSchema.required[0]`: `'title'` means outline, `'heading'` means step.

- [ ] **Step 2: Run the tests to check they fail.** Run `node --test server.test.mjs`. Expected: the new tests FAIL with 404s on `/api/outline` and `/api/step`.

- [ ] **Step 3: Implement in `tutor.mjs`.**
  - **Schemas:**
    - outline: `title` ≤100, `steps` 3–5 of `{heading ≤72, goal ≤160}`;
    - step: `heading` plus `beats` of 2–6 `{say ≤300, draw: 0–4 rawShape}`. A raw shape is a record with all 23 fields required and nullable types, for example `{ type: ['number','null'] }` and `{ type: ['array','null'], items: { type: 'number' }, minItems: 2, maxItems: 2 }`, with `kind` as an enum of `SHAPE_KINDS`.
  - **Ollama call:** in `generate()`, send `options: { temperature: 0.2, num_ctx: 8192, num_predict: 3000 }`.
  - **Prompts:**
    - Extend `teacher` with a `boardGuide` constant. It must contain: the 16×9 grid and its top-left origin; each kind and its fields; the rules (reference only earlier ids, keep everything on the board, at most 4 shapes per beat, use `axes`+`plot` for any graph with `fn` written in `x` and the allowed functions, use arrows for forces, flows and causes, set unused fields to null); and one short worked example step (2–3 beats, including an axes+plot) as compact JSON.
    - **Outline instruction:** a title and 3–5 steps that go from intuition to mechanism to a worked example with its answer; each goal is one sentence.
    - **Step instruction:** teach only step `index + 1` of the outline toward its goal, continue from `previous` without repeating it, and use 2–6 beats.
    - **Follow-up instruction:** answer the question in one step of 2–4 beats on a fresh board.
  - **Routes:** in `server.mjs`, replace the `/api/lesson` route with `/api/outline` and `/api/step`.

- [ ] **Step 4: Run all tests.** Run `npm test`. Expected: all PASS.

- [ ] **Step 5: Smoke test against real Gemini** (only if `GEMINI_API_KEY` is set). Run `npm start`, then run `curl -s localhost:5173/api/outline -H 'Content-Type: application/json' -d '{"model":"gemini-3.1-flash-lite","topic":"projectile motion"}'`. Then POST `/api/step` with index 0 and the outline you got back. Expected: a step with beats and at least one non-text shape. Record anything the model repeatedly gets wrong and adjust `boardGuide`. If no key is available, say so in the task report.

- [ ] **Step 6: Commit.** Run `git add tutor.mjs server.mjs server.test.mjs && git commit -m "Generate lessons as an outline plus drawn steps"`.

---

### Task 4: Board layout

**Files:**
- Create: `public/board-layout.js`
- Create: `board-layout.test.mjs`
- Modify: `server.mjs` (`files`: `/board-layout.js`)

**Interfaces:**
- Consumes: the normalized `Shape` format and `GRID` (Task 2).
- Produces: `layoutStep(shapes: Shape[], measure: (shape) => { w, h }): { shapes: Placed[], scale: number, offset: [dx, dy] }`.
  - `measure` gives the size of a `text`/`equation` and of any `label`, in grid units.
  - `Placed` is the shape with a final `at` (if it moved) plus a `box: { x, y, w, h }` in grid units.
  - Arrows and lines also get `points: [[x1, y1], [x2, y2]]`.
  - A `highlight` gets the `box` of its target, padded by 0.2.
  - A `plot` or an axes-bound `point` gets its axes' final `box`.
  - The scaled board coordinate of any point p is `p·scale + offset`.

- [ ] **Step 1: Write the failing tests** in `board-layout.test.mjs`. Use a deterministic measure: `w = 0.25 × codepoints`, `h = 0.6`.

```js
test('keeps non-overlapping shapes where the model put them', ...);          // two boxes far apart → at unchanged, scale 1, offset [0,0]
test('nudges a text that overlaps an earlier box downwards', ...);           // box at [1,1] 4×2, text at [2,2] → text box.y >= 3 (+0.1 pad), x unchanged
test('a text that sits inside a box is not treated as overlapping it', ...); // text fully inside box bbox → unchanged
test('arrow between two boxes starts and ends on their edges', ...);         // A [1,1] 2×1, B [6,1] 2×1, arrow A→B → points ≈ [[3,1.5],[6,1.5]]
test('plot and data point follow their axes when the axes are nudged', ...); // axes overlapping an earlier box moves; plot.box and point.box match the new axes box
test('highlight wraps its target with padding', ...);
test('scales the whole drawing down when content overflows the board', ...); // text 80 chars at [2,1] → scale < 1, every transformed box inside [0,16]×[0,9]
```

  Write full assertions with numeric tolerances of 1e-6.

- [ ] **Step 2: Run the tests to check they fail.** Run `node --test board-layout.test.mjs`. Expected: FAIL with a module-not-found error.

- [ ] **Step 3: Implement `layoutStep`.**
  - **Solid shapes** are `text`, `equation`, `box`, `circle`, `axes`, and `point` without axes. Process them in draw order.
  - A solid shape overlaps an earlier solid one when their boxes, padded by 0.1, intersect. A text or equation fully inside a box, circle or axes box does not count as overlapping that container.
  - **Nudging:**
    1. Try y + 0.25 steps while the shape stays inside the board.
    2. Then go back to the original y and try x + 0.5 steps.
    3. If nothing is free, keep the original position.
  - Arrow and line endpoints that reference an id meet the target's edge on the line between the two centres: a rectangle intersection for boxes and text, the radius for circles.
  - **Scaling:** `scale = min(1, 16 / unionW, 9 / unionH)`. Choose the offset so that the scaled union lies inside the board.

- [ ] **Step 4: Run the tests to check they pass.** Run `node --test board-layout.test.mjs`. Expected: PASS.

- [ ] **Step 5: Serve the module.** Add `/board-layout.js` to `files`, then run `npm test`. Expected: all PASS.

- [ ] **Step 6: Commit.** Run `git add public/board-layout.js board-layout.test.mjs server.mjs && git commit -m "Add board layout with overlap nudging and fit-to-board scaling"`.

---

### Task 5: Sample lessons in the beat format

**Files:**
- Modify: `public/samples.js` (full rewrite)
- Create: `samples.test.mjs`

**Interfaces:**
- Consumes: `normalizeStep`, `parseExpression`, `layoutStep` (Tasks 1, 2 and 4).
- Produces: `samples = { moon, search, derivative }`, each `{ title, steps: Step[] }` in normalized form. Each step's `explanation` is equal to its beats' `say` joined with spaces.

- [ ] **Step 1: Write the failing tests** in `samples.test.mjs`.

```js
test('every sample step is already normalized (repair changes nothing)', () => {
  for (const s of Object.values(samples)) for (const step of s.steps) assert.deepEqual(normalizeStep(step), step);
});
test('samples keep their titles and add the derivative sample', () => {
  assert.equal(samples.moon.title, 'Why the Moon changes shape');
  assert.equal(samples.search.title, 'How binary search works');
  assert.equal(samples.derivative.title, 'What a derivative means');
});
test('the derivative sample plots computed functions and the samples use most of the vocabulary', () => {
  const shapes = samples.derivative.steps.flatMap((st) => st.beats.flatMap((b) => b.draw));
  assert.ok(shapes.some((s) => s.kind === 'axes') && shapes.filter((s) => s.kind === 'plot').length >= 2);
  const kinds = new Set(Object.values(samples).flatMap((s) => s.steps.flatMap((st) => st.beats.flatMap((b) => b.draw.map((d) => d.kind)))));
  for (const k of ['text', 'equation', 'box', 'circle', 'arrow', 'axes', 'plot', 'point', 'highlight']) assert.ok(kinds.has(k), k);
});
test('no sample step needs nudging or scaling with estimated text widths', () => {
  // layoutStep with measure w = 0.25·codepoints (title 0.32, small 0.18), h = 0.6 → scale 1 and no shape moved
});
```

- [ ] **Step 2: Run the tests to check they fail.** Run `node --test samples.test.mjs`. Expected: FAIL, because `samples.derivative` is undefined and the old format doesn't normalize.

- [ ] **Step 3: Rewrite `public/samples.js`.**
  - Keep the teaching content of `moon` and `search`. Turn each scene into 2–5 beats with real drawings:
    - **moon:** the Sun on one side, arrows for the sunlight, Earth as a circle with the Moon at several orbit positions with labels, and a `highlight` on the full-Moon position.
    - **search:** the sorted list as a row of small boxes, an arrow marking the middle, the discarded half crossed out with a `line`, and an `equation` "comparisons ≈ log₂ n".
  - Add **derivative** (3 steps, written in the same style as the other samples):
    1. slope of a straight line;
    2. secant to tangent on `x^2`, plotting `x^2` and the tangent at x = 1, `2x - 1`, with a `point` at (1, 1);
    3. the rule `d/dx x² = 2x` as an `equation`, with a check at x = 3.
  - Write the shapes directly in normalized form (no nulls).

- [ ] **Step 4: Run all tests.** Run `npm test`. Expected: all PASS. The existing server test still finds both old titles in `/samples.js`.

- [ ] **Step 5: Commit.** Run `git add public/samples.js samples.test.mjs && git commit -m "Rewrite samples as drawn beats and add a derivative sample"`.

---

### Task 6: SVG renderer, slate theme and static board display

**Files:**
- Create: `public/board.js`
- Create: `public/fonts/caveat.woff2`, `public/fonts/OFL.txt`
- Modify: `public/index.html` (board markup)
- Modify: `public/styles.css` (remove the `.board-card`/`.diagram*`/`.pending`/`stage-forward` rules, add the theme)
- Modify: `public/app.js` (`renderBoard`, `readSaved`, `renderLesson` transcript)
- Modify: `server.mjs` (`files`: `/board.js`, `/fonts/caveat.woff2`)
- Test: `server.test.mjs` (static file test)

**Interfaces:**
- Consumes: `layoutStep` (Task 4); `sampleFunction`, `parseExpression` (Task 1); `isLegacyStep`, `legacyToBeats` (Task 2).
- Produces: `createBoard(svg: SVGSVGElement, { reducedMotion: boolean }) → { show(step, upToBeat), drawBeat(beatIndex, durationMs), describe(step) }`.
  - `show(step, upToBeat: number): Promise<void>` clears the board, lays out **all** of the step's shapes, and instantly renders beats `0..upToBeat`. Passing `-1` gives an empty board with layout ready.
  - `drawBeat(beatIndex, durationMs): { done: Promise<void>, finish(): void }` animates that beat's shapes in order, spread across `durationMs`. `finish()` jumps every running animation to its end and resolves `done`. With `reducedMotion`, it resolves at once with the shapes visible.
  - `describe(step): string` is the aria-label text: the heading plus the shape texts and labels.

- [ ] **Step 1: Write the failing test.** In `server.test.mjs`, add `serves the board modules and the handwriting font`. It requests `/board-math.js`, `/board-shapes.js`, `/board-layout.js` and `/board.js` and expects 200 with `text/javascript; charset=utf-8`. It requests `/fonts/caveat.woff2` and expects 200 with a content type that starts with `font/woff2`.

- [ ] **Step 2: Run the test to check it fails.** Run `node --test server.test.mjs`. Expected: FAIL with a 404 on `/board.js`.

- [ ] **Step 3: Add the font.**
  - Download a Latin Caveat 400 `.woff2` from `@fontsource/caveat` on cdn.jsdelivr.net, pinning an exact published version. Save it to `public/fonts/caveat.woff2`.
  - Save the OFL text from `github.com/google/fonts` (`ofl/caveat/OFL.txt`) to `public/fonts/OFL.txt`.
  - Note the source URL and version in a comment at the top of the `@font-face` rule.
  - In `server.mjs`, serve the font without the `charset` suffix (binary). Read it as a buffer, as `readFile` already does.
  - If the download is impossible, ship without the font file. Remove its map entry and test assertion, rely on the fallback stack, and say so in the task report.

- [ ] **Step 4: Implement `public/board.js`.**
  - **Measuring:**
    - Before the first layout, wait for `document.fonts.load('48px Caveat')`, with a 1,500 ms timeout.
    - Measure text and labels with `getBBox()` on hidden `<text>` nodes, divided by 100.
    - Font sizes: title 64 px, body 44 px, small 34 px, equation 50 px.
  - **Sketchy strokes:**
    - Each stroke is an SVG `<path>` whose points get a small jitter (about 1.5 px) from a mulberry32 PRNG. Seed it with a hash of `heading + shape index`, so a replayed board looks identical.
    - Boxes and circles are drawn as 1–2 slightly overshooting passes.
    - Plots are polylines of `sampleFunction(parseExpression(fn).evaluate, domain ?? xRange, yRange)`, mapped into the axes box and clipped to it with a `<clipPath>`.
  - **Animation:**
    - Strokes animate `stroke-dashoffset` from the path length to 0 with `element.animate`.
    - Text appears through a left-to-right reveal (an animated clip or mask). The exact method is the builder's call, but it must work under the CSP.
    - Shapes start one after another inside `durationMs`, each getting at least `min(600, durationMs / n)` ms.
  - **Colours** come from CSS classes only (`.chalk`, `.chalk-accent`, `.chalk-dim`). Equations, plots and highlights use the accent.
  - **Safety:** create every node with `document.createElementNS`. Text goes in via `textContent`.

- [ ] **Step 5: Wire up the markup, theme and static display.**
  - **`index.html`:**
    - Replace `<div id="diagram" class="diagram">` with `<svg id="board-svg" class="board-svg" viewBox="0 0 1600 900" role="img" aria-label=""></svg>`.
    - Add `<button id="replay" class="quiet" type="button">Replay step</button>` inside `.board-meta`.
  - **`styles.css`:**
    - `@font-face` for Caveat.
    - Tokens `--slate: #1f2d33`, `--chalk: #eef3ee`, `--chalk-accent: #8ee0ba`, `--chalk-dim: #9fb3ad`. These are dark slate plus the existing green family.
    - `.board` gets the slate background, and the step title uses the handwriting stack.
    - `.board-svg { width: 100%; aspect-ratio: 16 / 9; }`
    - `#explanation span[data-active="true"]` gets a highlight.
    - Make sure it works at 375 px wide.
  - **`app.js`:**
    - `readSaved()` maps `isLegacyStep` steps through `legacyToBeats`.
    - `renderBoard(step)` becomes `board.show(step, step.beats.length - 1)` and sets `aria-label` from `describe`.
    - `ui.explanation` is filled with one `<span data-beat="i">` per beat, joined by spaces.
    - Remove `revealAll` and the `pending` class logic. `playFromHere` may temporarily just narrate `step.explanation` until Task 7 replaces it.
  - **`server.mjs`:** add the file-map entries.

- [ ] **Step 6: Run all tests.** Run `npm test`. Expected: all PASS.

- [ ] **Step 7: Check in a browser.** Run `npm start` and open each of the three samples, stepping with Next. Expected:
  - every step shows a complete hand-drawn board with no overlapping text;
  - the derivative plots are smooth curves inside their axes;
  - no CSP errors in the console;
  - the layout works at a 375 px width.

  Then put an old-format lesson into localStorage (`slate-tutor-history-v1` with one lesson whose steps use `diagram`) and reload. Expected: it opens as boxes and arrows.

- [ ] **Step 8: Commit.** Run `git add public/ server.mjs server.test.mjs && git commit -m "Render steps as hand-drawn SVG boards on a slate theme"`.

---

### Task 7: Beat-by-beat playback with narration sync

**Files:**
- Modify: `public/app.js` (`hold`, `readAloud`, `playFromHere`, `stopPlayback`, `moveTo`, `renderControls`, Replay handler)

**Interfaces:**
- Consumes: `board.show`, `board.drawBeat` (Task 6).
- Produces app state used by Task 8:
  - `playback: null | { run: symbol, stepIndex: number, beat: number, untilEndOfStep: boolean }`
  - `resumePoint: null | { lessonId, stepIndex, beat }`
  - `async function playFrom(stepIndex, beat, { untilEndOfStep })`

- [ ] **Step 1: Implement the playback loop.**
  - **Per beat:**
    - `durationMs = max(words(say) / 2.6 * 1000, 600 * shapes, 1200)`.
    - Start `board.drawBeat(beat, durationMs)` and `readAloud(say)` together, and continue only after both have finished.
    - With narration off or no voice, `readAloud` holds for `durationMs` instead of the fixed 1,400 ms.
    - Set `data-active="true"` on the beat's transcript span and clear it from the others.
  - **Pause:** call `finish()` on the running drawing, stop the voice, and set `resumePoint` to the current beat. Leave the board as it is (beats `0..k`) and keep beat k highlighted.
  - **Play:**
    - If `resumePoint` matches the lesson and `cursor`: resume at beat k+1. If k was the step's last beat, move to the next step's beat 0.
    - Otherwise: `board.show(step, -1)`, then start at beat 0.
    - Play runs on through the following steps (`cursor += 1`, `saveLesson()`) until the end of the lesson.
  - **Replay step:** stop playback, clear `resumePoint`, call `board.show(step, -1)`, then `playFrom(cursor, 0, { untilEndOfStep: true })`.
  - **Navigation:** Back, Next, the outline, `openLesson` and starting a follow-up all stop playback, clear `resumePoint` and show the full board.
  - **Reduced motion:** create the board with `reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches`.

- [ ] **Step 2: Run all tests.** Run `npm test`. Expected: all PASS (no server change).

- [ ] **Step 3: Check in a browser,** with each of the three samples:
  - Play with narration on: shapes draw while each sentence is spoken, and the highlighted transcript sentence follows along.
  - Narration off: the same timing without sound.
  - Pause mid-step: the board keeps the beats drawn so far, plus the current beat completed.
  - Play again: it resumes at the next beat.
  - Back/Next: full board.
  - Replay step: redraws and stops at the end of the step.
  - Play on the last step's last beat: it stops, and the button reads "Play lesson".
  - With reduced motion turned on in the OS or browser: beats appear instantly.

- [ ] **Step 4: Commit.** Run `git add public/app.js && git commit -m "Play lessons beat by beat with drawing synced to narration"`.

---

### Task 8: Step-by-step generation queue, retry and follow-ups

**Files:**
- Modify: `public/app.js` (`createLesson`, new `runQueue`/`retryStep`/`stepReady`, `askTutor`, `readSaved`, `renderLesson`, `renderControls`, Cancel handler)
- Modify: `public/styles.css` (outline row states)

**Interfaces:**
- Consumes: `POST /api/outline`, `POST /api/step`, `POST /api/followup` (Task 3); `playFrom` and `resumePoint` (Task 7).
- Produces: the final behaviour. No later task depends on new names.

- [ ] **Step 1: Implement generation.**
  - **`createLesson`:** POST `/api/outline` under `activeRequest`. Then set `lesson = { id, title, topic, level, model, notes, cursor: 0, steps: outline.steps.map(({ heading, goal }) => ({ heading, goal, pending: true })) }`, save, render, and start `runQueue()`.
  - **`runQueue()`:**
    - Store `generation = { lessonId, controller }` (separate from `activeRequest`).
    - Go through `lesson.steps` in order. For each step that is `pending && !failed`, POST `/api/step` with `{ model, topic, notes, level, outline: { title, steps: steps.map(s => ({ heading: s.heading, goal: s.goal ?? s.heading })) }, index, previous }`.
    - `previous` is made of the ready steps before `index`. Each contributes `heading + ': ' + beats.map(b => b.say).join(' ')`. Join them with `\n` and keep the last 4,000 chars.
    - **On success:** replace the step with `{ ...result, goal }`, save, re-render the outline (and the board, if it is the current step) and resolve any `stepReady` waiters.
    - **On error:** set `failed: true, error: message`, resolve waiters with `'failed'`, and continue.
    - **On abort:** resolve waiters with `'cancelled'` and stop.
    - Address steps by object reference, not by index, so a lesson switch can't write into the wrong lesson. If `lesson.id !== generation.lessonId`, still save to `saved`, but don't re-render.
  - **`stepReady(step) → Promise<'ready'|'failed'|'cancelled'>`.**
  - **Playback:** when playback reaches a pending step, show "Drawing the next step…" in `speech-status` and `await stepReady`. If the result is not `'ready'`, stop playback with "This step could not be drawn. Use Retry in the outline."
  - **Outline rows:**
    - a pending row shows "preparing…";
    - a failed row shows a Retry button that calls `retryStep(i)`, which clears `failed` and starts `runQueue()` if none is running;
    - the current pending step shows its heading, an empty board and "Preparing this step…" as its transcript.
  - **Controls:**
    - Back, Next and Play stay enabled while generating.
    - Create lesson and Ask are disabled while generating. The ask status reads "Follow-ups open once every step is drawn."
    - Cancel is visible and aborts `generation`, and also `activeRequest`.
    - Opening another lesson or a sample, or New lesson, does not cancel generation for the lesson being generated.
  - **`readSaved()`:** steps with `pending` are marked `failed: true`, so they show Retry. Generation does not restart automatically.
  - **Follow-up:**
    - Disabled while the current step is pending.
    - `context` is `JSON.stringify` of up to 5 prior ready steps, each `{ current, heading, say: beats.map(b => b.say), shapes: texts and labels, question }`, capped at 10,000 chars. Drop the oldest steps until it fits.
    - The answer is inserted as `{ ...step, question }` after the cursor, as today.

- [ ] **Step 2: Run all tests.** Run `npm test`. Expected: all PASS.

- [ ] **Step 3: Check in a browser with Gemini** (`GEMINI_API_KEY` set). These checks cover Review Focus items 4 and 5.
  1. Create "Why does a ball follow a parabola?": the outline appears within a few seconds, with rows marked "preparing…".
  2. Press Play as soon as step 1 is ready. Playback continues into later steps, waiting with "Drawing the next step…" when it catches up.
  3. **Cancel mid-generation:** generation stops, ready steps still play, and pending rows show Retry. Retry generates them.
  4. **Hang checks.** While playback waits on a pending step, try each of these: press Back, press Replay step, open a sample, press Cancel. In every case speech stops, the button reads "Play lesson", and nothing stays stuck.
  5. **Forced failure:** stop the server mid-generation and restart it. Failed rows show Retry, and Retry works.
  6. Reload the page mid-generation. The lesson reopens with Retry on the unfinished steps.
  7. Ask a follow-up after generation: a new drawn step is inserted after the current one.
  8. Load an old-format saved lesson that includes a follow-up step: it opens, and the outline shows "Follow-up: …".

  If no Gemini key is available, run checks 1–7 against Ollama with a small model and say so.

- [ ] **Step 4: Commit.** Run `git add public/ && git commit -m "Generate lessons step by step with progressive playback and retry"`.

---

### Task 9: README and final verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update `README.md`.**
  - Explain that the board draws shapes, equations and computed graphs, timed to narration.
  - List the shape kinds and the expression functions.
  - Describe outline-first generation, with Retry and Cancel.
  - Mention the new derivative sample.
  - Mention the bundled Caveat font (OFL).
  - Note the Ollama `num_ctx` and `num_predict` settings.
  - Remove the sentence "The supported board formats are flow, comparison, and ordered steps." and the sentence saying a lesson is generated before playback.

- [ ] **Step 2: Run the full suite.** Run `npm test`. Expected: all PASS, 0 failures. Paste the summary line into the task report.

- [ ] **Step 3: Commit.** Run `git add README.md && git commit -m "Document the drawing board"`.
