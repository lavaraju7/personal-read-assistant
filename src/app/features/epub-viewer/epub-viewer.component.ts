import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-epub-viewer',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './epub-viewer.component.html',
  styleUrl: './epub-viewer.component.scss',
})
export class EpubViewerComponent implements OnChanges {
  @Input() sourceUrl: string | null = null;
  @Output() locationChanged = new EventEmitter<string>();

  bookTitle = 'No EPUB selected';
  previewText = '';

  async ngOnChanges(changes: SimpleChanges): Promise<void> {
    if (!changes['sourceUrl']) {
      return;
    }
    if (!this.sourceUrl) {
      this.bookTitle = 'No EPUB selected';
      this.previewText = '';
      return;
    }
    await this.loadPreview(this.sourceUrl);
  }

  goToLocation(location: string): void {
    this.locationChanged.emit(location);
  }

  private async loadPreview(url: string): Promise<void> {
    this.bookTitle = this.parseFileName(url);
    this.previewText =
      'EPUB rendering engine bootstrap is ready. Next step is binding EPUB.js rendition and CFI navigation.';
    this.locationChanged.emit('epubcfi(/6/2[bootstrap]!/4/1:0)');
  }

  private parseFileName(url: string): string {
    try {
      const parsedUrl = new URL(url);
      const tokens = parsedUrl.pathname.split('/');
      return tokens[tokens.length - 1] || 'Untitled EPUB';
    } catch {
      return 'Untitled EPUB';
    }
  }
}
