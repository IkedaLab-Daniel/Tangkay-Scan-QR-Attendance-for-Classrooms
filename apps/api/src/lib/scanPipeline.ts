import {
  AttendanceSession,
  Room,
  Student,
  RoomMember,
  GpsPolicy,
  LocationFlag,
} from '@prisma/client';
import jwt from 'jsonwebtoken';
import redis from './redis';
import { haversineMetres, pickRepresentativeReading, ScanReading } from './geo';
import { scoreRisk } from './riskScorer';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ScanPayload {
  token: string;
  readings: ScanReading[];
  client_time: number;
  device_fingerprint: string;
}

export type PipelineContext = {
  payload: ScanPayload;
  session: AttendanceSession & { room: Room };
  student: Student & { member: RoomMember };
  ipAddress?: string;
};

export type CheckResult = {
  pass: boolean;
  flag?: boolean;
  reject?: boolean;
  reason?: string;
  locationFlag?: LocationFlag;
  distanceM?: number;
};

export type PipelineResult = {
  pass: boolean;
  reject?: boolean;
  reason?: string;
  flag?: boolean;
  locationFlag?: LocationFlag;
  distanceM?: number;
  riskScore: 'low' | 'medium' | 'high';
  riskSignals: string[];
};

// ─── Check 1: Auth, membership, consent ──────────────────────────────────────

export async function checkAuthMembership(ctx: PipelineContext): Promise<CheckResult> {
  if (ctx.student.consent_status !== 'granted') {
    return { pass: false, reject: true, reason: 'consent_not_granted' };
  }
  // Membership in the session's room is already asserted by the caller (member is loaded
  // from the session's room_id + student_id); if member doesn't exist the route returns 404.
  return { pass: true };
}

// ─── Check 2: Session open ────────────────────────────────────────────────────

export async function checkSessionOpen(ctx: PipelineContext): Promise<CheckResult> {
  if (ctx.session.status !== 'active') {
    return { pass: false, reject: true, reason: 'session_closed' };
  }
  return { pass: true };
}

// ─── Check 3: Token validation ────────────────────────────────────────────────

export async function checkToken(ctx: PipelineContext): Promise<CheckResult> {
  const { session, payload } = ctx;

  if (session.room.qr_type === 'static') {
    // Token must match what's stored in the room (regeneration invalidates old tokens)
    if (!session.room.static_qr_token || payload.token !== session.room.static_qr_token) {
      return { pass: false, reject: true, reason: 'invalid_token' };
    }

    // Also verify it's a valid JWT with the expected claims
    try {
      const decoded = jwt.verify(payload.token, process.env.JWT_SECRET as string) as {
        typ?: string;
        roomId?: string;
      };
      if (decoded.typ !== 'static_qr' || decoded.roomId !== session.room_id) {
        return { pass: false, reject: true, reason: 'invalid_token' };
      }
    } catch {
      return { pass: false, reject: true, reason: 'invalid_token' };
    }

    return { pass: true };
  }

  // rotating mode — check Redis
  const [currentToken, prevToken] = await Promise.all([
    redis.get(`session:${session.id}:current_token`),
    redis.get(`session:${session.id}:prev_token`),
  ]);

  if (payload.token === currentToken || payload.token === prevToken) {
    return { pass: true };
  }

  return { pass: false, reject: true, reason: 'invalid_token' };
}

// ─── Check 4: Duplicate scan ──────────────────────────────────────────────────

export async function checkDuplicate(
  ctx: PipelineContext,
  prismaClient: import('@prisma/client').PrismaClient,
): Promise<CheckResult> {
  const existing = await prismaClient.attendanceRecord.findUnique({
    where: {
      session_id_student_id: {
        session_id: ctx.session.id,
        student_id: ctx.student.id,
      },
    },
  });
  if (existing) {
    return { pass: false, reason: 'already_recorded' };
  }
  return { pass: true };
}

// ─── Check 5: Geofence ────────────────────────────────────────────────────────

export async function checkGeofence(ctx: PipelineContext): Promise<CheckResult> {
  const { session, payload } = ctx;
  const room = session.room;
  const policy: GpsPolicy = room.gps_policy;

  if (policy === 'off') {
    return { pass: true };
  }

  const rep = pickRepresentativeReading(payload.readings);

  if (!rep) {
    // Empty readings array
    if (policy === 'reject') {
      return { pass: false, reject: true, reason: 'no_gps_readings', locationFlag: 'unverified' };
    }
    // warn or off → pass with unverified flag
    return { pass: true, locationFlag: 'unverified' };
  }

  // No origin set — can't check geofence
  if (session.origin_lat === null || session.origin_lng === null) {
    return { pass: true, locationFlag: 'unverified' };
  }

  const distance = haversineMetres(session.origin_lat, session.origin_lng, rep.lat, rep.lng);
  const threshold =
    room.geofence_radius_m + (session.origin_accuracy ?? 0) + rep.accuracy;

  if (distance <= threshold) {
    return { pass: true, locationFlag: 'verified', distanceM: distance };
  }

  // Outside geofence
  if (policy === 'reject') {
    return {
      pass: false,
      reject: true,
      reason: 'outside_geofence',
      locationFlag: 'mismatch',
      distanceM: distance,
    };
  }

  // warn — flag but pass
  return { pass: true, flag: true, locationFlag: 'mismatch', distanceM: distance };
}

// ─── Check 6: Risk signals ────────────────────────────────────────────────────

export async function checkRiskSignals(
  ctx: PipelineContext,
  prismaClient: import('@prisma/client').PrismaClient,
): Promise<CheckResult & { riskScore: 'low' | 'medium' | 'high'; riskSignals: string[] }> {
  const { score, signals } = await scoreRisk(
    {
      readings: ctx.payload.readings,
      client_time: ctx.payload.client_time,
      device_fingerprint: ctx.payload.device_fingerprint,
      ip_address: ctx.ipAddress ?? '',
      session_id: ctx.session.id,
    },
    prismaClient,
  );

  const attendanceMode = ctx.session.room.attendance_mode;

  if (attendanceMode === 'strict') {
    if (score === 'high') {
      return { pass: false, reject: true, reason: 'high_risk', riskScore: score, riskSignals: signals };
    }
    if (score === 'medium') {
      return { pass: true, flag: true, riskScore: score, riskSignals: signals };
    }
  }

  // All other modes: pass always, flag if not low
  return { pass: true, flag: score !== 'low', riskScore: score, riskSignals: signals };
}

// ─── Check 7: Selfie policy (STUB) ────────────────────────────────────────────

export async function checkSelfie(_ctx: PipelineContext): Promise<CheckResult> {
  // Replaced in Sub-Task 10
  return { pass: true };
}

// ─── Pipeline runner ──────────────────────────────────────────────────────────

export async function runPipeline(
  ctx: PipelineContext,
  prismaClient: import('@prisma/client').PrismaClient,
): Promise<PipelineResult> {
  // Checks that need no prisma access
  const simpleChecks: Array<(c: PipelineContext) => Promise<CheckResult>> = [
    checkAuthMembership,
    checkSessionOpen,
    checkToken,
  ];

  for (const check of simpleChecks) {
    const result = await check(ctx);
    if (!result.pass) {
      return {
        pass: false,
        reject: result.reject,
        reason: result.reason,
        riskScore: 'low',
        riskSignals: [],
      };
    }
  }

  // Duplicate check (idempotent — NOT a reject)
  const dupResult = await checkDuplicate(ctx, prismaClient);
  if (!dupResult.pass) {
    return {
      pass: false,
      reason: dupResult.reason,
      riskScore: 'low',
      riskSignals: [],
    };
  }

  // Geofence
  const geoResult = await checkGeofence(ctx);
  if (!geoResult.pass) {
    return {
      pass: false,
      reject: geoResult.reject,
      reason: geoResult.reason,
      locationFlag: geoResult.locationFlag,
      distanceM: geoResult.distanceM,
      riskScore: 'low',
      riskSignals: [],
    };
  }

  // Risk signals
  const riskResult = await checkRiskSignals(ctx, prismaClient);
  if (!riskResult.pass) {
    return {
      pass: false,
      reject: riskResult.reject,
      reason: riskResult.reason,
      locationFlag: geoResult.locationFlag,
      distanceM: geoResult.distanceM,
      riskScore: riskResult.riskScore,
      riskSignals: riskResult.riskSignals,
    };
  }

  // Selfie stub
  await checkSelfie(ctx);

  return {
    pass: true,
    flag: geoResult.flag || riskResult.flag,
    locationFlag: geoResult.locationFlag,
    distanceM: geoResult.distanceM,
    riskScore: riskResult.riskScore,
    riskSignals: riskResult.riskSignals,
  };
}
