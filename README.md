# Personal Read Assistant

Desktop reading assistant bootstrap for PDF + EPUB with a retrieval-ready architecture.

## Current baseline

- Angular standalone app with routed `ReaderShell`.
- Tauri desktop runtime with command scaffolding.
- Library panel that imports local `.pdf` and `.epub`.
- PDF viewer integrated via `pdfjs-dist`.
- EPUB viewer scaffold with CFI navigation hooks.
- Reading assistant panel with hybrid model routing (`cloud`/`local`).
- Reading memory event tracker (page/section/jump).
- Persisted model provider config in Tauri app data.

## Model mode

The app is designed around bundled Gemma as the default model path. Cloud and
external local model connections are available from the assistant panel's
advanced model controls.

Bundled Gemma expects these files in `src-tauri/resources/gemma` before
packaging:

- `gemma-server.exe`
- `gemma-3-1b-it-q4.gguf`

Advanced cloud mode expects an OpenAI-compatible endpoint (`/v1/responses`) and
API key. Advanced local mode expects an Ollama-compatible endpoint
(`/api/generate`).

## Run locally

```bash
npm install
npm run start
```

For desktop mode:

```bash
npm run tauri:dev
```

Bundled Gemma requires desktop mode. Browser-only Angular mode (`npm run start`)
can render the UI, but it cannot access packaged model resources or Tauri
commands.

## Build checks used in this repo

```bash
npm run build
cd src-tauri && cargo check
```

## Next implementation targets

1. Replace EPUB placeholder with full `epub.js` rendition.
2. Add document extraction + chunking pipeline.
3. Add embeddings, vector index, and hybrid retrieval.
4. Connect retrieval anchors to precise in-view highlights.
