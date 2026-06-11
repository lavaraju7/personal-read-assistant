import { Injectable, signal } from '@angular/core';
import { LibraryDocument, SupportedDocumentFormat } from '../models/document.models';
import { TauriBridgeService } from './tauri-bridge.service';

@Injectable({
  providedIn: 'root',
})
export class LibraryService {
  readonly documents = signal<LibraryDocument[]>([]);
  readonly activeDocumentId = signal<string | null>(null);

  constructor(private readonly tauriBridge: TauriBridgeService) {}

  async loadLibrary(): Promise<void> {
    if (this.tauriBridge.isTauriRuntime()) {
      const docs = await this.tauriBridge.invoke<LibraryDocument[]>('get_library_docs');
      this.documents.set(docs);
      return;
    }

    this.documents.set([]);
  }

  addLocalFile(file: File, objectUrl: string): LibraryDocument | null {
    const extension = file.name.split('.').pop()?.toLowerCase();
    if (extension !== 'pdf' && extension !== 'epub') {
      return null;
    }

    const format = extension as SupportedDocumentFormat;
    const now = new Date().toISOString();
    const doc: LibraryDocument = {
      id: crypto.randomUUID(),
      title: file.name,
      format,
      filePath: objectUrl,
      addedAt: now,
      lastOpenedAt: now,
    };
    const existing = this.documents();
    this.documents.set([doc, ...existing]);
    this.activeDocumentId.set(doc.id);
    return doc;
  }

  setActiveDocument(docId: string): void {
    this.activeDocumentId.set(docId);
    this.documents.update((docs) =>
      docs.map((doc) =>
        doc.id === docId ? { ...doc, lastOpenedAt: new Date().toISOString() } : doc,
      ),
    );
  }

  getActiveDocument(): LibraryDocument | null {
    const id = this.activeDocumentId();
    if (!id) {
      return null;
    }
    return this.documents().find((doc) => doc.id === id) ?? null;
  }
}
