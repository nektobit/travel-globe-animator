import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, catchError, map, of, throwError } from 'rxjs';
import { GeocodeResult } from '../models/types';

interface NominatimItem {
  display_name: string;
  lat: string;
  lon: string;
}

@Injectable({ providedIn: 'root' })
export class GeocodingService {
  private readonly cache = new Map<string, GeocodeResult[]>();

  constructor(private readonly http: HttpClient) {}

  searchCities(rawQuery: string): Observable<GeocodeResult[]> {
    const query = rawQuery.trim();
    if (query.length < 2) {
      return of([]);
    }

    const key = query.toLowerCase();
    const cached = this.cache.get(key);
    if (cached) {
      return of(cached);
    }

    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(query)}`;

    return this.http.get<NominatimItem[]>(url).pipe(
      map((items) =>
        items.map((item) => ({
          displayName: item.display_name,
          lat: Number(item.lat),
          lng: Number(item.lon)
        }))
      ),
      map((items) => items.filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lng))),
      map((items) => {
        this.cache.set(key, items);
        return items;
      }),
      catchError((error) => throwError(() => new Error(this.toFriendlyError(error))))
    );
  }

  private toFriendlyError(error: unknown): string {
    const status = typeof error === 'object' && error && 'status' in error ? Number((error as { status: number }).status) : 0;
    if (status === 429) {
      return 'Nominatim временно ограничил запросы. Подождите 20–60 секунд или введите координаты вручную.';
    }

    return 'Не удалось получить подсказки городов. Проверьте интернет или используйте ручной ввод координат.';
  }
}
