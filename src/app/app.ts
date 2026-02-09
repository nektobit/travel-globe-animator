import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ViewChild,
  inject,
  signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { catchError, debounceTime, distinctUntilChanged, of, switchMap, tap } from 'rxjs';
import { GeoPoint, GeocodeResult } from './models/types';
import { GlobeViewComponent } from './globe-view/globe-view.component';
import { ExportService } from './services/export.service';
import { GeocodingService } from './services/geocoding.service';
import { ProjectStateService } from './services/project-state.service';
import { buildGreatCircleArc } from './utils/route-math';

@Component({
  selector: 'app-root',
  imports: [CommonModule, ReactiveFormsModule, GlobeViewComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class App {
  @ViewChild(GlobeViewComponent)
  private globe?: GlobeViewComponent;

  readonly fromControl = new FormControl('', { nonNullable: true });
  readonly toControl = new FormControl('', { nonNullable: true });

  readonly fromSuggestions = signal<GeocodeResult[]>([]);
  readonly toSuggestions = signal<GeocodeResult[]>([]);

  readonly showAdvanced = signal(false);
  readonly nominatimMessage = signal('');
  readonly statusMessage = signal('');

  readonly manualFromLat = signal('');
  readonly manualFromLng = signal('');
  readonly manualToLat = signal('');
  readonly manualToLng = signal('');

  readonly exporting = signal(false);
  readonly exportWarning = signal('');
  readonly exportProgressLabel = signal('');

  readonly state = inject(ProjectStateService);

  private readonly geocoding = inject(GeocodingService);
  private readonly exportService = inject(ExportService);
  private readonly destroyRef = inject(DestroyRef);

  private rafId: number | null = null;
  private animationStartMs = 0;
  private baseProgress = 0;

  constructor() {
    this.connectAutocomplete(this.fromControl, this.fromSuggestions, (query) => this.state.setFromQuery(query), () =>
      this.state.setFromCoord(null)
    );

    this.connectAutocomplete(this.toControl, this.toSuggestions, (query) => this.state.setToQuery(query), () =>
      this.state.setToCoord(null)
    );
  }

  onDurationInput(value: number): void {
    this.state.setDurationSec(value);
  }

  onArcHeightInput(value: number): void {
    this.state.setArcHeightKm(value);
  }

  selectFromCity(item: GeocodeResult): void {
    this.state.setFromCoord({ lat: item.lat, lng: item.lng });
    this.state.setFromQuery(item.displayName);
    this.fromControl.setValue(item.displayName, { emitEvent: false });
    this.fromSuggestions.set([]);
  }

  selectToCity(item: GeocodeResult): void {
    this.state.setToCoord({ lat: item.lat, lng: item.lng });
    this.state.setToQuery(item.displayName);
    this.toControl.setValue(item.displayName, { emitEvent: false });
    this.toSuggestions.set([]);
  }

  buildRoute(): void {
    const from = this.state.fromCoord() ?? this.parseManual(this.manualFromLat(), this.manualFromLng());
    const to = this.state.toCoord() ?? this.parseManual(this.manualToLat(), this.manualToLng());

    if (!from || !to) {
      this.statusMessage.set('Укажите города из подсказок или введите обе пары координат в Advanced.');
      return;
    }

    this.state.setFromCoord(from);
    this.state.setToCoord(to);

    const routePoints = buildGreatCircleArc(from, to, this.state.arcHeightKm(), 200);
    this.state.setRoute(routePoints);
    this.globe?.setRoute(routePoints);
    this.globe?.fitToRoute();

    this.stopAnimation();
    this.statusMessage.set(`Маршрут построен: ${routePoints.length} точек дуги.`);
  }

  play(): void {
    if (!this.state.routePoints().length || this.exporting()) {
      return;
    }

    if (this.state.progress() >= 1) {
      this.state.setProgress(0);
      this.globe?.setProgress(0);
    }

    if (this.state.playing()) {
      return;
    }

    this.state.setPlaying(true);
    this.baseProgress = this.state.progress();
    this.animationStartMs = performance.now();

    const tick = (now: number) => {
      if (!this.state.playing()) {
        return;
      }

      const elapsedSec = (now - this.animationStartMs) / 1000;
      const nextProgress = this.baseProgress + elapsedSec / this.state.durationSec();

      if (nextProgress >= 1) {
        this.state.setProgress(1);
        this.globe?.setProgress(1);
        this.globe?.renderFrame();
        this.state.setPlaying(false);
        this.rafId = null;
        return;
      }

      this.state.setProgress(nextProgress);
      this.globe?.setProgress(nextProgress);
      this.globe?.renderFrame();
      this.rafId = requestAnimationFrame(tick);
    };

    this.rafId = requestAnimationFrame(tick);
  }

  pause(): void {
    this.stopAnimation();
  }

  reset(): void {
    this.stopAnimation();
    this.state.resetAnimation();
    this.globe?.setProgress(0);
  }

  fitToRoute(): void {
    this.globe?.fitToRoute();
  }

  async export4k(): Promise<void> {
    if (!this.globe || !this.state.routePoints().length || this.exporting()) {
      return;
    }

    this.stopAnimation();
    this.exporting.set(true);
    this.exportWarning.set('');
    this.statusMessage.set('Запущен оффлайн рендер 4K. Закройте тяжёлые вкладки для стабильности.');

    try {
      const result = await this.exportService.export4kVideo(this.globe, this.state.durationSec(), (progress) => {
        this.exportProgressLabel.set(
          `Кадр ${progress.frame} / ${progress.totalFrames} (${Math.round((progress.frame / progress.totalFrames) * 100)}%)`
        );
      });

      if (result.warning) {
        this.exportWarning.set(result.warning);
      }

      this.downloadBlob(result.blob, result.fileName);
      this.statusMessage.set('Экспорт завершён. Файл скачан.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Экспорт завершился с ошибкой.';
      this.statusMessage.set(message);
    } finally {
      this.exporting.set(false);
      this.exportProgressLabel.set('');
      this.reset();
    }
  }

  private connectAutocomplete(
    control: FormControl<string>,
    output: { set(value: GeocodeResult[]): void },
    setQuery: (value: string) => void,
    onManualEdit: () => void
  ): void {
    control.valueChanges
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        tap((value) => {
          setQuery(value);
          onManualEdit();
        }),
        debounceTime(400),
        distinctUntilChanged(),
        switchMap((value) =>
          this.geocoding.searchCities(value).pipe(
            catchError((error) => {
              const message = error instanceof Error ? error.message : 'Ошибка геокодинга.';
              this.nominatimMessage.set(message);
              return of([] as GeocodeResult[]);
            })
          )
        )
      )
      .subscribe((items) => {
        output.set(items);
        if (items.length > 0) {
          this.nominatimMessage.set('');
        }
      });
  }

  private parseManual(latText: string, lngText: string): GeoPoint | null {
    const lat = Number(latText);
    const lng = Number(lngText);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return null;
    }

    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return null;
    }

    return { lat, lng };
  }

  private stopAnimation(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.state.setPlaying(false);
  }

  private downloadBlob(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  }
}
