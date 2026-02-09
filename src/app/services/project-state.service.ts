import { Injectable, signal } from '@angular/core';
import { GeoPoint, RoutePoint } from '../models/types';

@Injectable({ providedIn: 'root' })
export class ProjectStateService {
  readonly fromQuery = signal('');
  readonly toQuery = signal('');

  readonly fromCoord = signal<GeoPoint | null>(null);
  readonly toCoord = signal<GeoPoint | null>(null);

  readonly routePoints = signal<RoutePoint[]>([]);
  readonly durationSec = signal(8);
  readonly arcHeightKm = signal(800);

  readonly playing = signal(false);
  readonly progress = signal(0);

  setFromQuery(value: string): void {
    this.fromQuery.set(value);
  }

  setToQuery(value: string): void {
    this.toQuery.set(value);
  }

  setDurationSec(value: number): void {
    const clamped = Number.isFinite(value) ? Math.min(90, Math.max(2, value)) : 8;
    this.durationSec.set(clamped);
  }

  setArcHeightKm(value: number): void {
    const clamped = Number.isFinite(value) ? Math.min(3000, Math.max(50, value)) : 800;
    this.arcHeightKm.set(clamped);
  }

  setFromCoord(value: GeoPoint | null): void {
    this.fromCoord.set(value);
  }

  setToCoord(value: GeoPoint | null): void {
    this.toCoord.set(value);
  }

  setRoute(points: RoutePoint[]): void {
    this.routePoints.set(points);
    this.progress.set(0);
    this.playing.set(false);
  }

  setPlaying(value: boolean): void {
    this.playing.set(value);
  }

  setProgress(value: number): void {
    this.progress.set(Math.min(1, Math.max(0, value)));
  }

  resetAnimation(): void {
    this.playing.set(false);
    this.progress.set(0);
  }
}
