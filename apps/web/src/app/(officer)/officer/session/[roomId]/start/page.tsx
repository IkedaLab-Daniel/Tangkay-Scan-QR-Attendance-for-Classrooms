'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { OfficerGuard, useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { Room } from '@/lib/types';
import { PageHeader } from '@/components/ui/PageHeader';
import { Badge, BadgeVariant } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getTimeOfDay(): string {
  const h = new Date().getHours();
  if (h < 12) return 'MORNING ROLL CALL';
  if (h < 17) return 'AFTERNOON ROLL CALL';
  return 'EVENING ROLL CALL';
}

function modeVariant(mode: string): BadgeVariant {
  if (mode === 'strict') return 'strict';
  if (mode === 'static') return 'static';
  if (mode === 'manual') return 'manual';
  return 'balanced';
}

function selfieLabel(policy: string): string {
  if (policy === 'required') return 'Selfie confirmation required';
  if (policy === 'optional') return 'Optional selfie confirmation active';
  return 'Selfie confirmation off';
}

function selfieDesc(policy: string): string {
  if (policy === 'required') return 'Snapshot verification required for all students';
  if (policy === 'optional') return 'Quick snapshot verification for proxies';
  return 'No selfie verification for this session';
}

interface GpsReading {
  lat: number;
  lng: number;
  accuracy: number;
}

// ─── Inner content ────────────────────────────────────────────────────────────

function SessionStartContent() {
  const { roomId } = useParams<{ roomId: string }>();
  const router = useRouter();
  const { user } = useAuth();

  const [room, setRoom] = useState<Room | null>(null);
  const [roomLoading, setRoomLoading] = useState(true);
  const [gpsReading, setGpsReading] = useState<GpsReading | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Officer title from room members (fetched separately if needed)
  const [officerTitle, setOfficerTitle] = useState<string | null>(null);

  // Load room details
  useEffect(() => {
    if (!roomId) return;
    api
      .get<Room>(`/api/rooms/${roomId}`)
      .then((r) => setRoom(r))
      .catch(() => setRoom(null))
      .finally(() => setRoomLoading(false));
  }, [roomId]);

  // Load officer title from officer rooms list
  useEffect(() => {
    if (!user || !roomId) return;
    api
      .get<Array<{ id: string; officer_title?: string | null }>>('/api/rooms/my-officer-rooms')
      .then((rooms) => {
        const match = rooms.find((r) => r.id === roomId);
        if (match?.officer_title) setOfficerTitle(match.officer_title);
      })
      .catch(() => {});
  }, [user, roomId]);

  // GPS acquisition
  useEffect(() => {
    if (!navigator.geolocation) {
      setGpsError('Geolocation not supported');
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (pos) =>
        setGpsReading({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        }),
      (err) => setGpsError(err.message),
      { enableHighAccuracy: true, timeout: 15000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  const isStatic = room?.attendance_mode === 'static';
  const isManual = room?.attendance_mode === 'manual';
  const gpsAcquired = gpsReading !== null;
  const canStart = isStatic || isManual || gpsAcquired;

  // Checklist readiness
  const checklistItems = [
    {
      icon: 'qr_code_2',
      ready: true,
      title: isStatic
        ? 'Static QR mode — no rotation'
        : 'Dynamic 30s rotating QR ready',
      desc: isStatic
        ? 'Students scan a fixed QR code for this room'
        : 'Mitigates code sharing and unauthorized passes',
    },
    {
      icon: 'photo_camera_front',
      ready: true,
      title: selfieLabel(room?.selfie_policy ?? 'off'),
      desc: selfieDesc(room?.selfie_policy ?? 'off'),
    },
    {
      icon: 'my_location',
      ready: isManual || gpsAcquired,
      title: isManual
        ? 'GPS anchor not required for Manual mode'
        : gpsAcquired
        ? 'GPS anchor set'
        : 'Acquiring GPS...',
      desc: isManual
        ? 'Students are marked present manually by officer'
        : gpsAcquired
        ? `Accurate within ${Math.round(gpsReading!.accuracy)}m`
        : 'High accuracy GPS signal needed',
    },
  ];

  const readyCount = checklistItems.filter((c) => c.ready).length;

  async function handleStart() {
    if (!room || !canStart) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const body: {
        roomId: string;
        originLat?: number;
        originLng?: number;
        originAccuracy?: number;
      } = { roomId: room.id };
      if (gpsReading) {
        body.originLat = gpsReading.lat;
        body.originLng = gpsReading.lng;
        body.originAccuracy = gpsReading.accuracy;
      }
      const session = await api.post<{ id: string }>('/api/sessions', body);
      router.push(`/officer/session/${room.id}/live/${session.id}`);
    } catch (err: unknown) {
      const e = err as { body?: { error?: string }; message?: string };
      setSubmitError(e?.body?.error ?? e?.message ?? 'Failed to start session');
      setSubmitting(false);
    }
  }

  if (roomLoading) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (!room) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center px-margin">
        <p className="font-body-md text-on-surface-variant text-center">Room not found.</p>
      </div>
    );
  }

  const modeLabel = room.attendance_mode.charAt(0).toUpperCase() + room.attendance_mode.slice(1);

  return (
    <div className="flex flex-col w-full min-h-screen bg-surface">
      <PageHeader back title="Tangkay Scan — Officer Session Control" />

      <div className="flex flex-col px-margin pt-20 pb-32 gap-space-xs">

        {/* ── Room Info Card ── */}
        <div className="py-space-xs">
          <div className="bg-surface-container-lowest rounded-xl p-space-md shadow-card flex flex-col gap-space-sm">
            <div className="flex items-start justify-between gap-space-xs">
              <div className="flex flex-col min-w-0">
                <span className="font-label-sm text-[11px] text-outline uppercase tracking-wider">
                  {getTimeOfDay()}
                </span>
                <h2 className="font-headline-md text-on-surface">{room.name}</h2>
              </div>
              <Badge variant={modeVariant(room.attendance_mode)} label={modeLabel} dot />
            </div>

            {/* Officer row */}
            <div className="flex items-center gap-space-sm bg-surface-container-low rounded-lg px-space-sm py-2">
              <div className="w-7 h-7 rounded-full bg-surface-container flex items-center justify-center text-primary">
                <span className="material-symbols-outlined text-[18px]">badge</span>
              </div>
              <div className="flex flex-col min-w-0">
                <span className="font-label-sm text-[11px] text-outline">Active Session Officer</span>
                <span className="font-label-lg text-[14px] text-on-surface truncate">
                  {user?.name ?? '—'}
                  {officerTitle && ` (${officerTitle})`}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Classroom Location Anchor Card ── */}
        {!isManual && (
          <div className="py-space-xs">
            <div className="bg-surface-container-lowest rounded-xl p-space-md shadow-card flex flex-col gap-space-md">
              <div className="flex items-center gap-space-sm">
                {/* Botanical compass icon */}
                <div className="w-12 h-12 rounded-full bg-primary-fixed/50 flex items-center justify-center text-primary shrink-0">
                  <svg className="w-7 h-7" fill="none" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="16" cy="16" r="14" stroke="currentColor" strokeDasharray="3 3" strokeWidth="2" />
                    <path d="M16 6C12.134 6 9 9.134 9 13C9 17.5 16 25 16 25C16 25 23 17.5 23 13C23 9.134 19.866 6 16 6Z" fill="#126a3a" />
                    <circle cx="16" cy="13" fill="#ffffff" r="3" />
                    <path d="M16 3V6M16 26V29M3 16H6M26 16H29" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
                  </svg>
                </div>
                <div className="flex flex-col">
                  <h3 className="font-headline-sm text-on-surface">Classroom Location Anchor</h3>
                  {gpsAcquired ? (
                    <span className="font-label-sm text-[11px] text-primary flex items-center gap-1">
                      <span className="material-symbols-outlined text-[14px]">verified</span>
                      Geo-Anchor Lock Armed
                    </span>
                  ) : (
                    <span className="font-label-sm text-[11px] text-on-surface-variant flex items-center gap-1">
                      <span className="material-symbols-outlined text-[14px] animate-spin">sync</span>
                      Acquiring GPS...
                    </span>
                  )}
                </div>
              </div>

              <p className="font-body-md text-[14px] text-on-surface-variant leading-relaxed">
                Your location is saved once as the room reference point for today&apos;s session.
                Students checking in will verify they are within {room.geofence_radius_m}m of this
                classroom.
              </p>

              {/* Map placeholder */}
              <div className="relative w-full h-36 rounded-lg overflow-hidden bg-surface-container-high">
                <div className="w-full h-full flex flex-col items-center justify-center gap-1">
                  <span className="material-symbols-outlined text-[32px] text-on-surface-variant/40">
                    map
                  </span>
                  {gpsAcquired ? (
                    <span className="font-label-sm text-[11px] text-on-surface-variant">
                      {gpsReading!.lat.toFixed(6)}, {gpsReading!.lng.toFixed(6)}
                    </span>
                  ) : (
                    <span className="font-label-sm text-[11px] text-on-surface-variant animate-pulse">
                      Acquiring GPS signal...
                    </span>
                  )}
                </div>
                <div className="absolute inset-x-0 bottom-0 flex items-center justify-between px-space-sm py-2 bg-gradient-to-t from-inverse-surface/40 to-transparent">
                  <span className="text-surface-container-lowest font-label-sm text-[11px] flex items-center gap-1">
                    <span className="material-symbols-outlined text-[16px] text-primary-fixed">near_me</span>
                    Live Geofence Boundary
                  </span>
                  <span className="bg-surface-container-lowest/90 backdrop-blur-sm text-on-surface font-label-sm text-[11px] px-2 py-0.5 rounded-full">
                    {room.geofence_radius_m}m Radius
                  </span>
                </div>
              </div>

              {/* GPS accuracy chip */}
              {gpsAcquired ? (
                <div className="flex items-center justify-between bg-surface-container-low rounded-xl px-space-sm py-2">
                  <div className="flex items-center gap-space-sm">
                    <div className="w-8 h-8 rounded-full bg-primary-fixed flex items-center justify-center text-primary">
                      <span className="material-symbols-outlined text-[20px]">check_circle</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="font-label-lg text-[14px] text-on-surface">High accuracy GPS signal acquired</span>
                      <span className="font-body-sm text-[12px] text-on-surface-variant">
                        Accurate within {Math.round(gpsReading!.accuracy)}m
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-space-sm bg-surface-container-low rounded-xl px-space-sm py-2">
                  <div className="w-8 h-8 rounded-full bg-surface-container flex items-center justify-center text-on-surface-variant">
                    <span className="material-symbols-outlined text-[20px] animate-spin">sync</span>
                  </div>
                  <span className="font-label-lg text-[14px] text-on-surface-variant">Acquiring GPS...</span>
                  {gpsError && (
                    <span className="font-body-sm text-[12px] text-error ml-auto">{gpsError}</span>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Session Launch Checklist ── */}
        <div className="py-space-xs">
          <div className="bg-surface-container-lowest rounded-xl p-space-md shadow-card flex flex-col gap-space-sm">
            <div className="flex items-center justify-between">
              <h4 className="font-label-lg text-[14px] text-on-surface">Session Launch Checklist</h4>
              <span className="font-label-sm text-[11px] text-outline">{readyCount} of 3 ready</span>
            </div>

            <div className="flex flex-col gap-space-xs pt-1">
              {checklistItems.map((item, i) => (
                <div
                  key={i}
                  className="flex items-center gap-space-sm p-space-xs rounded-lg hover:bg-surface-container-low transition-colors"
                >
                  <div className="w-6 h-6 rounded-md bg-primary-fixed flex items-center justify-center text-primary shrink-0">
                    <span className="material-symbols-outlined text-[16px]">{item.icon}</span>
                  </div>
                  <div className="flex flex-col flex-grow min-w-0">
                    <span className="font-body-md text-[14px] text-on-surface">{item.title}</span>
                    <span className="font-body-sm text-[12px] text-outline">{item.desc}</span>
                  </div>
                  <span
                    className={`material-symbols-outlined text-[20px] shrink-0 ${item.ready ? 'text-primary' : 'text-outline-variant'}`}
                    style={{ fontVariationSettings: item.ready ? "'FILL' 1" : "'FILL' 0" }}
                  >
                    check_circle
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {submitError && (
          <div className="px-space-sm py-2 rounded-lg bg-error-container">
            <p className="font-body-sm text-[12px] text-on-error-container">{submitError}</p>
          </div>
        )}
      </div>

      {/* ── Sticky Bottom Bar ── */}
      <div className="fixed bottom-0 inset-x-0 bg-surface/90 backdrop-blur-md px-margin py-space-md pb-safe shadow-[0_-4px_16px_rgba(43,42,38,0.06)] flex flex-col items-center gap-space-xs z-40">
        <button
          disabled={!canStart || submitting}
          onClick={handleStart}
          className="w-full h-14 rounded-full bg-primary text-on-primary font-label-lg text-[14px]
                     flex items-center justify-center gap-space-sm shadow-[0_4px_12px_rgba(63,143,91,0.25)]
                     active:translate-y-0.5 transition-all
                     disabled:opacity-50 disabled:cursor-not-allowed disabled:active:translate-y-0"
        >
          {submitting ? (
            <>
              <span className="material-symbols-outlined text-[20px] animate-spin">progress_activity</span>
              <span>Arming classroom anchor...</span>
            </>
          ) : (
            <>
              <span className="material-symbols-outlined text-[20px]" style={{ fontVariationSettings: "'FILL' 1" }}>sensors</span>
              <span>Start attendance session</span>
            </>
          )}
        </button>
        <button
          className="py-1 px-space-sm font-label-md text-[12px] text-outline hover:text-on-surface transition-colors"
          type="button"
          onClick={() => router.back()}
        >
          Change location or room settings
        </button>
      </div>
    </div>
  );
}

export default function OfficerSessionStartPage() {
  return (
    <OfficerGuard>
      <SessionStartContent />
    </OfficerGuard>
  );
}
