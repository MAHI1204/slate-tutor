# Slate Tutor

Slate Tutor is a general-purpose whiteboard teaching platform. Enter a topic or paste study notes. Gemini or a local Ollama model plans a lesson and then draws it step by step on a slate board: shapes, arrows, equations and exact function graphs appear stroke by stroke while the narration explains them. Pause at any point, replay a step, or ask a follow-up to add a new drawn explanation to the current lesson.

## Try the samples first

Requires Node.js 22 or newer. Extract the project, open a terminal in that folder, and run:

```bash
npm start
```

Open <http://127.0.0.1:5173>. Choose a board under **Try a board**: a two-bit branch predictor, photosynthesis, the Moon's phases, binary search, or what a derivative means (which plots computed curves). The samples work with the model service offline.

## How the board works

Each lesson step is a short script of *beats*. A beat is a sentence or two of narration plus the shapes drawn while it is spoken. The model can use a fixed set of shapes on a 16 × 9 grid: text, equations, boxes, circles, arrows, lines, graph axes, function plots, points and highlights. The server checks every shape it receives: it clamps positions to the board, drops shapes that are broken, and falls back to a written board if nothing drawable is left, so one bad shape never fails a lesson. The browser then lays out the shapes, nudges apart any that overlap, and draws them in a hand-drawn style.

Plots are computed by the app, not drawn by the model. A plot's function is written in `x` with `+ - * / ^`, parentheses, `pi`, `e` and `sin cos tan asin acos atan sqrt abs exp ln log` (`log` is base 10). It is parsed safely, without `eval`.

Lessons are generated in two stages. A quick first request returns the title and the step headings, then each step is generated in order. You can start playing step 1 while later steps are still being drawn; playback waits for a step that is not ready. **Cancel** stops generation and keeps the finished steps. A step that fails or was cancelled shows **Retry** in the outline.

Earlier steps stay on the slate above the current one, so the board builds up as the lesson goes on. **Learn a topic**, **Exam practice** and **Homework help** set the teaching goal, and **Language** sets the language of the narration and the board. The final step can carry a knowledge check that you reveal by clicking it. **Playback** can pause after each step, and **Speed** changes both the voice and the drawing pace. **Bring a lesson from Academic AI** copies a prompt for an external chatbot; its JSON answer opens as a drawn board, and the older card format is converted automatically.

The board uses the Caveat handwriting font (SIL Open Font License, bundled in `public/fonts/`). With reduced motion turned on in your system settings, each beat appears at once instead of being drawn.

## Run with Gemini in a GitHub Codespace

Add a Codespaces secret named `GEMINI_API_KEY` to the repository before creating the codespace. Create a 2-core codespace, run `npm test` and then `npm start`. Open port 5173 in the Ports panel and leave its visibility private. With a key present the server selects Gemini; topics, supplied notes, and follow-up context are sent to Google. The default model is `gemini-3.1-flash-lite`; set `GEMINI_MODEL` to override it. “Gemini configured” indicates a key is present; create a lesson to verify its permissions and project quota.

## Generate lessons locally with Ollama

1. Install [Ollama](https://ollama.com/download).
2. If Ollama is not already running, start `ollama serve` in a separate terminal.
3. Download a model, for example:

   ```bash
   ollama pull qwen2.5:7b
   ```

4. Start the app with `npm start`, open it, and click **Refresh** beside the model status.
5. Pick the installed model, enter a question, and click **Create lesson**. Try a follow-up while viewing a step.

The app asks Ollama for a context window of 8192 tokens and up to 3000 output tokens per step (`num_ctx` and `num_predict`), and allows each request 3 minutes. Small models draw simpler boards; Gemini gives the best results.

The app uses the local Ollama JSON API and requires no paid API key. Model generation speed and output quality depend on the model and machine. The browser handles narration and optional push-to-talk dictation. Browser voice availability varies. Dictation can use your browser provider's speech service, and typed input works without it. The app serves on loopback by default. Notes and generated lessons are saved in that browser's local storage.

Study notes can be typed or loaded from TXT, Markdown, or CSV files. Follow-ups pause playback and open once every step of the lesson is drawn. Voice input is push-to-talk. Lessons saved by earlier versions of the app are converted to the drawn format when they are opened.

## Development

There is no package installation or build step. Run the unit and HTTP integration tests with:

```bash
npm test
```

The integration tests use a test double for Ollama. The server defaults to port 5173 and connects to `http://127.0.0.1:11434`; operators may set `PORT` or `TUTOR_OLLAMA_URL`. Keep the default loopback setup for personal testing. If you deploy it for others, use a Node host with access to a model service and add user authentication and quotas before exposing the API.

The repository can be connected to Codex for changes and test runs. Its Node backend handles lesson generation and follow-ups, so run or deploy that backend when serving the web platform.
