export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface RoutePoint extends GeoPoint {
  heightKm: number;
}

export interface GeocodeResult {
  displayName: string;
  lat: number;
  lng: number;
}

export interface ExportProgress {
  frame: number;
  totalFrames: number;
}

export interface ExportResult {
  blob: Blob;
  fileName: string;
  warning?: string;
}
