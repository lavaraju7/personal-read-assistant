import { Injectable, inject, signal } from '@angular/core';
import * as pdfjsLib from 'pdfjs-dist';
import { LibraryDocument, RetrievedPassage } from '../models/document.models';
import { EmbeddingService } from './embedding.service';

(pdfjsLib as any).GlobalWorkerOptions.workerSrc =
  'https://unpkg.com/pdfjs-dist@5.7.284/build/pdf.worker.min.mjs';

interface IndexedChunk {
  id: string;
  docId: string;
  page: number;
  text: string;
  sectionPath: string[];
  tokens: string[];
  embedding?: number[];
}

@Injectable({
  providedIn: 'root',
})
export class DocumentIndexService {
  private readonly embeddingService = inject(EmbeddingService);

  readonly indexingState = signal<
    Record<string, 'idle' | 'indexing' | 'ready' | 'error'>
  >({});

  private readonly chunksByDoc = new Map<string, IndexedChunk[]>();

  async indexDocument(
    document: LibraryDocument,
    sourceFile: File,
  ): Promise<void> {
    this.setState(document.id, 'indexing');

    try {
      if (document.format === 'pdf') {
        const pdfChunks = await this.extractPdfChunks(document.id, sourceFile);

        // Generate embeddings for each chunk in a batch
        if (pdfChunks.length > 0) {
          const texts = pdfChunks.map((c) => c.text);
          const embeddings =
            await this.embeddingService.getEmbeddingsBatch(texts);
          for (let i = 0; i < pdfChunks.length; i++) {
            pdfChunks[i].embedding = embeddings[i];
          }
        }

        this.chunksByDoc.set(document.id, pdfChunks);
        this.setState(document.id, pdfChunks.length > 0 ? 'ready' : 'error');
      } else {
        this.chunksByDoc.set(document.id, []);
        this.setState(document.id, 'error');
        console.warn('EPUB indexing is not implemented yet.');
      }
    } catch (error) {
      console.error('Indexing failed', error);
      this.setState(document.id, 'error');
    }
  }

  hasIndex(docId: string): boolean {
    return (this.chunksByDoc.get(docId)?.length ?? 0) > 0;
  }

  getChunkCount(docId: string): number {
    return this.chunksByDoc.get(docId)?.length ?? 0;
  }

  async search(
    docId: string,
    query: string,
    format: 'pdf' | 'epub',
    limit = 5,
  ): Promise<RetrievedPassage[]> {
    const chunks = this.chunksByDoc.get(docId) ?? [];
    if (chunks.length === 0) {
      return [];
    }

    const queryTokens = this.tokenize(query);
    const normalizedQuery = query.toLowerCase().trim();

    let ranked: { chunk: IndexedChunk; score: number }[] = [];

    try {
      const queryEmbedding = await this.embeddingService.getEmbedding(query);

      ranked = chunks.map((chunk) => {
        const overlap = chunk.tokens.filter((token) =>
          queryTokens.some(
            (queryToken) => token === queryToken || token.startsWith(queryToken),
          ),
        ).length;
        const coverage = overlap / Math.max(queryTokens.length, 1);
        const phraseBoost = chunk.text.toLowerCase().includes(normalizedQuery)
          ? 0.5
          : 0;
        const fuzzyBoost = this.bigramDice(normalizedQuery, chunk.text.toLowerCase());
        const lexicalScore = coverage + phraseBoost + fuzzyBoost * 0.3;

        const vectorScore = this.embeddingService.cosineSimilarity(
          queryEmbedding,
          chunk.embedding ?? [],
        );
        return { chunk, score: vectorScore * 0.7 + lexicalScore * 0.3 };
      });
    } catch (error) {
      console.warn('Vector search failed, falling back to lexical search', error);
      ranked = chunks.map((chunk) => {
        const overlap = chunk.tokens.filter((token) =>
          queryTokens.some(
            (queryToken) => token === queryToken || token.startsWith(queryToken),
          ),
        ).length;
        const coverage = overlap / Math.max(queryTokens.length, 1);
        const phraseBoost = chunk.text.toLowerCase().includes(normalizedQuery) ? 0.45 : 0;
        const fuzzyBoost = this.bigramDice(normalizedQuery, chunk.text.toLowerCase());
        return { chunk, score: coverage + phraseBoost + fuzzyBoost * 0.35 };
      });
    }

    return ranked
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .filter(({ score }) => score > 0.05)
      .map(({ chunk, score }) => ({
        chunkId: chunk.id,
        score,
        snippet: chunk.text.slice(0, 300).trimEnd(),
        sectionPath: chunk.sectionPath,
        anchor: {
          docId: chunk.docId,
          format,
          page: format === 'pdf' ? chunk.page : undefined,
        },
      }));
  }

  private async extractPdfChunks(
    docId: string,
    file: File,
  ): Promise<IndexedChunk[]> {
    const data = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data }).promise;
    const allChunks: IndexedChunk[] = [];

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      const text = textContent.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (!text) {
        continue;
      }

      const pageChunks = this.chunkPageText(docId, pageNum, text);
      allChunks.push(...pageChunks);
    }

    return allChunks;
  }

  private chunkPageText(
    docId: string,
    page: number,
    text: string,
  ): IndexedChunk[] {
    const words = text.split(/\s+/);
    const chunkSize = 180;
    const overlap = 50;
    const chunks: IndexedChunk[] = [];

    for (let start = 0; start < words.length; start += chunkSize - overlap) {
      const slice = words.slice(start, start + chunkSize);
      if (slice.length < 40) {
        continue;
      }
      const chunkText = slice.join(' ');
      chunks.push({
        id: `${docId}-p${page}-c${start}`,
        docId,
        page,
        text: chunkText,
        sectionPath: [`Page ${page}`],
        tokens: this.tokenize(chunkText),
      });
    }

    if (chunks.length === 0) {
      chunks.push({
        id: `${docId}-p${page}-full`,
        docId,
        page,
        text,
        sectionPath: [`Page ${page}`],
        tokens: this.tokenize(text),
      });
    }

    return chunks;
  }

  private tokenize(text: string): string[] {
    const stopWords = new Set([
      'the',
      'a',
      'an',
      'and',
      'or',
      'to',
      'of',
      'in',
      'on',
      'is',
      'are',
      'was',
      'were',
      'for',
      'with',
      'that',
      'this',
      'it',
      'as',
      'by',
      'at',
      'from',
      'be',
      'about',
    ]);

    return text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 1 && !stopWords.has(token));
  }

  private bigramDice(left: string, right: string): number {
    const a = left.replace(/\s+/g, ' ').trim();
    const b = right.replace(/\s+/g, ' ').trim();
    if (a.length < 2 || b.length < 2) {
      return 0;
    }

    const leftBigrams = this.toBigrams(a);
    const rightBigrams = this.toBigrams(b);
    let matches = 0;
    const rightCounts = new Map<string, number>();

    for (const bg of rightBigrams) {
      rightCounts.set(bg, (rightCounts.get(bg) ?? 0) + 1);
    }

    for (const bg of leftBigrams) {
      const current = rightCounts.get(bg) ?? 0;
      if (current > 0) {
        matches += 1;
        rightCounts.set(bg, current - 1);
      }
    }

    return (2 * matches) / (leftBigrams.length + rightBigrams.length);
  }

  private toBigrams(text: string): string[] {
    const output: string[] = [];
    for (let i = 0; i < text.length - 1; i++) {
      output.push(text.slice(i, i + 2));
    }
    return output;
  }

  private setState(
    docId: string,
    state: 'idle' | 'indexing' | 'ready' | 'error',
  ): void {
    this.indexingState.update((current) => ({ ...current, [docId]: state }));
  }
}
