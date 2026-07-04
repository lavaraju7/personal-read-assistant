import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { RetrievedPassage } from '../models/document.models';
import { RecallRequest } from '../models/reader.models';
import { DocumentIndexService } from './document-index.service';
import { LibraryService } from './library.service';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root',
})
export class AssistantService {
  private readonly http = inject(HttpClient);
  private readonly libraryService = inject(LibraryService);
  private readonly documentIndexService = inject(DocumentIndexService);
  private readonly apiUrl = environment.apiUrl;

  async recallFromLibrary(request: RecallRequest, searchScope: 'active' | 'library' = 'library'): Promise<RetrievedPassage[]> {
    const activeDoc = this.libraryService.getActiveDocument();
    
    // Determine the docId filter
    // If scope is 'active' and there is an active document, restrict search to it.
    // Otherwise, search across the entire library (docId = null).
    const docId = searchScope === 'active' && activeDoc ? activeDoc.id : null;
    
    const query = request.query.trim();
    if (!query) {
      return [];
    }

    try {
      // Search via index service which routes to backend hybrid query
      return await this.documentIndexService.search(docId, query, null, 8);
    } catch (err) {
      console.error('Recall search failed:', err);
      return [];
    }
  }

  async generateGroundedAnswer(query: string, passages: RetrievedPassage[]): Promise<string> {
    if (!passages || passages.length === 0) {
      return 'No retrieved context available to answer this question. Please upload and index documents first.';
    }

    try {
      const response = await firstValueFrom(
        this.http.post<{ answer: string }>(`${this.apiUrl}/api/generate`, {
          query,
          passages,
        })
      );
      return response?.answer || 'No response returned from the model.';
    } catch (err: any) {
      console.error('Failed to generate answer:', err);
      const errorMsg = err?.error?.detail || err?.message || 'Unknown server error';
      return `Assistant error: ${errorMsg}`;
    }
  }
}
