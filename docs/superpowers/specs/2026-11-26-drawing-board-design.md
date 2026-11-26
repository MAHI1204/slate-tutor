# Drawing Board: design

Date: 2026-11-26
Status: draft, awaiting approval

Demo target: **Gemini** (the default `gemini-3.1-flash-lite`). Ollama must keep working, but it is not the tuning target.

## Intent

Slate Tutor is a portfolio project. Today each lesson step shows 2–4 HTML text cards in one of three fixed layouts (flow, compare, steps), uncovered one by one while the browser reads them aloud. The aim is for the board to **draw**, the way a tutor at a whiteboard does: shapes, arrows, labels, equations and exact function graphs appear stroke by stroke, timed to the spoken explanation. This is the feature that makes the gap with products like ahaboard.ai visible in a demo, so it comes first.

## Goals

1. The model describes each step as a short script of **beats**. A beat is one spoken sentence or two plus the shapes drawn while it is spoken.
2. The model can use only a fixed vocabulary of shapes (below). The app validates the shapes, repairs what it can, and renders them as SVG in a hand-drawn style.
3. Graphs are **computed by the app** from a math expression, never drawn freehand by the model.
4. Playback draws each beat's shapes while that beat is narrated, and the transcript highlights the sentence being spoken.
5. The board is never left half-drawn. Back, Next, the outline and opening a lesson show the step's full board. Pause shows every beat drawn so far, with the current beat completed (see Animation and narration sync).
6. Follow-up answers use the same beat format.
7. The offline samples show the feature off without any model running: the two existing samples are rewritten in the new format, and a third sample with a function graph is added.
8. Lessons saved under the old format still open.

## Non-goals (for this piece of work)

- Teacher's-notes planning pass, interruptible voice conversation, hint/homework mode, quizzes, PDF/image input, accounts, sharing, export. These are later features.
- Free drawing by the user on the board.
- Multi-step boards that persist across steps (each step starts on a clean board).
- Playback speed control.

## Anti-goals (would count as failure even if it technically works)

- Adding npm dependencies or a build step. The repo is plain Node 22 + static ES modules, and must stay that way.
- Any model-produced string reaching the DOM as HTML or SVG markup. All text goes in via `textContent` or SVG text nodes, and all geometry is computed by app code.
- Using `eval`/`new Function` for expressions (the CSP forbids it anyway).
- Breaking the offline samples or the Ollama path. Small local models (e.g. qwen2.5:7b) must still produce usable boards most of the time.
- A board where shapes overlap so badly that it is unreadable.

## Constraints

- Server CSP: `default-src 'self'; script-src 'self'; style-src 'self'`. There are no inline `<style>` blocks or `style=""` attributes in markup. Setting styles through the DOM style API from JS is fine, and so are SVG presentation attributes.
- The server serves only an explicit file map ([server.mjs](../../../server.mjs) `files`). Every new static file needs an entry with the correct content type.
- Structured output goes to two providers: Gemini (`responseJsonSchema`) and Ollama (`format`, a JSON-schema grammar). Ollama's support for `anyOf`/`oneOf` is unreliable, so the schema must avoid unions.
- Existing localStorage key: `slate-tutor-history-v1`, with steps shaped `{heading, explanation, diagram:{type, items}}`.

## Approaches considered

| | Approach | Trade-off |
|---|---|---|
| **A (chosen)** | The model emits beats containing shapes from a fixed vocabulary on a coarse grid. The app validates, lays out and animates them as SVG. | Reliable with small models, checkable, exact graphs, narration can sync per shape. It can only draw what the vocabulary allows. |
| B | The model writes raw SVG and the app animates it. | Unlimited in theory. Small models produce broken or overlapping SVG, it is hard to validate, it carries injection risk, and there is no per-shape narration sync. |
| C | Keep the card layouts and animate them as if handwritten. | Cheap and safe, but still text boxes. No graphs or diagrams, which is the whole gap. |

The user picked A.

## Design

### Lesson data shape (new)

```js
lesson = { title, steps: [step, ...] }          // 3–5 steps (unchanged)
step = {
  heading,                                       // ≤72 chars (unchanged)
  beats: [ { say, draw: [shape, ...] }, ... ],   // 2–6 beats
  explanation                                    // derived server-side: beats' `say` joined with spaces
}
```

- `say`: 1–2 sentences, ≤300 chars.
- `draw`: 0–4 shapes per beat, and no more than 16 shapes per step.
- `explanation` is no longer requested from the model. The server builds it, so the transcript, follow-up context and old code paths keep working.

### Board coordinates

- The board is a 16 × 9 grid (x 0–16 left→right, y 0–9 top→bottom).
- The SVG uses `viewBox="0 0 1600 900"` (1 grid unit = 100 px) and scales to the board width.
- The model positions shapes in grid units, and decimals are allowed.

### Shape vocabulary

Each shape has a `kind`, plus an optional `id` that later shapes can reference.

| kind | Fields | Drawn as |
|---|---|---|
| `text` | `at:[x,y]`, `text` (≤80), `size`: `title`/`body`/`small`, `align`: `left`/`center` | Handwritten text, revealed left to right |
| `equation` | `at`, `text` (Unicode math, ≤80) | Like `text`, slightly larger, accent colour |
| `box` | `at` (top-left), `w`, `h`, `label?` | Sketchy rectangle, label centred inside |
| `circle` | `at` (centre), `r`, `label?` | Sketchy circle, label centred |
| `arrow` | `from`, `to` (each is a shape `id` or `[x,y]`), `label?` | Sketchy line with an arrowhead, label at the midpoint. When it points at an id, it attaches to that shape's edge. |
| `line` | `from`, `to`, `dashed?` | Sketchy line |
| `axes` | `at` (top-left), `w`, `h`, `x:[min,max]`, `y:[min,max]`, `xLabel?`, `yLabel?` | Axis lines with ticks and labels |
| `plot` | `axes` (id), `fn` (expression in `x`), `domain?:[a,b]`, `label?` | Polyline sampled from the computed function, clipped to the axes |
| `point` | `at`, `axes?` (id; if set, `at` is in data coordinates), `label?` | Dot with a label |
| `highlight` | `target` (id) | Hand-drawn loop or underline around an existing shape, for emphasis |

**Schema encoding:** this uses one flat shape record with `kind` as an enum and every field present. Fields that don't apply to the kind are `null`. This keeps the schema union-free for Ollama. Validation then strips the nulls.

**Expressions:** a small hand-written tokenizer/parser in a shared ES module. It is imported by the server (to validate `fn`) and by the browser (to sample it). It supports:
- numbers, `x`, `pi`, `e`
- `+ - * / ^`, unary minus, parentheses, implicit multiplication like `2x` (optional, builder's call)
- `sin cos tan asin acos atan sqrt abs exp ln log`

There is no `eval`. Non-finite samples break the polyline into segments rather than drawing to infinity.

### Step-by-step generation (user decision)

A drawn step costs roughly as many output tokens as a whole lesson does today, so lessons are generated in pieces:

1. **`POST /api/outline`** takes `{model, topic, notes, level}` and returns `{title, steps:[{heading, goal}]}`, with 3–5 steps. `goal` is one sentence (≤160 chars) saying what the step must teach. The outline already follows the arc "intuition → mechanism → worked example with its answer".
2. **`POST /api/step`** takes `{model, topic, notes, level, outline, index, previous}` and returns one validated step (the format above). `previous` holds the `say` lines of the steps already generated (capped at about 4,000 chars, most recent kept), so steps stay consistent with each other and don't repeat.
3. The browser calls the outline, shows the lesson with every step marked *preparing…* in the outline, then requests the steps **one at a time, in order**. Sequential requests keep steps coherent and stay inside Gemini free-tier rate limits. Step 1 can be played as soon as it arrives.
4. If playback reaches a step that isn't ready, it waits on that step and shows "Drawing the next step…", then continues.
5. **Failure:** if a step fails (after the existing error mapping), that outline row shows *Retry*. Steps already generated keep working. The steps after the failed one keep generating, because `previous` simply skips the missing step.
6. **Cancel:** the Cancel button aborts the outline request or any remaining step requests. The lesson keeps the steps it already has.
7. **Storage:** a lesson saves after the outline and after each step. Steps not yet generated are stored as `{heading, goal, pending:true}`. When a saved lesson with pending steps is reopened, those rows show *Retry*. Generation does not restart automatically.
8. **`POST /api/lesson` is removed.** `POST /api/followup` stays and returns one step in the new format.
9. **Ollama:** also send `options.num_ctx` (8192) and `options.num_predict` (enough for one step, about 3,000) so a step isn't cut off. The 180 s per-request timeout stays, and it now applies per step.

### Validation and repair (server, in `tutor.mjs`)

Repair is lenient, so a single bad shape never fails the whole lesson.

- Clamp coordinates and sizes to the grid. Truncate over-long text.
- Drop a shape when:
  - its `kind` is unknown, or its required fields are missing;
  - an `arrow`, `plot`, `point` or `highlight` refers to an id that doesn't exist yet (references must point *earlier* in the step);
  - its `fn` doesn't parse.
- If a step ends up with **zero** drawable shapes, give it a fallback board: the heading plus the `say` lines written as text shapes, one per beat. Nothing extra is added to the prompt for this.
- The existing hard failures (502) stay for structural problems: no steps, wrong step count, missing heading or beats.

### Layout (browser)

1. Place shapes at the model's coordinates.
2. After the handwriting font loads, measure the real bounding boxes. For text this uses `getBBox`.
3. Resolve overlaps among text, labels and boxes by nudging the later shape down (then right) in small steps, staying inside the board. Arrows and lines re-route to their endpoints after nudging.
4. If the content still overflows the board, scale the whole drawing down to fit.

Layout is a pure function (shapes + measured sizes → positions), so it can be unit-tested under Node with estimated text widths.

### Rendering and look

- A new module (for example `public/board.js`) renders shapes into an `<svg>` inside the existing `.board`, replacing `#diagram` for new-format steps.
- **Sketchy strokes:** each path gets a slight jitter, generated from a random seed derived from the shape id or index, so a replayed board looks identical. No rough.js; the jitter is a few dozen lines.
- **Handwriting font:** one OFL-licensed handwriting font, self-hosted as `.woff2` under `public/fonts/` (for example Caveat or Kalam), with its licence file. It needs a server file-map entry with type `font/woff2`. If it fails to load, the fallback stack is `"Segoe Print", "Comic Sans MS", cursive`.
- **Colours:** slate board (dark blue-grey) with chalk-white strokes and the existing green accent for equations, plots and highlights. *This is my call, from the product name "Slate". All colours are CSS tokens, so a white board is a one-line swap.*
- **Accessibility:**
  - The SVG gets `role="img"` and an `aria-label` built from the step heading and the shape texts.
  - The transcript stays as plain text.
  - With `prefers-reduced-motion: reduce`, beats appear instantly with no stroke animation.

### Animation and narration sync

- **Strokes** (box, circle, line, arrow, axes, plot, highlight) animate with `stroke-dasharray`/`stroke-dashoffset` using the Web Animations API.
- **Text and equations** are revealed by an animated clip rectangle sweeping left to right.
- **For each beat:**
  1. Start narrating `say` (existing `readAloud`).
  2. At the same time, draw the beat's shapes in order. Spread them across the estimated speaking time (about 2.6 words per second at the current 0.94 rate, minimum about 0.6 s per shape).
  3. Move to the next beat only when **both** the speech and the drawing have finished.
  4. With narration off or no voice available, use the estimated duration as the timer (as `hold` does today).
- **Transcript:** the explanation panel renders the beats as separate spans and highlights the one being spoken.
- **Pause** stops speech and finishes the current beat's drawing instantly. The board shows beats 1…k (the current beat included), not the whole step, and the transcript keeps beat k highlighted. **Play** resumes from beat k+1. This needs a "drawn up to beat k" state, and `board.js` must be able to render a partial board without animation. (Today pause restarts the step, so this is an improvement.)
- **Play** keeps today's behaviour: it runs on through the remaining steps automatically.
- **Back, Next, the outline, and opening a lesson** all render the step's full board instantly, with no animation.
- A **Replay step** control (small, next to the step counter) redraws the current step from its first beat and stops at the end of that step.

### Old saved lessons and the `diagram` format

A converter turns old `{diagram:{type, items}}` steps into beats when they are loaded:
- `flow` → boxes left to right joined by arrows
- `compare` → two or more columns of box + detail text
- `steps` → a numbered text list

The `explanation` becomes the first beat's `say`. There is one renderer, not two. The storage key stays the same, and the converter runs on read.

### Model instructions

- Extend the `teacher` system prompt with a compact description of the grid, the shape vocabulary, and the rules:
  - reference only earlier ids;
  - keep within 0–16 × 0–9;
  - use `axes` + `plot` for any function or graph;
  - use `arrow` for forces, flows and causes;
  - no more than 4 shapes per beat.
- Include **one short worked example** step in the prompt. Small models rely on it heavily.
- Lesson instruction is unchanged in spirit: start with intuition, explain the mechanism, end with a worked example and its answer.
- Follow-up instruction: one step, 2–4 beats, answering the question on a fresh board.
- The follow-up `context` sent from the browser includes `heading`, the `say` lines and a short list of shape texts, not full geometry, to keep the prompt small.

### Files touched (expected)

- `tutor.mjs`: outline and step schemas, `outline()` / `step()` / `followup()`, validation and repair, derived `explanation`, prompts, Ollama `num_ctx`/`num_predict`.
- `public/board-math.js` (new, shared): expression parser and evaluator.
- `public/board.js` (new): layout, sketchy rendering, animation.
- `public/app.js`: outline-then-steps generation queue with pending/retry rows, playback that waits for steps not yet generated, playback loop by beats, transcript highlighting, pause/resume, replay, old-format converter, follow-up context.
- `public/samples.js`: Moon and binary search rewritten as beats, plus a new graph sample (for example "What a derivative means": plot x², draw a tangent line, label the slope).
- `public/index.html`, `public/styles.css`: board markup, slate theme, font-face, replay control.
- `public/fonts/`: font file and licence.
- `server.mjs`: `/api/outline` and `/api/step` routes (`/api/lesson` removed), plus file-map entries for the new modules and the font.
- `server.test.mjs` plus new tests (see below).
- `README.md`: describe the drawing board and the supported shapes.

### Testing

- **Unit tests (node --test):**
  - the expression parser: valid, invalid, edge cases such as `1/x` near 0, and `sqrt` of negative numbers;
  - shape validation and repair: clamping, dropped bad references, the fallback board, derived `explanation`;
  - the old-format converter;
  - the layout overlap resolver, with estimated text widths.
- **Integration tests:** replace the `/api/lesson` tests with `/api/outline` and `/api/step` tests, for both the Ollama double and the Gemini fetch double. Cover these cases: `previous` and the outline reach the step prompt; Ollama gets `num_ctx`/`num_predict`; a step with some invalid shapes is repaired rather than rejected; a structurally broken step returns 502.
- **Manual check in a browser:** all three samples play with narration on and off; pause/resume; Back/Next; a saved old-format lesson still opens; reduced motion; a real lesson from Gemini, including step 1 playing while later steps generate, a forced step failure with Retry, and Cancel mid-generation; and one lesson from an Ollama 7B model.

## Calls I made (for review)

1. Slate (dark) board with chalk-style strokes, rather than a white board.
2. A single flat shape schema with nulls, rather than one schema per shape kind.
3. Lenient repair with a text fallback board, rather than retrying the model.
4. One self-hosted handwriting font file plus its licence.
5. Pause resumes at the next beat. Back/Next show the full board instantly.
6. Old lessons are converted on load, not kept on a second renderer.
7. A third, graph-based sample is added to show computed plots offline.
8. A small Replay step control is added. It stops at the end of its step, while Play runs on through the lesson.
9. Pause keeps the beats drawn so far, not the whole step.

## Left to the builder

- The exact jitter algorithm, stroke widths and animation easing and durations.
- Prompt wording and the worked example's content.
- Whether implicit multiplication (`2x`) is supported in expressions.
- Internal module split beyond the files listed above.
- The precise nudge step size and the order of attempts in the overlap resolver.
