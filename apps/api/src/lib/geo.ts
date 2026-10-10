// ─── Geo utilities ────────────────────────────────────────────────────────────

export interface ScanReading {
  lat: number;
  lng: number;
  accuracy: number;
  altitude: number | null;
  speed: number | null;
  heading: number | null;
  timestamp: number;
}

const EARTH_RADIUS_M = 6_371_000;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Standard Haversine formula — returns great-circle distance in metres.
 */
export function haversineMetres(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

/**
 * Picks the reading with the lowest `accuracy` value (best GPS fix).
 * Returns null if the array is empty.
 */
export function pickRepresentativeReading(readings: ScanReading[]): ScanReading | null {
  if (readings.length === 0) return null;
  return readings.reduce((best, r) => (r.accuracy < best.accuracy ? r : best));
}
