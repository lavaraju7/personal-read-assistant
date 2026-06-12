import { Injectable } from '@angular/core';
import { RetrievedPassage } from '../models/document.models';
import { RecallRequest } from '../models/reader.models';
import { DocumentIndexService } from './document-index.service';
import { LibraryService } from './library.service';
import { ModelConfigService } from './model-config.service';

@Injectable({
  providedIn: 'root',
})
export class AssistantService {
  constructor(
    private readonly libraryService: LibraryService,
    private readonly documentIndexService: DocumentIndexService,
    private readonly modelConfigService: ModelConfigService,
  ) {}

  async recallFromLibrary(request: RecallRequest): Promise<RetrievedPassage[]> {
    const activeDocument = this.libraryService.getActiveDocument();
    if (!activeDocument) {
      return [];
    }

    const normalizedQuery = request.query.trim().toLowerCase();
    if (!normalizedQuery) {
      return [];
    }

    // Primary search — use a larger limit for broad story questions
    const isBroad = this.isBroadStoryQuestion(normalizedQuery);
    const primaryHits = await this.documentIndexService.search(
      activeDocument.id,
      normalizedQuery,
      activeDocument.format,
      isBroad ? 8 : 6,
    );

    // Query expansion: for identity/definition questions, run a second pass
    // with a descriptive reformulation to find characterizing passages.
    const expandedQuery = this.expandQuery(normalizedQuery);
    let secondaryHits: RetrievedPassage[] = [];
    if (expandedQuery && expandedQuery !== normalizedQuery) {
      secondaryHits = await this.documentIndexService.search(
        activeDocument.id,
        expandedQuery,
        activeDocument.format,
        4,
      );
    }

    // Merge and deduplicate by chunkId, keeping the highest score per chunk
    const merged = new Map<string, RetrievedPassage>();
    for (const hit of [...primaryHits, ...secondaryHits]) {
      const existing = merged.get(hit.chunkId);
      if (!existing || hit.score > existing.score) {
        merged.set(hit.chunkId, hit);
      }
    }

    const hits = [...merged.values()].sort((a, b) => b.score - a.score).slice(0, 8);

    if (hits.length === 0) {
      return [
        {
          chunkId: crypto.randomUUID(),
          score: 0,
          snippet:
            activeDocument.format === 'epub'
              ? 'This EPUB is imported, but EPUB indexing is not implemented yet in the current build.'
              : 'No strong text match found yet. Try a more specific phrase or re-import to rebuild index.',
          sectionPath: ['Retrieval'],
          anchor: {
            docId: activeDocument.id,
            format: activeDocument.format,
            page: activeDocument.format === 'pdf' ? 1 : undefined,
          },
        },
      ];
    }

    return hits;
  }

  /**
   * Expands a query for better retrieval on identity/definition questions.
   * "who is X?" → "X is a character person description"
   * "what is X?" → "X description meaning definition"
   */
  private expandQuery(query: string): string | null {
    // Match "who is <name>?" or "who is <name>"
    const whoIs = query.match(/^who\s+is\s+(.+?)[\?]?$/i);
    if (whoIs) {
      const subject = whoIs[1].trim();
      return `${subject} is a character person role works`;
    }

    // Match "what is <term>?"
    const whatIs = query.match(/^what\s+is\s+(.+?)[\?]?$/i);
    if (whatIs) {
      const subject = whatIs[1].trim();
      return `${subject} definition meaning description`;
    }

    // Match "describe <subject>"
    const describe = query.match(/^describe\s+(.+?)[\?]?$/i);
    if (describe) {
      return describe[1].trim();
    }

    // Match "how many <things>" or "count <things>" or "list all <things>"
    const howMany = query.match(/^how\s+many\s+(.+?)(?:\s+(?:are|is|were|in|present|the).*)?[\?]?$/i);
    if (howMany) {
      const subject = howMany[1].trim();
      return `${subject} characters people names mentioned`;
    }
    const listAll = query.match(/^(?:list|name|enumerate)\s+(?:all\s+)?(.+?)[\?]?$/i);
    if (listAll) {
      return `${listAll[1].trim()} characters names mentioned`;
    }

    return null;
  }

  /** Returns true for whole-story aggregation questions that need broader retrieval. */
  private isBroadStoryQuestion(query: string): boolean {
    return /\b(how many|total|all|every|entire story|throughout|list all|count)\b/i.test(query);
  }

  /** Returns true for questions that ask for a count/number across the story. */
  private isCountingQuestion(query: string): boolean {
    return /\b(how many|how much|total number|number of|count(ing)?\s+(?:all|the|characters|people|humans))\b/i.test(query);
  }

  /**
   * Extracts likely proper names from retrieved snippets using a heuristic:
   * capitalized words that appear in the middle of text (not sentence starts).
   */
  private extractMentionedNames(snippets: string[]): string[] {
    // Common words to exclude even if capitalized
    const exclude = new Set([
      'The','A','An','In','On','At','But','And','Or','For','With','From',
      'His','Her','Their','He','She','They','It','This','That','These','Those',
      'Mr','Mrs','Ms','Dr','As','By','To','Of','Not','No','So','If','Up',
      'One','Two','All','Now','Was','Had','Has','Did','Do','Be','Is','Are',
    ]);
    const found = new Set<string>();

    for (const snippet of snippets) {
      const words = snippet.split(/\s+/);
      for (let i = 1; i < words.length; i++) { // start at 1 to skip sentence-start caps
        const clean = words[i].replace(/[^a-zA-Z'-]/g, '');
        if (clean.length < 2 || !/^[A-Z]/.test(clean) || exclude.has(clean)) continue;

        // Check if it's a two-word name
        if (i + 1 < words.length) {
          const next = words[i + 1].replace(/[^a-zA-Z'-]/g, '');
          if (next.length > 1 && /^[A-Z]/.test(next) && !exclude.has(next)) {
            found.add(`${clean} ${next}`);
            continue;
          }
        }
        found.add(clean);
      }
    }

    return [...found].slice(0, 15);
  }

  async generateGroundedAnswer(query: string, passages: RetrievedPassage[]): Promise<string> {
    const contextSnippets = passages.map((passage) => passage.snippet);

    if (contextSnippets.length === 0) {
      return 'No retrieved context available yet. Import and index content first.';
    }

    if (this.isCountingQuestion(query)) {
      const names = this.extractMentionedNames(contextSnippets);
      const nameList = names.length > 0 ? names.join(', ') : 'no names clearly identified';
      return (
        `⚠️ Counting questions require reading the full document, but only ` +
        `${contextSnippets.length} passage${contextSnippets.length !== 1 ? 's were' : ' was'} retrieved — not the complete text.\n\n` +
        `Based on the retrieved passages, the following individuals are explicitly mentioned: **${nameList}**.\n\n` +
        `For an accurate total count, please refer to the full text of the document.`
      );
    }

    try {
      const { apiBaseUrl, model, apiKey } = this.modelConfigService.config();
      return await this.callCloudModel(query, contextSnippets, apiBaseUrl, model, apiKey);
    } catch (error) {
      const message = this.formatAssistantError(error);
      return `Assistant error: ${message}`;
    }
  }

  private formatAssistantError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    if (typeof error === 'string') {
      return error;
    }
    try {
      return JSON.stringify(error);
    } catch {
      return 'Unknown model routing error';
    }
  }

  private async callCloudModel(
    query: string,
    contextSnippets: string[],
    apiBaseUrl: string,
    model: string,
    apiKey: string,
  ): Promise<string> {
    if (!apiKey.trim()) {
      throw new Error('Cloud mode requires an API key.');
    }

    const response = await fetch(`${apiBaseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: 'You are a reading assistant. Using ONLY the provided context passages, write a complete sentence answer. Only state facts DIRECTLY AND EXPLICITLY written in the passages. Do NOT infer, guess, or assume any relationships or details not literally present in the text. If the answer is not directly in the passages, say: Not found in the provided passages.',
          },
          {
            role: 'user',
            content: `User query:\n${query}\n\nLibrary passages:\n${contextSnippets
              .map((snippet, idx) => `Passage ${idx + 1}:\n${snippet}`)
              .join('\n\n')}`,
          },
        ],
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Cloud provider error ${response.status}: ${errorBody}`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string;
        };
      }>;
    };

    return (
      payload.choices?.[0]?.message?.content?.trim() ??
      'Cloud response parsed, but no text content returned.'
    );
  }
}
