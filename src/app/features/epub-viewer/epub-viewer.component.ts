import {
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import Epub, { Book, Rendition } from 'epubjs';

@Component({
  selector: 'app-epub-viewer',
  standalone: true,
  imports: [],
  templateUrl: './epub-viewer.component.html',
  styleUrl: './epub-viewer.component.scss',
})
export class EpubViewerComponent implements OnChanges, OnDestroy {
  @Input() sourceUrl: string | null = null;
  @Output() locationChanged = new EventEmitter<string>();
  @Output() loadingStateChanged = new EventEmitter<
    'loading' | 'loaded' | 'render-complete' | 'render-failed' | 'load-failed'
  >();

  @ViewChild('epubContainer', { static: true })
  epubContainer!: ElementRef<HTMLDivElement>;

  private book: Book | null = null;
  private rendition: Rendition | null = null;

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['sourceUrl']) {
      return;
    }
    this.destroyEpub();
    if (this.sourceUrl) {
      this.loadEpub(this.sourceUrl);
    }
  }

  ngOnDestroy(): void {
    this.destroyEpub();
  }

  goToLocation(cfi: string): void {
    if (!cfi || !cfi.startsWith('epubcfi(')) {
      console.warn('EpubViewerComponent: invalid CFI string, navigation skipped:', cfi);
      return;
    }
    this.rendition?.display(cfi);
  }

  private async loadEpub(url: string): Promise<void> {
    this.loadingStateChanged.emit('loading');

    let book: Book;
    try {
      book = Epub(url);
      this.book = book;
      await (book as any).ready;
      this.loadingStateChanged.emit('loaded');
    } catch (error) {
      this.loadingStateChanged.emit('load-failed');
      if (this.epubContainer?.nativeElement) {
        this.epubContainer.nativeElement.innerText =
          `Failed to load EPUB: ${error instanceof Error ? error.message : String(error)}`;
      }
      return;
    }

    try {
      const container = this.epubContainer.nativeElement;
      const rendition = book.renderTo(container, {
        width: '100%',
        height: '100%',
      });
      this.rendition = rendition;

      rendition.on('relocated', (location: any) => {
        const cfi = location?.start?.cfi;
        if (cfi) {
          this.locationChanged.emit(cfi);
        }
      });

      rendition.on('renderError', () => {
        this.loadingStateChanged.emit('render-failed');
      });

      await rendition.display();
      this.loadingStateChanged.emit('render-complete');

      const currentLocation = rendition.currentLocation() as any;
      const cfi = currentLocation?.start?.cfi;
      if (cfi) {
        this.locationChanged.emit(cfi);
      }
    } catch (error) {
      this.loadingStateChanged.emit('render-failed');
    }
  }

  private destroyEpub(): void {
    try {
      this.rendition?.destroy();
    } catch {
      /* swallow */
    }
    try {
      this.book?.destroy();
    } catch {
      /* swallow */
    }
    this.rendition = null;
    this.book = null;
    if (this.epubContainer?.nativeElement) {
      this.epubContainer.nativeElement.innerHTML = '';
    }
  }
}
