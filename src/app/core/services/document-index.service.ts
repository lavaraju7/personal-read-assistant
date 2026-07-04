import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { LibraryDocument, RetrievedPassage } from '../models/document.models';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root',
})
export class DocumentIndexService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = environment.apiUrl;

  readonly indexingState = signal<
    Record<string, 'idle' | 'indexing' | 'ready' | 'error'>
  >({});

  async indexDocument(
    document: LibraryDocument,
    sourceFile: File,
  ): Promise<void> {
    this.setState(document.id, 'indexing');
    try {
      // Indexing is handled by the backend during document upload.
      // We set the state to ready as the document has already been processed by the backend.
      this.setState(document.id, 'ready');
    } catch (error) {
      console.error('Indexing state transition failed', error);
      this.setState(document.id, 'error');
    }
  }

  hasIndex(docId: string): boolean {
    // The backend stores the indexes persistently, so any successfully loaded document has an index.
    return true;
  }

  getChunkCount(docId: string): number {
    return 0; // Not used on the client-side anymore since chunk counts are read from the document metadata.
  }

  async search(
    docId: string | null,
    query: string,
    format: 'pdf' | 'epub' | null = null,
    limit = 8,
  ): Promise<RetrievedPassage[]> {
    try {
      const results = await firstValueFrom(
        this.http.post<RetrievedPassage[]>(`${this.apiUrl}/api/query`, {
          query,
          docId,
          limit,
        })
      );
      return results || [];
    } catch (error) {
      console.error('Hybrid search failed on backend:', error);
      return [];
    }
  }

  private setState(
    docId: string,
    state: 'idle' | 'indexing' | 'ready' | 'error',
  ): void {
    this.indexingState.update((current) => ({ ...current, [docId]: state }));
  }
}
