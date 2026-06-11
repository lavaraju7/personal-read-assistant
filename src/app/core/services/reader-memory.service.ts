import { Injectable, signal } from '@angular/core';
import { ReadingEvent } from '../models/reader.models';

@Injectable({
  providedIn: 'root',
})
export class ReaderMemoryService {
  readonly events = signal<ReadingEvent[]>([]);

  trackEvent(event: Omit<ReadingEvent, 'id' | 'createdAt'>): void {
    const trackedEvent: ReadingEvent = {
      ...event,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };
    this.events.update((current) => [trackedEvent, ...current].slice(0, 2000));
  }

  getRecentEventsByDoc(docId: string, limit = 20): ReadingEvent[] {
    return this.events()
      .filter((event) => event.docId === docId)
      .slice(0, limit);
  }
}
