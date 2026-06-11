export interface ReadingEvent {
  id: string;
  docId: string;
  type: 'page_view' | 'section_view' | 'selection' | 'jump';
  value: string;
  createdAt: string;
}

export interface ReaderSelection {
  text: string;
  page?: number;
  cfi?: string;
}

export interface RecallRequest {
  query: string;
  currentDocId?: string;
}
