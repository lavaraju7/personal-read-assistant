import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { LibraryDocument } from '../models/document.models';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root',
})
export class LibraryService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = environment.apiUrl;

  readonly documents = signal<LibraryDocument[]>([]);
  readonly activeDocumentId = signal<string | null>(null);

  async loadLibrary(): Promise<void> {
    try {
      const docs = await firstValueFrom(
        this.http.get<LibraryDocument[]>(`${this.apiUrl}/api/documents`)
      );
      this.documents.set(docs || []);
    } catch (err) {
      console.error('Failed to load library from backend:', err);
      this.documents.set([]);
    }
  }

  async uploadDocument(file: File): Promise<LibraryDocument> {
    const formData = new FormData();
    formData.append('file', file);

    const doc = await firstValueFrom(
      this.http.post<LibraryDocument>(`${this.apiUrl}/api/documents`, formData)
    );

    const existing = this.documents();
    this.documents.set([doc, ...existing]);
    this.activeDocumentId.set(doc.id);
    return doc;
  }

  async deleteDocument(docId: string): Promise<void> {
    try {
      await firstValueFrom(
        this.http.delete(`${this.apiUrl}/api/documents/${docId}`)
      );
      this.documents.update((docs) => docs.filter((d) => d.id !== docId));
      if (this.activeDocumentId() === docId) {
        this.activeDocumentId.set(null);
      }
    } catch (err) {
      console.error(`Failed to delete document ${docId}:`, err);
      throw err;
    }
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

