import {
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import * as pdfjsLib from 'pdfjs-dist';

(pdfjsLib as any).GlobalWorkerOptions.workerSrc =
  'https://unpkg.com/pdfjs-dist@5.7.284/build/pdf.worker.min.mjs';

@Component({
  selector: 'app-pdf-viewer',
  templateUrl: './pdf-viewer.component.html',
  styleUrls: ['./pdf-viewer.component.scss'],
  standalone: true,
})
export class PdfViewerComponent implements OnChanges {
  @Input() sourceUrl: string | null = null;
  @Output() pageViewed = new EventEmitter<number>();

  @ViewChild('pdfContainer', { static: true })
  pdfContainer!: ElementRef<HTMLDivElement>;

  private readonly scale = 1.3;

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['sourceUrl']) {
      return;
    }
    if (!this.sourceUrl) {
      this.pdfContainer.nativeElement.innerHTML = '';
      return;
    }
    this.renderPdfFromUrl(this.sourceUrl);
  }

  async renderPdfFromUrl(url: string): Promise<void> {
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    await this.renderPdf(arrayBuffer);
  }

  async goToPage(page: number): Promise<void> {
    const pageElement = this.pdfContainer.nativeElement.querySelector(
      `[data-page-number="${page}"]`,
    );
    if (pageElement) {
      pageElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
      this.pageViewed.emit(page);
    }
  }

  private async renderPdf(data: ArrayBuffer): Promise<void> {
    this.pdfContainer.nativeElement.innerHTML = '';

    const loadingTask = pdfjsLib.getDocument({ data });
    const pdf = await loadingTask.promise;

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);

      const viewport = page.getViewport({ scale: this.scale });
      const pageHost = document.createElement('section');
      pageHost.className = 'pdf-page';
      pageHost.dataset['pageNumber'] = String(pageNum);

      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d')!;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      pageHost.appendChild(canvas);
      this.pdfContainer.nativeElement.appendChild(pageHost);

      await page
        .render({
          canvas,
          canvasContext: context,
          viewport,
        })
        .promise;
      this.pageViewed.emit(pageNum);
      await page.getTextContent();
    }
  }
}
