# Slate Tutor

Slate Tutor is a general-purpose whiteboard teaching platform. Enter a topic or paste study notes. Gemini or a local Ollama model generates a lesson with scene-by-scene explanations and diagrams. Play the lesson to reveal and read the board. Pause or ask a follow-up to add a new explanation into the current lesson.

## Try the samples first

Requires Node.js 22 or newer. Extract the project, open a terminal in that folder, and run:

```bash
npm start
```

Open <http://127.0.0.1:5173>. Choose a sample in the sidebar. The samples work with the model service offline.

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

The app uses the local Ollama JSON API and requires no paid API key. Model generation speed and output quality depend on the model and machine. The browser handles narration and optional push-to-talk dictation. Browser voice availability varies. Dictation can use your browser provider's speech service, and typed input works without it. The app serves on loopback by default. Notes and generated lessons are saved in that browser's local storage.

The first version supports text, TXT, Markdown, and CSV. A lesson is generated before playback, and follow-ups pause playback. Voice input is push-to-talk. The supported board formats are flow, comparison, and ordered steps.

## Development

There is no package installation or build step. Run the HTTP integration tests with:

```bash
npm test
```

The integration tests use a test double for Ollama. The server defaults to port 5173 and connects to `http://127.0.0.1:11434`; operators may set `PORT` or `TUTOR_OLLAMA_URL`. Keep the default loopback setup for personal testing. If you deploy it for others, use a Node host with access to a model service and add user authentication and quotas before exposing the API.

The repository can be connected to Codex for changes and test runs. Its Node backend handles lesson generation and follow-ups, so run or deploy that backend when serving the web platform.
