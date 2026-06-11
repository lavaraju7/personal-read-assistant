import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EpubViewerComponent } from './epub-viewer.component';

describe('EpubViewerComponent', () => {
  let component: EpubViewerComponent;
  let fixture: ComponentFixture<EpubViewerComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EpubViewerComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(EpubViewerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
