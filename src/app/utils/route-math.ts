import { GeoPoint, RoutePoint } from '../models/types';

const EARTH_RADIUS_KM = 6371;

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export function buildGreatCircleArc(
  from: GeoPoint,
  to: GeoPoint,
  arcHeightKm = 800,
  steps = 200
): RoutePoint[] {
  const a = latLngToUnit(from.lat, from.lng);
  const b = latLngToUnit(to.lat, to.lng);
  const dot = clamp(a.x * b.x + a.y * b.y + a.z * b.z, -1, 1);
  const omega = Math.acos(dot);
  const sinOmega = Math.sin(omega);

  const points: RoutePoint[] = [];

  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;

    let v: Vec3;
    if (sinOmega < 1e-6) {
      v = normalize({
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        z: a.z + (b.z - a.z) * t
      });
    } else {
      const s0 = Math.sin((1 - t) * omega) / sinOmega;
      const s1 = Math.sin(t * omega) / sinOmega;
      v = {
        x: s0 * a.x + s1 * b.x,
        y: s0 * a.y + s1 * b.y,
        z: s0 * a.z + s1 * b.z
      };
    }

    const lat = Math.asin(v.z) * (180 / Math.PI);
    const lng = Math.atan2(v.y, v.x) * (180 / Math.PI);
    const heightKm = Math.sin(Math.PI * t) * arcHeightKm;

    points.push({ lat, lng, heightKm });
  }

  return points;
}

function latLngToUnit(latDeg: number, lngDeg: number): Vec3 {
  const lat = (latDeg * Math.PI) / 180;
  const lng = (lngDeg * Math.PI) / 180;

  const cosLat = Math.cos(lat);
  return {
    x: cosLat * Math.cos(lng),
    y: cosLat * Math.sin(lng),
    z: Math.sin(lat)
  };
}

function normalize(v: Vec3): Vec3 {
  const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) || 1;
  return {
    x: v.x / len,
    y: v.y / len,
    z: v.z / len
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function routeToCartesianHeightMeters(point: RoutePoint): number {
  return point.heightKm * 1000;
}

export { EARTH_RADIUS_KM };
