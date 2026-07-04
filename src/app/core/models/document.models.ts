export type SupportedDocumentFormat = 'pdf' | 'epub';

export interface LibraryDocument {
  id: string;
  title: string;
  format: SupportedDocumentFormat;
  filePath: string;
  addedAt: string;
  lastOpenedAt?: string;
  chunkCount?: number;
}


export interface DocumentAnchor {
  docId: string;
  format: SupportedDocumentFormat;
  page?: number;
  cfiStart?: string;
  cfiEnd?: string;
  quote?: string;
}

export interface RetrievedPassage {
  chunkId: string;
  score: number;
  snippet: string;
  sectionPath: string[];
  anchor: DocumentAnchor;
}
