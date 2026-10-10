import { PrismaClient } from '@prisma/client';
import {
  constantAccuracy,
  allNullSensors,
  identicalCoords,
  impossibleJump,
  clockDelta,
  ipGeoMismatch,
  fingerprintCollision,
  scoreRisk,
  ScorerInput,
} from './riskScorer';
import * as ipGeoModule from './ipGeo';
import { ScanReading } from './geo';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeReading(overrides: Partial<ScanReading> = {}): ScanReading {
  return {
    lat: 14.5995,
    lng: 120.9842,
    accuracy: 10,
    altitude: 10,
    speed: 0,
    heading: 90,
    timestamp: Date.now(),
    ...overrides,
  };
}

// ─── constantAccuracy ─────────────────────────────────────────────────────────

describe('constantAccuracy', () => {
  it('returns false for fewer than 2 readings', () => {
    expect(constantAccuracy([])).toBe(false);
    expect(constantAccuracy([makeReading({ accuracy: 5 })])).toBe(false);
  });

  it('returns true when all readings have the same accuracy', () => {
    const readings = [makeReading({ accuracy: 5 }), makeReading({ accuracy: 5 }), makeReading({ accuracy: 5 })];
    expect(constantAccuracy(readings)).toBe(true);
  });

  it('returns false when accuracy values vary', () => {
    const readings = [makeReading({ accuracy: 5 }), makeReading({ accuracy: 8 }), makeReading({ accuracy: 5 })];
    expect(constantAccuracy(readings)).toBe(false);
  });
});

// ─── allNullSensors ───────────────────────────────────────────────────────────

describe('allNullSensors', () => {
  it('returns false for empty readings', () => {
    expect(allNullSensors([])).toBe(false);
  });

  it('returns true when all readings have altitude, speed, and heading null', () => {
    const readings = [
      makeReading({ altitude: null, speed: null, heading: null }),
      makeReading({ altitude: null, speed: null, heading: null }),
    ];
    expect(allNullSensors(readings)).toBe(true);
  });

  it('returns false when at least one reading has sensor data', () => {
    const readings = [
      makeReading({ altitude: null, speed: null, heading: null }),
      makeReading({ altitude: 10, speed: null, heading: null }),
    ];
    expect(allNullSensors(readings)).toBe(false);
  });

  it('returns false when speed is non-null', () => {
    const readings = [makeReading({ altitude: null, speed: 1.5, heading: null })];
    expect(allNullSensors(readings)).toBe(false);
  });
});

// ─── identicalCoords ──────────────────────────────────────────────────────────

describe('identicalCoords', () => {
  it('returns false for fewer than 2 readings', () => {
    expect(identicalCoords([])).toBe(false);
    expect(identicalCoords([makeReading()])).toBe(false);
  });

  it('returns true when all readings have identical lat and lng', () => {
    const readings = [
      makeReading({ lat: 14.599500, lng: 120.984200 }),
      makeReading({ lat: 14.599500, lng: 120.984200 }),
      makeReading({ lat: 14.599500, lng: 120.984200 }),
    ];
    expect(identicalCoords(readings)).toBe(true);
  });

  it('returns false when readings have natural GPS jitter', () => {
    const readings = [
      makeReading({ lat: 14.599512, lng: 120.984213 }),
      makeReading({ lat: 14.599534, lng: 120.984198 }),
      makeReading({ lat: 14.599501, lng: 120.984225 }),
    ];
    expect(identicalCoords(readings)).toBe(false);
  });
});

// ─── impossibleJump ───────────────────────────────────────────────────────────

describe('impossibleJump', () => {
  it('returns false for fewer than 2 readings', () => {
    expect(impossibleJump([])).toBe(false);
    expect(impossibleJump([makeReading()])).toBe(false);
  });

  it('returns true when 200 m covered in 1 second (200 m/s >> 50 m/s)', () => {
    const now = Date.now();
    // ~200 m north of origin
    const readings = [
      makeReading({ lat: 14.5995, lng: 120.9842, timestamp: now }),
      makeReading({ lat: 14.6013, lng: 120.9842, timestamp: now + 1000 }), // ~200 m in 1 s
    ];
    expect(impossibleJump(readings)).toBe(true);
  });

  it('returns false for normal walking/standing movement', () => {
    const now = Date.now();
    // ~5 m in 2 s = 2.5 m/s — walking pace
    const readings = [
      makeReading({ lat: 14.59950, lng: 120.98420, timestamp: now }),
      makeReading({ lat: 14.59954, lng: 120.98421, timestamp: now + 2000 }),
    ];
    expect(impossibleJump(readings)).toBe(false);
  });
});

// ─── clockDelta ───────────────────────────────────────────────────────────────

describe('clockDelta', () => {
  it('returns true when difference is > 2 minutes (3-minute delta)', () => {
    const serverTime = Date.now();
    const clientTime = serverTime - 3 * 60 * 1000; // 3 min in the past
    expect(clockDelta(clientTime, serverTime)).toBe(true);
  });

  it('returns false when difference is ≤ 2 minutes (30-second delta)', () => {
    const serverTime = Date.now();
    const clientTime = serverTime - 30 * 1000; // 30 s
    expect(clockDelta(clientTime, serverTime)).toBe(false);
  });

  it('returns true for future client time also beyond 2 minutes', () => {
    const serverTime = Date.now();
    const clientTime = serverTime + 3 * 60 * 1000;
    expect(clockDelta(clientTime, serverTime)).toBe(true);
  });

  it('returns false exactly at 2-minute boundary', () => {
    const serverTime = Date.now();
    const clientTime = serverTime - 120_000;
    expect(clockDelta(clientTime, serverTime)).toBe(false);
  });
});

// ─── ipGeoMismatch ────────────────────────────────────────────────────────────

describe('ipGeoMismatch', () => {
  afterEach(() => jest.restoreAllMocks());

  it('returns false when readings are empty', async () => {
    expect(await ipGeoMismatch('1.2.3.4', [])).toBe(false);
  });

  it('returns false when lookupIp returns null', async () => {
    jest.spyOn(ipGeoModule, 'lookupIp').mockResolvedValue(null);
    const readings = [makeReading()];
    expect(await ipGeoMismatch('1.2.3.4', readings)).toBe(false);
  });

  it('returns true when IP geo is > 100 km away (Manila vs Cebu)', async () => {
    // IP resolves to Cebu (~580 km from Manila)
    jest.spyOn(ipGeoModule, 'lookupIp').mockResolvedValue({
      status: 'success',
      city: 'Cebu City',
      country: 'PH',
      lat: 10.3157,
      lon: 123.8854,
    });
    const readings = [makeReading({ lat: 14.5995, lng: 120.9842 })]; // Manila
    expect(await ipGeoMismatch('1.2.3.4', readings)).toBe(true);
  });

  it('returns false when IP geo is close to GPS reading (< 100 km)', async () => {
    // IP resolves to just a few km away
    jest.spyOn(ipGeoModule, 'lookupIp').mockResolvedValue({
      status: 'success',
      city: 'Makati',
      country: 'PH',
      lat: 14.5548,
      lon: 121.0244,
    });
    const readings = [makeReading({ lat: 14.5995, lng: 120.9842 })]; // Manila (~6 km away)
    expect(await ipGeoMismatch('1.2.3.4', readings)).toBe(false);
  });
});

// ─── fingerprintCollision ─────────────────────────────────────────────────────

describe('fingerprintCollision', () => {
  afterEach(() => jest.restoreAllMocks());

  it('returns true when same fingerprint exists for a different student in the session', async () => {
    const mockPrisma = {
      attendanceRecord: {
        findFirst: jest.fn().mockResolvedValue({ student_id: 'other-student-id' }),
      },
    } as unknown as PrismaClient;

    expect(await fingerprintCollision('fp-shared', 'session-1', mockPrisma)).toBe(true);
  });

  it('returns false when no record exists with that fingerprint in the session', async () => {
    const mockPrisma = {
      attendanceRecord: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    } as unknown as PrismaClient;

    expect(await fingerprintCollision('fp-unique', 'session-1', mockPrisma)).toBe(false);
  });
});

// ─── Aggregation ──────────────────────────────────────────────────────────────

describe('scoreRisk aggregation', () => {
  afterEach(() => jest.restoreAllMocks());

  function mockPrismaNoCollision(): PrismaClient {
    return {
      attendanceRecord: { findFirst: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaClient;
  }

  it('1 signal → low', async () => {
    // Force exactly 1 signal: use a very old client_time (clock_delta)
    // All other signals disabled: 2 varied readings with different coords/accuracy, sensors present
    jest.spyOn(ipGeoModule, 'lookupIp').mockResolvedValue(null);
    const now = Date.now();
    const input: ScorerInput = {
      readings: [
        makeReading({ lat: 14.5995, lng: 120.9842, accuracy: 5, altitude: 10, speed: 1, heading: 90, timestamp: now }),
        makeReading({ lat: 14.5996, lng: 120.9843, accuracy: 8, altitude: 11, speed: 2, heading: 91, timestamp: now + 1000 }),
      ],
      client_time: now - 5 * 60 * 1000, // 5 min old → clock_delta fires (1 signal)
      device_fingerprint: 'fp-agg-low',
      ip_address: '127.0.0.1', // private → ipGeo skipped
      session_id: 'sess-agg-low',
    };
    const result = await scoreRisk(input, mockPrismaNoCollision());
    expect(result.score).toBe('low');
    expect(result.signals).toContain('clock_delta');
    expect(result.signals.length).toBe(1);
  });

  it('2 signals → medium', async () => {
    jest.spyOn(ipGeoModule, 'lookupIp').mockResolvedValue(null);
    const now = Date.now();
    // constant_accuracy + clock_delta = 2 signals
    const input: ScorerInput = {
      readings: [
        makeReading({ accuracy: 5, altitude: 10, speed: 1, heading: 90, timestamp: now }),
        makeReading({ accuracy: 5, altitude: 11, speed: 2, heading: 91, timestamp: now + 1000 }),
      ],
      client_time: now - 5 * 60 * 1000,
      device_fingerprint: 'fp-agg-med',
      ip_address: '127.0.0.1',
      session_id: 'sess-agg-med',
    };
    const result = await scoreRisk(input, mockPrismaNoCollision());
    expect(result.score).toBe('medium');
    expect(result.signals.length).toBeGreaterThanOrEqual(2);
  });

  it('4 signals → high', async () => {
    jest.spyOn(ipGeoModule, 'lookupIp').mockResolvedValue(null);
    const now = Date.now();
    // constant_accuracy + all_null_sensors + identical_coords + clock_delta = 4 signals
    const input: ScorerInput = {
      readings: [
        makeReading({ lat: 14.5995, lng: 120.9842, accuracy: 5, altitude: null, speed: null, heading: null, timestamp: now }),
        makeReading({ lat: 14.5995, lng: 120.9842, accuracy: 5, altitude: null, speed: null, heading: null, timestamp: now + 1000 }),
      ],
      client_time: now - 5 * 60 * 1000,
      device_fingerprint: 'fp-agg-high',
      ip_address: '127.0.0.1',
      session_id: 'sess-agg-high',
    };
    const result = await scoreRisk(input, mockPrismaNoCollision());
    expect(result.score).toBe('high');
    expect(result.signals.length).toBeGreaterThanOrEqual(4);
  });
});

// ─── scoreRisk with empty readings ────────────────────────────────────────────

describe('scoreRisk with empty readings', () => {
  afterEach(() => jest.restoreAllMocks());

  it('runs only applicable signals (clock_delta, fingerprint_collision) and returns low for clean input', async () => {
    jest.spyOn(ipGeoModule, 'lookupIp').mockResolvedValue(null);
    const mockPrisma = {
      attendanceRecord: { findFirst: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaClient;

    const now = Date.now();
    const input: ScorerInput = {
      readings: [], // empty
      client_time: now, // in-sync → no clock_delta
      device_fingerprint: 'fp-empty',
      ip_address: '127.0.0.1',
      session_id: 'sess-empty',
    };

    const result = await scoreRisk(input, mockPrisma);
    expect(result.score).toBe('low');
    expect(result.signals).toHaveLength(0);
    // Reading-dependent signals must not fire
    expect(result.signals).not.toContain('constant_accuracy');
    expect(result.signals).not.toContain('all_null_sensors');
    expect(result.signals).not.toContain('identical_coords');
    expect(result.signals).not.toContain('impossible_jump');
    expect(result.signals).not.toContain('ip_geo_mismatch');
  });
});
