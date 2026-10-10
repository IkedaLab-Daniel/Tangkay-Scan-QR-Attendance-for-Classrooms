import { PrismaClient } from '@prisma/client';
import { ScanReading, haversineMetres } from './geo';
import { lookupIp } from './ipGeo';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ScorerInput {
  readings: ScanReading[];
  client_time: number;
  device_fingerprint: string;
  ip_address: string;
  session_id: string;
}

export interface ScorerOutput {
  score: 'low' | 'medium' | 'high';
  signals: string[];
}

// ─── Signal functions ─────────────────────────────────────────────────────────

/**
 * Fires when all readings have the exact same accuracy value (≥ 2 readings).
 * Real GPS sensors vary their accuracy over time.
 */
export function constantAccuracy(readings: ScanReading[]): boolean {
  if (readings.length < 2) return false;
  return readings.every((r) => r.accuracy === readings[0].accuracy);
}

/**
 * Fires when all readings have altitude, speed, and heading all null (≥ 1 reading).
 * Real devices typically provide at least one of these on any mobile platform.
 */
export function allNullSensors(readings: ScanReading[]): boolean {
  if (readings.length < 1) return false;
  return readings.every(
    (r) => r.altitude === null && r.speed === null && r.heading === null,
  );
}

/**
 * Fires when all readings share identical lat and lng to 6 decimal places (≥ 2 readings).
 * Genuine watchPosition calls show natural jitter.
 */
export function identicalCoords(readings: ScanReading[]): boolean {
  if (readings.length < 2) return false;
  const ref = readings[0];
  const refLat = ref.lat.toFixed(6);
  const refLng = ref.lng.toFixed(6);
  return readings.every(
    (r) => r.lat.toFixed(6) === refLat && r.lng.toFixed(6) === refLng,
  );
}

/**
 * Fires when any consecutive pair of readings implies speed > 50 m/s (180 km/h).
 */
export function impossibleJump(readings: ScanReading[]): boolean {
  if (readings.length < 2) return false;
  for (let i = 1; i < readings.length; i++) {
    const prev = readings[i - 1];
    const curr = readings[i];
    const dtMs = Math.abs(curr.timestamp - prev.timestamp);
    if (dtMs === 0) continue; // can't divide by zero; skip
    const distM = haversineMetres(prev.lat, prev.lng, curr.lat, curr.lng);
    const speedMs = distM / (dtMs / 1000);
    if (speedMs > 50) return true;
  }
  return false;
}

/**
 * Fires when client_time differs from server time by more than 2 minutes.
 */
export function clockDelta(client_time: number, server_time_ms: number): boolean {
  return Math.abs(client_time - server_time_ms) > 120_000;
}

/**
 * Fires when the IP geolocation is > 100 km from the median GPS reading.
 * Async — calls lookupIp (fail-open: returns false on any error or missing data).
 */
export async function ipGeoMismatch(
  ip: string,
  readings: ScanReading[],
): Promise<boolean> {
  if (readings.length < 1) return false;

  const geo = await lookupIp(ip);
  if (!geo) return false;

  // Compute median lat/lng from readings
  const sortedLat = [...readings].sort((a, b) => a.lat - b.lat);
  const sortedLng = [...readings].sort((a, b) => a.lng - b.lng);
  const mid = Math.floor(readings.length / 2);
  const medianLat =
    readings.length % 2 === 0
      ? (sortedLat[mid - 1].lat + sortedLat[mid].lat) / 2
      : sortedLat[mid].lat;
  const medianLng =
    readings.length % 2 === 0
      ? (sortedLng[mid - 1].lng + sortedLng[mid].lng) / 2
      : sortedLng[mid].lng;

  const distM = haversineMetres(geo.lat, geo.lon, medianLat, medianLng);
  return distM > 100_000;
}

/**
 * Fires when another attendance record in the same session uses the same
 * device_fingerprint but belongs to a different student.
 */
export async function fingerprintCollision(
  device_fingerprint: string,
  session_id: string,
  prismaClient: PrismaClient,
): Promise<boolean> {
  const existing = await prismaClient.attendanceRecord.findFirst({
    where: {
      session_id,
      device_fingerprint,
    },
    select: { student_id: true },
  });
  // If ANY record exists with this fingerprint in this session it means another
  // student already used this device (the caller is a different student — the
  // duplicate-scan guard earlier prevents the same student reaching here again).
  return existing !== null;
}

// ─── Aggregation ──────────────────────────────────────────────────────────────

function aggregateScore(signalCount: number): 'low' | 'medium' | 'high' {
  if (signalCount >= 4) return 'high';
  if (signalCount >= 2) return 'medium';
  return 'low';
}

// ─── Main scorer ──────────────────────────────────────────────────────────────

export async function scoreRisk(
  input: ScorerInput,
  prismaClient: PrismaClient,
): Promise<ScorerOutput> {
  const { readings, client_time, device_fingerprint, ip_address, session_id } = input;
  const serverTime = Date.now();

  const signals: string[] = [];

  // Synchronous signals
  if (constantAccuracy(readings)) signals.push('constant_accuracy');
  if (allNullSensors(readings)) signals.push('all_null_sensors');
  if (identicalCoords(readings)) signals.push('identical_coords');
  if (impossibleJump(readings)) signals.push('impossible_jump');
  if (clockDelta(client_time, serverTime)) signals.push('clock_delta');

  // Async signals (run in parallel)
  const [geoMismatch, fpCollision] = await Promise.all([
    ipGeoMismatch(ip_address, readings),
    fingerprintCollision(device_fingerprint, session_id, prismaClient),
  ]);
  if (geoMismatch) signals.push('ip_geo_mismatch');
  if (fpCollision) signals.push('fingerprint_collision');

  return { score: aggregateScore(signals.length), signals };
}
