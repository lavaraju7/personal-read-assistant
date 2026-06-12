# Technical Design Document

## Overview

This document describes the technical changes required to refactor the Personal Reading Assistant from a three-mode LLM architecture (bundled-Gemma / cloud / local) to a cloud-only model backed by Angular environment files, and to replace the EPUB viewer stub with a real epub.js rendition with full text-extraction support for the search pipeline.

---

## Architecture Summary

```
┌─────────────────────────────────────────────────────────────┐
│  .env  (developer fills in, git-ignored)                    │
│  → manually copied into environment.ts (dev)                │
│  → replaced by environment.prod.ts at production build      │
└───────────────────────┬─────────────────────────────────────┘
                        │ imported at build time
                        ▼
              environment.ts / environment.prod.ts
                        │
                        ▼
              ModelConfigService  (constructor-init, no Tauri)
                        │  config: Signal<CloudModelConfig>
                        │  status: Signal<ProviderStatus>
                        ▼
              AssistantService  (cloud-only callCloudModel)
                        │
                ┌───────┴────────┐
                ▼                ▼
      DocumentIndexService    callCloudModel → fetch /chat/completions
         ┌──────┴──────┐
         ▼             ▼
   PDF pipeline    EPUB pipeline (new)
   (unchanged)     epub.js Book → spine iteration
                   → DOMParser text → chunking
                   → EmbeddingService batch
```

---

## 1. Data Model Changes

### 1.1 `src/app/core/models/model-config.models.ts`

**Remove entirely:**
- `type ModelMode`
- `interface BundledGemmaConfig`
- `interface LocalModelConfig`
- `interface HybridModelConfig`
- `const DEFAULT_MODEL_CONFIG`

**Keep and update:**
- `interface CloudModelConfig` — no changes to shape; remove `provider` literal type field (simplify to plain string fields)
- `interface ProviderStatus` — remove `mode: ModelMode` field; keep `configured: boolean` and `message: string`

**Final shape of `model-config.models.ts`:**
```typescript
export interface CloudModelConfig {
  apiBaseUrl: string;
  model: string;
  apiKey: string;
}

export interface ProviderStatus {
  configured: boolean;
  message: string;
}
```

### 1.2 `src/app/core/services/document-index.service.ts` — `IndexedChunk` interface

Add `cfiStart?: string` to support EPUB anchors alongside the existing `page: number` (which stays for PDF chunks, defaulting to 0 for EPUB chunks):

```typescript
interface IndexedChunk {
  id: string;
  docId: string;
  page: number;       // PDF page number; 0 for EPUB chunks
  cfiStart?: string;  // epub.js spine item cfiBase — EPUB only
  text: string;
  sectionPath: string[];
  tokens: string[];
  embedding?: number[];
}
```

---

## 2. Environment File Scaffolding

### 2.1 `src/environments/environment.ts`
```typescript
export const environment = {
  production: false,
  cloudApiBaseUrl: 'https://api.openai.com/v1',
  cloudModel: 'gpt-4.1-mini',
  cloudApiKey: '',  // fill in your key here for local dev
};
```

### 2.2 `src/environments/environment.prod.ts`
```typescript
export const environment = {
  production: true,
  cloudApiBaseUrl: '',  // set before production build
  cloudModel: '',
  cloudApiKey: '',
};
```

### 2.3 `.env` (project root — template only)
```
CLOUD_API_BASE_URL=
CLOUD_MODEL=
CLOUD_API_KEY=
```

### 2.4 `angular.json` — `fileReplacements`

Add under `projects.personal-read-assistant.architect.build.configurations.production`:
```json
"fileReplacements": [
  {
    "replace": "src/environments/environment.ts",
    "with": "src/environments/environment.prod.ts"
  }
]
```

### 2.5 `.gitignore`

Add a line `.env` (exact match, not a glob).

---

## 3. Service Layer Changes

### 3.1 `ModelConfigService`

**Remove:**
- Constructor injection of `TauriBridgeService`
- `loadConfig()`, `saveConfig()`, `refreshStatus()`, `refreshStatusFromLocalState()` methods
- All imports of `HybridModelConfig`, `DEFAULT_MODEL_CONFIG`, `TauriBridgeService`

**Replace with:**
- Constructor reads from `environment` and initializes `config` and `status` signals synchronously
- Status derivation logic: if `apiKey` empty → `{ configured: false, message: 'Missing API key' }`; if `apiBaseUrl` empty (but key present) → `{ configured: false, message: 'Missing API base URL' }`; otherwise → `{ configured: true, message: 'Cloud ready: <model>' }`

```typescript
import { Injectable, signal } from '@angular/core';
import { environment } from '../../../environments/environment';
import { CloudModelConfig, ProviderStatus } from '../models/model-config.models';

@Injectable({ providedIn: 'root' })
export class ModelConfigService {
  readonly config = signal<CloudModelConfig>({
    apiBaseUrl: environment.cloudApiBaseUrl,
    model: environment.cloudModel,
    apiKey: environment.cloudApiKey,
  });

  readonly status = signal<ProviderStatus>(this.deriveStatus({
    apiBaseUrl: environment.cloudApiBaseUrl,
    model: environment.cloudModel,
    apiKey: environment.cloudApiKey,
  }));

  private deriveStatus(cfg: CloudModelConfig): ProviderStatus {
    if (!cfg.apiKey.trim()) {
      return { configured: false, message: 'Missing API key' };
    }
    if (!cfg.apiBaseUrl.trim()) {
      return { configured: false, message: 'Missing API base URL' };
    }
    return { configured: true, message: `Cloud ready: ${cfg.model.trim()}` };
  }
}
```

### 3.2 `AssistantService`

**Remove:**
- `TauriBridgeService` constructor injection and import
- `callBundledGemma()` method
- `callLocalModel()` method
- The `if (config.mode === 'bundled-gemma')` and `if (config.mode === 'local')` branches in `generateGroundedAnswer`

**Update `generateGroundedAnswer`:**
- Read `config()` from `ModelConfigService` (now `CloudModelConfig`)
- Call `callCloudModel(query, contextSnippets, config.apiBaseUrl, config.model, config.apiKey)` directly

**Update empty-result message in `recallFromLibrary`:**
- Remove the EPUB-specific "EPUB indexing is not implemented yet" stub message; use the same generic no-match message for both formats

---

## 4. EPUB Viewer Component

### 4.1 Package dependency

Add to `package.json` dependencies:
```json
"epubjs": "0.3.93"
```

### 4.2 `EpubViewerComponent` — full rewrite

**Template (`epub-viewer.component.html`):**
```html
<div class="epub-shell">
  <div #epubContainer class="epub-container"></div>
  @if (errorMessage) {
    <div class="epub-error">{{ errorMessage }}</div>
  }
</div>
```

**Component class (`epub-viewer.component.ts`):**

```typescript
import {
  Component, ElementRef, EventEmitter, Input, OnChanges,
  OnDestroy, Output, SimpleChanges, ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import Epub, { Book, Rendition } from 'epubjs';

@Component({
  selector: 'app-epub-viewer',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './epub-viewer.component.html',
  styleUrl: './epub-viewer.component.scss',
})
export class EpubViewerComponent implements OnChanges, OnDestroy {
  @Input() sourceUrl: string | null = null;
  @Output() locationChanged = new EventEmitter<string>();
  @Output() loadingStateChanged = new EventEmitter<
    'loading' | 'loaded' | 'render-complete' | 'render-failed' | 'load-failed'
  >();

  @ViewChild('epubContainer', { static: true })
  epubContainer!: ElementRef<HTMLDivElement>;

  errorMessage = '';

  private book: Book | null = null;
  private rendition: Rendition | null = null;

  async ngOnChanges(changes: SimpleChanges): Promise<void> {
    if (!changes['sourceUrl']) return;
    await this.cleanup();
    if (this.sourceUrl) {
      await this.loadEpub(this.sourceUrl);
    }
  }

  ngOnDestroy(): void {
    void this.cleanup();
  }

  goToLocation(cfi: string): void {
    if (!cfi || !cfi.startsWith('epubcfi(')) {
      console.warn('[EpubViewer] goToLocation called with invalid CFI:', cfi);
      return;
    }
    this.rendition?.display(cfi);
  }

  private async loadEpub(url: string): Promise<void> {
    this.errorMessage = '';
    this.loadingStateChanged.emit('loading');

    const book = Epub(url) as Book;
    this.book = book;

    try {
      await book.ready;
      this.loadingStateChanged.emit('loaded');
    } catch (err) {
      this.errorMessage = `Failed to load EPUB: ${err instanceof Error ? err.message : String(err)}`;
      this.loadingStateChanged.emit('load-failed');
      return;
    }

    const rendition = book.renderTo(this.epubContainer.nativeElement, {
      width: '100%',
      height: '100%',
    });
    this.rendition = rendition;

    rendition.on('rendered', () => {
      this.loadingStateChanged.emit('render-complete');
    });

    rendition.on('relocated', (location: any) => {
      const cfi: string = location?.start?.cfi ?? '';
      if (cfi) this.locationChanged.emit(cfi);
    });

    rendition.on('loaderror', (err: any) => {
      this.loadingStateChanged.emit('render-failed');
      console.error('[EpubViewer] Render error', err);
    });

    try {
      await rendition.display();
      // Emit initial location after first display
      const location = rendition.currentLocation() as any;
      const cfi: string = location?.start?.cfi ?? '';
      if (cfi) this.locationChanged.emit(cfi);
      this.loadingStateChanged.emit('render-complete');
    } catch (err) {
      this.errorMessage = `Failed to render EPUB: ${err instanceof Error ? err.message : String(err)}`;
      this.loadingStateChanged.emit('render-failed');
    }
  }

  private async cleanup(): Promise<void> {
    try {
      this.rendition?.destroy();
    } catch { /* ignore */ }
    try {
      await this.book?.destroy();
    } catch { /* ignore */ }
    this.rendition = null;
    this.book = null;
    if (this.epubContainer?.nativeElement) {
      this.epubContainer.nativeElement.innerHTML = '';
    }
  }
}
```

**Styles (`epub-viewer.component.scss`):**
```scss
.epub-shell {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  position: relative;
}

.epub-container {
  flex: 1;
  width: 100%;
  min-height: 100px;

  iframe {
    border: none;
  }
}

.epub-error {
  padding: 1.5rem;
  color: #EF4444;
  font-size: 0.9rem;
  text-align: center;
}
```

---

## 5. EPUB Text Extraction Pipeline

### 5.1 `DocumentIndexService` — EPUB branch

The existing PDF branch remains unchanged. The EPUB branch replaces the current stub.

**Algorithm:**

1. Receive a `File` object for the EPUB.
2. Create an object URL from the file: `URL.createObjectURL(file)`.
3. Open with `Epub(objectUrl)` and `await book.ready`.
4. Build a TOC label map: iterate `book.navigation.toc` recursively to map `href` → `label`.
5. Iterate `book.spine.spineItems` (array of spine items). For each item `spineItem` (1-based index `spineIndex`):
   a. Determine `cfiBase`: `spineItem.cfiBase` (string like `epubcfi(/6/4[chapter1]!)`).
   b. Determine `sectionLabel`: look up TOC map by `spineItem.href`; fall back to `'Chapter N'`.
   c. Load the section: `await spineItem.load(book.load.bind(book))`.
   d. Extract text: `spineItem.document?.body?.innerText ?? ''` or use DOMParser on `spineItem.contents`.
   e. Normalize whitespace; skip if text is empty/whitespace-only.
   f. Apply `chunkText()` with the section label and cfiBase.
   g. Unload the section: `spineItem.unload()` to free memory.
6. Revoke the object URL.
7. If zero chunks produced → set state `'error'`.
8. Otherwise generate embeddings batch and set state `'ready'`.

**`chunkText` signature extension:**

Rename the existing `chunkPageText(docId, page, text)` to accept an optional `cfiStart` and `sectionPath`:

```typescript
private chunkText(
  docId: string,
  pageOrIndex: number,
  text: string,
  sectionPath: string[],
  cfiStart?: string,
): IndexedChunk[]
```

Chunks produced for EPUB will have `page: 0` and `cfiStart` set; chunks for PDF continue with `page: N` and no `cfiStart`.

**`search` method — anchor population:**

Update the `.map()` call at the end of `search()` to include `cfiStart` on the anchor when present:
```typescript
anchor: {
  docId: chunk.docId,
  format,
  page: format === 'pdf' ? chunk.page : undefined,
  cfiStart: chunk.cfiStart,
},
```

---

## 6. `ReaderShellComponent` Changes

### 6.1 TypeScript class

**Remove:**
- `editableModelConfig` signal
- `showAdvancedModels` signal
- `saveMessage` signal
- `updateGemmaEndpoint`, `updateGemmaModel`, `updateGemmaModelFileName`, `updateGemmaRuntimeFileName`
- `updateCloudApiBaseUrl`, `updateCloudModel`, `updateCloudApiKey`
- `updateLocalEndpoint`, `updateLocalModel`
- `saveModelConfig`, `refreshProviderStatus`, `toggleAdvancedModels`, `setModelMode`
- Import of `HybridModelConfig`, `ModelMode`
- `ngOnInit` no longer calls `modelConfigService.loadConfig()` (config is now constructor-initialized)

**Keep:**
- `isAssistantOpen`, `toggleAssistant`
- `query`, `results`, `selectedResultId`, `groundedAnswer`, `isRunningAnswer`
- `searchRecall`, `jumpToResult`
- `providerStatus` (mapped from `modelConfigService.status`)
- `documents`, `activeDocument`, `indexingState`, `isIndexing`, `isError`, `isReading`, `recentDocuments`
- `closeDocument`, `retryIndexing`, `openWithoutAi`
- `onFileSelected`, `setActive`, `onPdfPageViewed`, `onEpubLocationChanged`
- `getChunkCount`

### 6.2 Template

**Remove** the entire `<section class="model-settings">` block (all inputs, toggles, save/refresh buttons).

**Add** a minimal status line at the top of `assistant-content`:
```html
<p class="provider-status">
  {{ providerStatus().configured ? '🟢' : '🔴' }} {{ providerStatus().message }}
</p>
```

**Remove** all `updateGemma*`, `updateCloud*`, `updateLocal*`, `saveModelConfig`, `refreshProviderStatus`, `toggleAdvancedModels`, `setModelMode` bindings from the template.

### 6.3 Styles

Remove the following SCSS blocks from `reader-shell.component.scss`:
- `.model-settings`
- `.model-header`
- `.advanced-toggle`
- `.mode-toggle`
- `.settings-actions`
- `.status-line` / `.save-line`

Add `.provider-status`:
```scss
.provider-status {
  margin: 0 0 0.75rem;
  font-size: 0.75rem;
  color: var(--text-secondary);
}
```

---

## 7. TypeScript Type Declarations for epubjs

Since `epubjs` ships with bundled types, import using:
```typescript
import Epub from 'epubjs';
import type { Book, Rendition } from 'epubjs';
```

If the TS compiler cannot resolve types, add to `tsconfig.app.json`:
```json
"paths": {
  "epubjs": ["node_modules/epubjs/types/index.d.ts"]
}
```

---

## 8. File Change Summary

| File | Action |
|------|--------|
| `src/environments/environment.ts` | **Create** |
| `src/environments/environment.prod.ts` | **Create** |
| `.env` | **Create** |
| `.gitignore` | **Update** — add `.env` |
| `angular.json` | **Update** — add `fileReplacements` in production config |
| `package.json` | **Update** — add `epubjs@0.3.93` |
| `src/app/core/models/model-config.models.ts` | **Rewrite** — cloud-only types |
| `src/app/core/services/model-config.service.ts` | **Rewrite** — env-init, no Tauri |
| `src/app/core/services/assistant.service.ts` | **Update** — remove Gemma/local paths |
| `src/app/core/services/document-index.service.ts` | **Update** — add EPUB extraction branch |
| `src/app/features/epub-viewer/epub-viewer.component.ts` | **Rewrite** — full epub.js |
| `src/app/features/epub-viewer/epub-viewer.component.html` | **Rewrite** |
| `src/app/features/epub-viewer/epub-viewer.component.scss` | **Rewrite** |
| `src/app/features/reader-shell/reader-shell.component.ts` | **Update** — remove model settings |
| `src/app/features/reader-shell/reader-shell.component.html` | **Update** — remove settings UI |
| `src/app/features/reader-shell/reader-shell.component.scss` | **Update** — remove settings styles |
