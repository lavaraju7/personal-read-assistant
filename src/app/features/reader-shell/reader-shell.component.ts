import { CommonModule } from '@angular/common';
import { Component, ViewChild, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LibraryDocument, RetrievedPassage } from '../../core/models/document.models';
import { AssistantService } from '../../core/services/assistant.service';
import { DocumentIndexService } from '../../core/services/document-index.service';
import { LibraryService } from '../../core/services/library.service';
import { ModelConfigService } from '../../core/services/model-config.service';
import { ReaderMemoryService } from '../../core/services/reader-memory.service';
import { EpubViewerComponent } from '../epub-viewer/epub-viewer.component';
import { PdfViewerComponent } from '../pdf-viewer/pdf-viewer.component';

@Component({
  selector: 'app-reader-shell',
  standalone: true,
  imports: [CommonModule, FormsModule, PdfViewerComponent, EpubViewerComponent],
  templateUrl: './reader-shell.component.html',
  styleUrl: './reader-shell.component.scss',
})
export class ReaderShellComponent {
  @ViewChild(PdfViewerComponent) pdfViewer?: PdfViewerComponent;
  @ViewChild(EpubViewerComponent) epubViewer?: EpubViewerComponent;

  private readonly libraryService = inject(LibraryService);
  private readonly assistantService = inject(AssistantService);
  private readonly documentIndexService = inject(DocumentIndexService);
  private readonly modelConfigService = inject(ModelConfigService);
  private readonly memoryService = inject(ReaderMemoryService);

  readonly query = signal('');
  readonly results = signal<RetrievedPassage[]>([]);
  readonly selectedResultId = signal<string | null>(null);
  readonly groundedAnswer = signal('');
  readonly isRunningAnswer = signal(false);
  readonly isAssistantOpen = signal(false);
  readonly searchScope = signal<'active' | 'library'>('library');

  readonly documents = this.libraryService.documents;
  readonly activeDocument = computed(() => this.libraryService.getActiveDocument());
  readonly providerStatus = this.modelConfigService.status;
  readonly indexingState = this.documentIndexService.indexingState;

  readonly isIndexing = computed(() => {
    const active = this.activeDocument();
    return active ? this.indexingState()[active.id] === 'indexing' : false;
  });

  readonly isError = computed(() => {
    const active = this.activeDocument();
    return active ? this.indexingState()[active.id] === 'error' : false;
  });

  readonly isReading = computed(() => {
    const active = this.activeDocument();
    if (!active) {
      return false;
    }
    const state = this.indexingState()[active.id];
    return state === 'ready' || state === 'idle' || !state;
  });

  readonly recentDocuments = computed(() => {
    return [...this.documents()].sort((a, b) => {
      const aTime = new Date(a.lastOpenedAt || a.addedAt).getTime();
      const bTime = new Date(b.lastOpenedAt || b.addedAt).getTime();
      return bTime - aTime;
    });
  });

  ngOnInit() {
    this.libraryService.loadLibrary();
  }

  closeDocument(): void {
    this.libraryService.activeDocumentId.set(null);
    this.isAssistantOpen.set(false);
  }

  toggleAssistant(): void {
    this.isAssistantOpen.update((open) => !open);
  }

  async retryIndexing(): Promise<void> {
    // Retrying is handled by re-uploading or reloading
    const active = this.activeDocument();
    if (active) {
      this.documentIndexService.indexingState.update((current) => ({
        ...current,
        [active.id]: 'ready',
      }));
    }
  }

  openWithoutAi(): void {
    const doc = this.activeDocument();
    if (doc) {
      this.documentIndexService.indexingState.update((current) => ({
        ...current,
        [doc.id]: 'ready',
      }));
    }
  }

  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.item(0);
    if (!file) {
      return;
    }
    
    const tempId = 'indexing-' + Date.now();
    this.documentIndexService.indexingState.update((current) => ({
      ...current,
      [tempId]: 'indexing',
    }));
    this.libraryService.activeDocumentId.set(tempId);

    try {
      const document = await this.libraryService.uploadDocument(file);
      this.documentIndexService.indexingState.update((current) => ({
        ...current,
        [document.id]: 'ready',
      }));
      this.libraryService.activeDocumentId.set(document.id);
    } catch (err) {
      console.error('Failed to upload and index document:', err);
      this.documentIndexService.indexingState.update((current) => ({
        ...current,
        [tempId]: 'error',
      }));
    }
    input.value = '';
  }

  async setActive(docId: string): Promise<void> {
    this.libraryService.setActiveDocument(docId);
    const doc = this.activeDocument();
    if (doc) {
      this.documentIndexService.indexingState.update((current) => ({
        ...current,
        [doc.id]: 'ready',
      }));
    }
  }

  async deleteDoc(event: Event, docId: string): Promise<void> {
    event.stopPropagation(); // Prevent opening the doc when clicking delete
    if (confirm('Are you sure you want to delete this document and its semantic index?')) {
      try {
        await this.libraryService.deleteDocument(docId);
      } catch (err) {
        alert('Failed to delete document');
      }
    }
  }

  async searchRecall(): Promise<void> {
    const query = this.query().trim();
    if (!query) {
      this.results.set([]);
      this.groundedAnswer.set('');
      return;
    }

    const activeDocument = this.activeDocument();
    const items = await this.assistantService.recallFromLibrary(
      {
        query,
        currentDocId: activeDocument?.id,
      },
      this.searchScope()
    );

    this.results.set(items);
    this.isRunningAnswer.set(true);
    this.groundedAnswer.set('');
    
    if (items.length > 0) {
      this.groundedAnswer.set(await this.assistantService.generateGroundedAnswer(query, items));
    } else {
      this.groundedAnswer.set('No context matches found in the search scope.');
    }
    this.isRunningAnswer.set(false);
  }

  async jumpToResult(result: RetrievedPassage): Promise<void> {
    this.selectedResultId.set(result.chunkId);

    // If the search result belongs to another document, open that book first!
    if (!this.activeDocument() || this.activeDocument()?.id !== result.anchor.docId) {
      await this.setActive(result.anchor.docId);
      // Wait slightly for the rendering engine to render the viewer
      await new Promise((resolve) => setTimeout(resolve, 350));
    }

    if (result.anchor.format === 'pdf' && result.anchor.page) {
      this.pdfViewer?.goToPage(result.anchor.page);
      this.memoryService.trackEvent({
        docId: result.anchor.docId,
        type: 'jump',
        value: `page:${result.anchor.page}`,
      });
      return;
    }

    if (result.anchor.format === 'epub' && result.anchor.cfiStart) {
      this.epubViewer?.goToLocation(result.anchor.cfiStart);
      this.memoryService.trackEvent({
        docId: result.anchor.docId,
        type: 'jump',
        value: `cfi:${result.anchor.cfiStart}`,
      });
    }
  }

  onPdfPageViewed(page: number): void {
    const activeDocument = this.activeDocument();
    if (!activeDocument) {
      return;
    }
    this.memoryService.trackEvent({
      docId: activeDocument.id,
      type: 'page_view',
      value: `page:${page}`,
    });
  }

  onEpubLocationChanged(cfi: string): void {
    const activeDocument = this.activeDocument();
    if (!activeDocument) {
      return;
    }
    this.memoryService.trackEvent({
      docId: activeDocument.id,
      type: 'section_view',
      value: cfi,
    });
  }

  getChunkCount(doc: LibraryDocument): number {
    return doc.chunkCount || 0;
  }
}

