# Requirements Document

## Introduction

This feature refactors the Personal Reading Assistant Angular 18 app to remove all in-house and local LLM infrastructure (bundled Gemma, LM Studio / Ollama) and replace it with a single, environment-driven cloud model configuration. At the same time it replaces the EPUB viewer stub with a real epub.js rendition and wires up EPUB text extraction so EPUB documents can be indexed and searched on the same footing as PDFs.

The four areas of change are:

1. **Local LLM removal** — strip `bundled-gemma` and `local` provider code from models, services, and UI.
2. **Cloud config from environment** — read `apiBaseUrl`, `model`, and `apiKey` from Angular environment files (populated by a root `.env` file at build time); show a read-only status line in the assistant panel.
3. **Full EPUB viewer** — replace the placeholder with an epub.js `Book` + `Rendition` inside a host `<div>`, supporting CFI navigation and `locationChanged` events.
4. **EPUB document indexing** — extract EPUB chapter text via epub.js so EPUB chunks flow into the same embedding + search pipeline used for PDFs.

---

## Glossary

- **App**: The Angular 18 standalone Personal Reading Assistant application.
- **AssistantService**: `src/app/core/services/assistant.service.ts` — orchestrates retrieval and LLM calls.
- **ModelConfigService**: `src/app/core/services/model-config.service.ts` — manages provider configuration and status signals.
- **CloudModelConfig**: The single remaining model-configuration interface after local providers are removed; holds `apiBaseUrl`, `model`, and `apiKey`.
- **ProviderStatus**: A read-only signal value that indicates whether the cloud provider is configured and its human-readable label.
- **Environment**: Angular environment files at `src/environments/environment.ts` and `src/environments/environment.prod.ts`.
- **DotenvFile**: A `.env` file at the project root whose values are injected into the Environment at build time (e.g. via `@ngx-env/builder` or a custom Vite plugin).
- **ReaderShellComponent**: `src/app/features/reader-shell/reader-shell.component.ts/.html` — the main reading UI.
- **AssistantPanel**: The collapsible sidebar inside ReaderShellComponent that contains the query input, answer box, passage results, and (formerly) provider settings.
- **EpubViewerComponent**: `src/app/features/epub-viewer/epub-viewer.component.ts` — renders EPUB content.
- **EpubJs**: The `epubjs` npm package (`epub.js`). Provides `Book` and `Rendition` APIs for rendering EPUB files.
- **CFI**: EPUB Canonical Fragment Identifier — a string that addresses a precise location inside an EPUB (e.g. `epubcfi(/6/4!/4/2/1:0)`).
- **DocumentIndexService**: `src/app/core/services/document-index.service.ts` — extracts text, chunks it, embeds it, and provides hybrid search.
- **EmbeddingService**: `src/app/core/services/embedding.service.ts` — local `@xenova/transformers` model for semantic embeddings (kept unchanged).
- **IndexedChunk**: An in-memory record of a text chunk with its embedding, source page or CFI, and section path.
- **RetrievedPassage**: The search result returned to the UI; contains `snippet`, `sectionPath`, and `anchor`.
- **Anchor**: A `DocumentAnchor` value that stores `format`, `page` (PDF) or `cfiStart` (EPUB) so the viewer can jump to a location.

---

## Requirements

### Requirement 1: Remove Bundled-Gemma and Local Provider Code

**User Story:** As a developer, I want all bundled-Gemma and local-model code eliminated, so that the codebase no longer carries unused Tauri sidecar dependencies or Ollama-compatible paths.

#### Acceptance Criteria

1. THE App SHALL contain no TypeScript source files that reference the string literal `'bundled-gemma'` as a `ModelMode` value after this change is applied.
2. THE App SHALL contain no TypeScript source files that reference the string literal `'local'` as a `ModelMode` value after this change is applied.
3. THE App SHALL contain no `BundledGemmaConfig` interface declaration and no TypeScript property whose value references `gemma-server.exe`, any `.gguf` filename pattern, or the endpoint `http://127.0.0.1:17641`.
4. THE App SHALL contain no `LocalModelConfig` interface declaration and no TypeScript property whose value references the path segment `/api/generate` in an Ollama-compatible endpoint string.
5. THE ModelConfigService SHALL expose a `config` signal typed as `CloudModelConfig`, and its `loadConfig` and `saveConfig` method signatures SHALL accept and return only `CloudModelConfig`; no method on `ModelConfigService` SHALL reference `HybridModelConfig`, `BundledGemmaConfig`, or `LocalModelConfig` by name.
6. THE AssistantService SHALL contain no method named `callBundledGemma` and no method named `callLocalModel` after the refactor.
7. THE AssistantService `generateGroundedAnswer` method SHALL call the OpenAI-compatible `/chat/completions` endpoint unconditionally for every LLM generation request; it SHALL contain no conditional branch that routes to a Tauri sidecar or to an Ollama `/api/generate` endpoint.
8. THE ReaderShellComponent SHALL import no symbols from any removed interface; specifically, the import declarations in `reader-shell.component.ts` SHALL NOT name `HybridModelConfig`, `ModelMode`, `BundledGemmaConfig`, or `LocalModelConfig`, and the component class body SHALL contain no properties or method parameters typed with those names.
9. THE `model-config.models.ts` file SHALL NOT export a `DEFAULT_MODEL_CONFIG` constant, a `HybridModelConfig` interface, a `ModelMode` type, a `BundledGemmaConfig` interface, or a `LocalModelConfig` interface after the refactor.

---

### Requirement 2: Cloud Model Configuration from Environment

**User Story:** As a developer, I want the cloud model's API base URL, model name, and API key to come from Angular environment files (backed by a `.env` file), so that secrets are never stored in source code or user-editable UI fields.

#### Acceptance Criteria

1. WHEN the Angular application initializes, before any AI service call is made, THE App SHALL have read `cloudApiBaseUrl`, `cloudModel`, and `cloudApiKey` values from the Angular `environment` object imported from `src/environments/environment.ts`.
2. THE Angular `environment` object SHALL expose `cloudApiBaseUrl`, `cloudModel`, and `cloudApiKey` as properties typed `string` in both `environment.ts` (development) and `environment.prod.ts` (production).
3. THE DotenvFile (`.env` at project root) SHALL be the authoritative source for the three values; the Environment files SHALL reference them via build-time substitution tokens (e.g. `process.env.CLOUD_API_BASE_URL`).
4. THE ModelConfigService SHALL initialize the `config` signal from the Angular `environment` object inside its constructor, without invoking any `TauriBridgeService` method.
5. WHEN the Angular `environment` has `cloudApiBaseUrl`, `cloudModel`, and `cloudApiKey` values that each contain at least one non-whitespace character, THE ProviderStatus signal SHALL be set to `{ configured: true, message: 'Cloud ready: <model>' }` where `<model>` is the trimmed value of `cloudModel`.
6. IF the Angular `environment` has a `cloudApiKey` value that is empty or contains only whitespace characters, THE ProviderStatus signal SHALL be set to `{ configured: false, message: 'Missing API key' }`, regardless of whether `cloudModel` is set.
7. IF the Angular `environment` has a non-empty `cloudApiKey` but a `cloudApiBaseUrl` value that is empty or contains only whitespace characters, THE ProviderStatus signal SHALL be set to `{ configured: false, message: 'Missing API base URL' }`.
8. THE AssistantPanel SHALL display a status line that contains no interactive elements (no `<input>`, `<textarea>`, `<select>`, or `<button>` elements) and whose text content reflects the current ProviderStatus message (e.g. "🟢 Cloud ready: gpt-4.1-mini" or "🔴 Missing API key").
9. THE AssistantPanel SHALL NOT contain any `<input>` or `<textarea>` elements bound to API base URL, model name, API key, runtime file, or model file fields.
10. THE AssistantPanel SHALL NOT render a "Provider Settings" section heading, mode-toggle buttons, a "Show Advanced Models" toggle button, a "Save Settings" button, or a "Refresh Status" button.
11. WHEN the ProviderStatus `configured` field is `true`, THE status line text SHALL be prefixed with the green circle character `🟢`.
12. WHEN the ProviderStatus `configured` field is `false`, THE status line text SHALL be prefixed with the red circle character `🔴`, including the case where `cloudApiKey` is empty.

---

### Requirement 3: Full EPUB Viewer with epub.js

**User Story:** As a reader, I want EPUB files to render as actual book content inside the viewer panel, so that I can read EPUB documents the same way I read PDFs.

#### Acceptance Criteria

1. THE App's `package.json` SHALL include `epubjs` as a production dependency with a pinned semantic version string (e.g. `"0.3.93"`).
2. WHEN `EpubViewerComponent` receives a non-null `sourceUrl` input, THE EpubViewerComponent SHALL instantiate an epub.js `Book` object using that URL and attach a `Rendition` to a host `<div>` element in the component's DOM.
3. THE host `<div>` element used by the Rendition SHALL have a CSS height of at least `1px` so that epub.js can calculate pagination.
4. WHEN the epub.js Rendition emits its first `rendered` or `relocated` event after display, THE EpubViewerComponent SHALL emit a `locationChanged` output event carrying the CFI string of the displayed location.
5. THE EpubViewerComponent SHALL have a `loadingStateChanged` output typed `EventEmitter<'loading' | 'loaded' | 'render-complete' | 'render-failed' | 'load-failed'>`; it SHALL emit `'loading'` immediately before `Book.open()` is called, `'loaded'` when the epub.js `Book` `ready` promise resolves, `'render-complete'` when the first location is rendered successfully, `'render-failed'` if the epub.js Rendition emits an error during rendering, and `'load-failed'` if `Book.open()` rejects.
6. WHEN `goToLocation(cfi: string)` is called on `EpubViewerComponent` with a non-empty CFI string, THE EpubViewerComponent SHALL call `rendition.display(cfi)` on the active Rendition.
7. WHEN the epub.js Rendition fires a `relocated` event, THE EpubViewerComponent SHALL emit a `locationChanged` output event carrying the `start.cfi` string from the relocation data.
8. WHEN `EpubViewerComponent` receives a `null` `sourceUrl` input, THE EpubViewerComponent SHALL attempt to call `rendition.destroy()` and `book.destroy()` on the current instances; IF either call throws, THE EpubViewerComponent SHALL catch the error, set both `rendition` and `book` instance fields to `null`, and clear the host container's inner HTML, so the component reaches a clean state regardless of the error.
9. WHEN `EpubViewerComponent` receives a new non-null `sourceUrl` after a previous `sourceUrl` was already set, THE EpubViewerComponent SHALL perform the same error-tolerant cleanup described in criterion 8 before instantiating the new `Book` and `Rendition`.
10. IF `Book.open()` rejects with an error, THEN THE EpubViewerComponent SHALL NOT emit a `locationChanged` event and SHALL set the host container's inner text to a non-empty, human-readable string (visible to the user) describing the failure.
11. WHEN the Angular `OnDestroy` lifecycle hook fires on `EpubViewerComponent`, THE EpubViewerComponent SHALL call `rendition.destroy()` and `book.destroy()` (with the same error-tolerant pattern from criterion 8) to release epub.js memory.
12. WHEN `goToLocation(cfi: string)` is called with an empty string or a string that does not start with `epubcfi(`, THE EpubViewerComponent SHALL NOT call `rendition.display()` and SHALL log a warning to the console.

---

### Requirement 4: EPUB Chapter Text Extraction

**User Story:** As a developer, I want epub.js to extract chapter text from an EPUB file during indexing, so that EPUB documents can be chunked, embedded, and searched the same way PDFs are.

#### Acceptance Criteria

1. WHEN `DocumentIndexService.indexDocument` is called with a `LibraryDocument` whose `format` is `'epub'`, THE DocumentIndexService SHALL open the EPUB file using epub.js and iterate over its `Book.spine` items to extract plain text from each item's HTML content.
2. IF extraction succeeds for at least one spine item but the total resulting chunk list is empty (no spine item yielded a chunk passing the 40-word minimum), THE DocumentIndexService SHALL set the document's indexing state to `'error'`.
3. THE DocumentIndexService SHALL produce `IndexedChunk` records for each EPUB spine item, where `sectionPath` is set to the TOC label matching the spine item's href (or `['Chapter N']` where N is the 1-based spine index when no TOC match exists), and `cfiStart` is set to the `cfiBase` property of the spine item from the epub.js `Book.spine` API.
4. WHEN EPUB text is extracted, THE DocumentIndexService SHALL apply the same word-window chunking algorithm used for PDF pages: a window of 180 words, an overlap of 50 words, and a minimum chunk size of 40 words before a chunk is added.
5. WHEN EPUB chunks have been created for a document, THE DocumentIndexService SHALL call `EmbeddingService.getEmbeddingsBatch` with all chunk texts and assign the resulting vectors to the `embedding` field of each `IndexedChunk` before setting the document's indexing state to `'ready'`.
6. WHEN `DocumentIndexService.search` returns results for an EPUB document, each `RetrievedPassage.anchor` SHALL have `format: 'epub'` and the `cfiStart` field SHALL be set to the `cfiBase` of the spine item from which the chunk originated.
7. IF extracting text from a single spine item throws an error, THE DocumentIndexService SHALL log a `console.warn` for that item and continue processing remaining spine items without aborting the entire indexing operation.
8. IF extracting text from every spine item fails or the epub.js `Book.open()` call rejects, THE DocumentIndexService SHALL call `console.error` with the error and set the document's indexing state to `'error'`.
9. THE DocumentIndexService SHALL NOT use a browser DOM renderer or a `<iframe>` to extract EPUB text; extraction SHALL read the raw `File` object passed to `indexDocument` directly via epub.js file-loading APIs.
10. FOR EVERY EPUB document where at least one spine item yields a chunk, the value returned by `DocumentIndexService.getChunkCount` after indexing completes SHALL be greater than zero.
11. EVERY `IndexedChunk` produced from an EPUB SHALL carry a non-empty `cfiStart` string derived from the epub.js spine item's `cfiBase` property, so that the corresponding `DocumentAnchor.cfiStart` field can be populated during search.

---

### Requirement 5: Assistant Panel UI After Cleanup

**User Story:** As a reader, I want the assistant panel to show only the search query input, the AI answer box, the passage results list, and the cloud status line, so that the UI is uncluttered and focused on the reading experience.

#### Acceptance Criteria

1. THE AssistantPanel SHALL contain an `<input type="text">` element bound to the user query and a `<button>` element with visible label text "Ask" that triggers the search-recall flow.
2. THE AssistantPanel SHALL contain an answer-box element that renders the text `Thinking…` (or an equivalent loading indicator) while `isRunningAnswer` is `true`, and renders the LLM answer text when `isRunningAnswer` is `false` and `groundedAnswer` is non-empty.
3. THE AssistantPanel SHALL contain a list of passage-result elements, each displaying a snippet text and a section path label, where clicking an element calls `jumpToResult` with the corresponding `RetrievedPassage`.
4. THE AssistantPanel SHALL contain the read-only cloud status line described in Requirement 2, AC 8.
5. THE AssistantPanel SHALL NOT contain any `<input>`, `<textarea>`, or `<select>` element bound to a property of `ModelConfigService` or `CloudModelConfig`.
6. THE ReaderShellComponent TypeScript class SHALL NOT declare any of the following after the refactor: the signal `editableModelConfig`, the signal `showAdvancedModels`, or any method whose name matches the pattern `updateGemma*`, `updateCloud*`, `updateLocal*`, `saveModelConfig`, or `refreshProviderStatus`; failure to remove ALL listed items in the same commit SHALL be treated as an incomplete refactor.
7. THE ReaderShellComponent TypeScript class SHALL retain the following members with no change to their names or roles: `isAssistantOpen`, `toggleAssistant`, `query`, `results`, `selectedResultId`, `groundedAnswer`, `isRunningAnswer`, `searchRecall`, and `jumpToResult`.

---

### Requirement 6: Environment File Scaffolding

**User Story:** As a developer, I want `src/environments/environment.ts` and `src/environments/environment.prod.ts` created with the correct shape, so that the build system can substitute real values from a `.env` file without code changes.

#### Acceptance Criteria

1. THE App SHALL have a file at `src/environments/environment.ts` that exports a constant named `environment` with at minimum the properties `production: boolean` (value `false`), `cloudApiBaseUrl: string`, `cloudModel: string`, and `cloudApiKey: string`.
2. THE App SHALL have a file at `src/environments/environment.prod.ts` that exports a constant named `environment` with `production: true` and the same three cloud string properties.
3. THE `.env` file at the project root SHALL contain the lines `CLOUD_API_BASE_URL=`, `CLOUD_MODEL=`, and `CLOUD_API_KEY=` (keys present with empty values), serving as a template for developers to fill in.
4. THE `environment.ts` development file SHALL use the literal string `'https://api.openai.com/v1'` as the value of `cloudApiBaseUrl` and `'gpt-4.1-mini'` as the value of `cloudModel` when those values are not overridden by a build-time token, so that the app compiles and serves without a populated `.env` file.
5. THE `.gitignore` file at the project root SHALL contain an entry that matches `.env` exactly (not as a glob pattern that would also exclude `.env.example` files), so that the `.env` file is not tracked by git.
6. THE `angular.json` `build` architect options SHALL include a `fileReplacements` entry under the `production` configuration that replaces `src/environments/environment.ts` with `src/environments/environment.prod.ts` at production build time.

---

### Requirement 7: Round-Trip EPUB Extraction Correctness

**User Story:** As a developer, I want to verify that EPUB text extraction produces stable, non-empty output, so that I can trust the search index for EPUB documents.

#### Acceptance Criteria

1. IF an EPUB `File` object passed to `DocumentIndexService.indexDocument` contains at least one spine item with non-whitespace text, THEN the `indexingState` signal SHALL transition to `'ready'` and `getChunkCount` SHALL return a value greater than zero.
2. IF `DocumentIndexService.indexDocument` completes for an EPUB and `indexingState` reaches `'ready'`, THEN every `IndexedChunk` in the resulting chunk list SHALL have a non-empty `text` field and an `id` field that is unique within the same document's chunk list.
3. IF `DocumentIndexService.indexDocument` completes for an EPUB and `indexingState` reaches `'ready'`, THEN every `IndexedChunk` in the resulting chunk list SHALL have an `embedding` array whose length is exactly 384, matching the output dimension of `EmbeddingService` using the `Xenova/all-MiniLM-L6-v2` model.
4. WHEN the same EPUB `File` object is passed to `DocumentIndexService.indexDocument` a second time after the first call's `indexingState` has reached a terminal state (`'ready'` or `'error'`), THE `getChunkCount` return value after the second call completes SHALL equal the chunk count produced by the second extraction alone, with no chunks from the first extraction included.
