# Implementation Plan: Cloud-Only Reader Cleanup

## Overview

Refactor the app from its three-mode LLM architecture (bundled-Gemma / cloud / local) to a single
cloud provider driven by Angular environment files, and replace the EPUB viewer stub with a real
epub.js rendition plus a working text-extraction pipeline. Changes are ordered so each step leaves
the build in a compilable state.

---

## Tasks

- [x] 1. Scaffold environment files and verify project config
  - [x] 1.1 Create `src/environments/environment.ts` with development defaults
    - Export `environment` constant with `production: false`, `cloudApiBaseUrl: 'https://api.openai.com/v1'`, `cloudModel: 'gpt-4.1-mini'`, and `cloudApiKey: ''`
    - _Requirements: 6.1, 6.4_
  - [x] 1.2 Create `src/environments/environment.prod.ts` with production placeholders
    - Export `environment` constant with `production: true` and the same three cloud string properties set to empty strings
    - _Requirements: 6.2_
  - [x] 1.3 Create `.env` template at the project root
    - Add lines `CLOUD_API_BASE_URL=`, `CLOUD_MODEL=`, and `CLOUD_API_KEY=` with empty values
    - _Requirements: 6.3_
  - [x] 1.4 Add `.env` entry to `.gitignore`
    - Append the exact string `.env` on its own line (not a glob) so the secrets file is never tracked
    - _Requirements: 6.5_
  - [x] 1.5 Verify `angular.json` `fileReplacements` entry
    - Confirm `production` build config already contains the replacement of `src/environments/environment.ts` → `src/environments/environment.prod.ts`; no edit needed if already present (it is)
    - _Requirements: 6.6_

- [x] 2. Rewrite `model-config.models.ts` to cloud-only types
  - [x] 2.1 Remove all non-cloud interfaces and the default config constant
    - Delete `type ModelMode`, `interface BundledGemmaConfig`, `interface LocalModelConfig`, `interface HybridModelConfig`, and `const DEFAULT_MODEL_CONFIG`
    - Remove the `provider` field from `CloudModelConfig` (keep `apiBaseUrl`, `model`, `apiKey`)
    - Remove `mode: ModelMode` from `ProviderStatus` (keep `configured` and `message`)
    - _Requirements: 1.9, 2.5_

- [x] 3. Rewrite `ModelConfigService` to environment-driven initialization
  - [x] 3.1 Replace constructor and all methods with environment-signal init
    - Remove constructor injection of `TauriBridgeService`
    - Remove `loadConfig()`, `saveConfig()`, `refreshStatus()`, `refreshStatusFromLocalState()` methods
    - Import `environment` from `src/environments/environment`
    - Initialize `config` signal directly from environment values in the class field declaration
    - Initialize `status` signal by calling `deriveStatus()` with the same values
    - Implement private `deriveStatus(cfg: CloudModelConfig): ProviderStatus` with the three-case logic: empty `apiKey` → missing key, empty `apiBaseUrl` → missing URL, otherwise → ready
    - Remove all imports of `HybridModelConfig`, `DEFAULT_MODEL_CONFIG`, `TauriBridgeService`
    - _Requirements: 1.5, 2.4, 2.5, 2.6, 2.7_

- [x] 4. Update `AssistantService` to remove non-cloud paths
  - [x] 4.1 Remove Gemma and local model methods and routing branches
    - Delete `callBundledGemma()` and `callLocalModel()` private methods
    - Remove `TauriBridgeService` constructor injection and import
    - Update `generateGroundedAnswer`: read `config()` as `CloudModelConfig` and call `callCloudModel()` directly using `config.apiBaseUrl`, `config.model`, `config.apiKey` — no mode switch
    - Replace the EPUB-specific stub message in `recallFromLibrary` empty-results fallback with the same generic no-match message used for PDF
    - _Requirements: 1.6, 1.7, 2.4_

- [x] 5. Rewrite `EpubViewerComponent` with full epub.js rendition
  - [x] 5.1 Rewrite `epub-viewer.component.ts`
    - Add `OnDestroy` to implements; add `ViewChild` for `#epubContainer` div
    - Add `loadingStateChanged` output typed `EventEmitter<'loading' | 'loaded' | 'render-complete' | 'render-failed' | 'load-failed'>`
    - Implement `private async loadEpub(url: string)`: emit `'loading'`, call `Epub(url)`, `await book.ready` (emit `'loaded'` or `'load-failed'`), call `book.renderTo(container, {width:'100%', height:'100%'})`, wire `rendered`/`relocated`/`loaderror` events, call `rendition.display()`, emit initial CFI and `'render-complete'`
    - Implement `private async cleanup()`: call `rendition.destroy()` and `book.destroy()` in try/catch; null both refs; clear `nativeElement.innerHTML`
    - Implement `ngOnDestroy()` calling `cleanup()`
    - Update `goToLocation()` to guard: skip and warn if CFI is empty or doesn't start with `epubcfi(`
    - Remove old stub fields (`bookTitle`, `previewText`) and `loadPreview()` / `parseFileName()` methods
    - Import `Epub` (default) and type `Book`, `Rendition` from `epubjs`
    - _Requirements: 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12_
  - [x] 5.2 Rewrite `epub-viewer.component.html`
    - Replace entire template with a `.epub-shell` wrapper, a `#epubContainer` div (the rendition target), and a conditional error message paragraph
    - _Requirements: 3.2, 3.3_
  - [x] 5.3 Rewrite `epub-viewer.component.scss`
    - Replace all existing styles with `.epub-shell` (flex column, full size), `.epub-container` (flex 1, `min-height: 100px`, `iframe { border: none }`), and `.epub-error` (red text, centered)
    - _Requirements: 3.3_

- [x] 6. Update `DocumentIndexService` to implement EPUB text extraction
  - [x] 6.1 Extend `IndexedChunk` interface with EPUB fields
    - Add `cfiStart?: string` to `IndexedChunk`
    - Change `page` comment to note it defaults to `0` for EPUB chunks
    - _Requirements: 4.3, 4.6, 4.11_
  - [x] 6.2 Rename `chunkPageText` to `chunkText` with an extended signature
    - Change signature to `private chunkText(docId: string, pageOrIndex: number, text: string, sectionPath: string[], cfiStart?: string): IndexedChunk[]`
    - Update chunk `id` format for EPUB: use `${docId}-spine${pageOrIndex}-c${start}` when `cfiStart` is provided
    - Set `page: pageOrIndex` for PDF calls (keep existing callers working) and `page: 0` for EPUB calls
    - Set `cfiStart` on each produced chunk when the parameter is provided
    - Update existing `extractPdfChunks` call site to pass `[`Page ${pageNum}`]` as `sectionPath` and no `cfiStart`
    - _Requirements: 4.3, 4.4, 4.11_
  - [x] 6.3 Implement `private async extractEpubChunks(docId: string, file: File): Promise<IndexedChunk[]>`
    - Create object URL with `URL.createObjectURL(file)`, open with `Epub(objectUrl)`, `await book.ready`
    - Build a TOC label map: walk `book.navigation.toc` recursively to map `href` → `label` string
    - Iterate `book.spine.spineItems`; for each item: determine `cfiBase` from `spineItem.cfiBase`, resolve `sectionLabel` from TOC map (fallback `'Chapter N'` using 1-based index), `await spineItem.load(book.load.bind(book))`, extract text via `spineItem.document?.body?.innerText ?? ''`, normalize whitespace, skip if empty
    - Call `this.chunkText(docId, spineIndex, text, [sectionLabel], cfiBase)` and push results
    - Call `spineItem.unload()` after chunking
    - Revoke object URL after all items
    - Wrap per-item work in try/catch: log `console.warn` and continue on item error; propagate book-open errors to the caller
    - _Requirements: 4.1, 4.3, 4.4, 4.7, 4.9_
  - [x] 6.4 Wire EPUB branch into `indexDocument` and update `search` anchor
    - In `indexDocument`, replace the EPUB stub block with: call `extractEpubChunks`, run `getEmbeddingsBatch`, assign embeddings, store, `setState('ready')` if chunks > 0 else `setState('error')`
    - Wrap the entire `extractEpubChunks` call in try/catch: on catch call `console.error` and `setState('error')`
    - In `search`, update the `.map()` anchor to include `cfiStart: chunk.cfiStart` so EPUB results carry the CFI
    - _Requirements: 4.1, 4.2, 4.5, 4.6, 4.8, 4.10_

- [x] 7. Update `ReaderShellComponent` — remove model settings
  - [x] 7.1 Clean up `reader-shell.component.ts`
    - Remove `editableModelConfig` signal, `showAdvancedModels` signal, `saveMessage` signal
    - Remove all methods: `setModelMode`, `toggleAdvancedModels`, `updateGemmaEndpoint`, `updateGemmaModel`, `updateGemmaModelFileName`, `updateGemmaRuntimeFileName`, `updateCloudApiBaseUrl`, `updateCloudModel`, `updateCloudApiKey`, `updateLocalEndpoint`, `updateLocalModel`, `saveModelConfig`, `refreshProviderStatus`
    - Remove imports of `HybridModelConfig` and `ModelMode` from `model-config.models`
    - Remove `implements OnInit` and the `ngOnInit` method (no longer needed; config is now constructor-initialized)
    - Remove the `modelConfig` alias signal (keep `providerStatus` which maps to `modelConfigService.status`)
    - _Requirements: 1.8, 2.4, 5.6, 5.7_
  - [x] 7.2 Update `reader-shell.component.html` — remove settings section, add status line
    - Delete the entire `<section class="model-settings">` block including all its children (all inputs, toggles, mode buttons, save/refresh buttons, status-line paragraph, save-line paragraph)
    - Add `<p class="provider-status">{{ providerStatus().configured ? '🟢' : '🔴' }} {{ providerStatus().message }}</p>` at the top of `.assistant-content`, before `.query-row`
    - _Requirements: 2.8, 2.9, 2.10, 2.11, 2.12, 5.1, 5.2, 5.3, 5.4, 5.5_
  - [x] 7.3 Update `reader-shell.component.scss` — remove settings styles, add status line style
    - Remove the following SCSS blocks entirely: `.model-settings`, `.model-header`, `.advanced-toggle`, `.mode-toggle`, `.settings-actions`, `.status-line`, `.save-line`
    - Add `.provider-status { margin: 0 0 0.75rem; font-size: 0.75rem; color: var(--text-secondary); }`
    - _Requirements: 2.8_

- [ ] 8. Final checkpoint — verify the build compiles clean
  - Run `ng build --configuration development` and confirm zero TypeScript errors
  - Confirm no source file still imports `HybridModelConfig`, `ModelMode`, `BundledGemmaConfig`, `LocalModelConfig`, or references `TauriBridgeService` outside of `tauri-bridge.service.ts` itself
  - Ensure all tests pass, ask the user if questions arise.

---

## Notes

- `epubjs@0.3.93` is already in `package.json` and the `fileReplacements` entry is already present in `angular.json`, so tasks 1.5 is a verification step only.
- Tasks are ordered so every intermediate step leaves the TypeScript compiler happy: types come first (task 2), then the service that reads them (task 3), then the service that calls it (task 4), then the UI components (tasks 5–7).
- The design has no Correctness Properties section, so no property-based test sub-tasks are included. Unit tests for `ModelConfigService.deriveStatus` and the EPUB chunking path are marked optional below.
- Test sub-tasks are marked with `*` and will not be auto-implemented.

---

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "1.4", "1.5"] },
    { "id": 1, "tasks": ["2.1"] },
    { "id": 2, "tasks": ["3.1"] },
    { "id": 3, "tasks": ["4.1", "6.1"] },
    { "id": 4, "tasks": ["5.1", "5.2", "5.3", "6.2"] },
    { "id": 5, "tasks": ["6.3", "7.1"] },
    { "id": 6, "tasks": ["6.4", "7.2", "7.3"] }
  ]
}
```
