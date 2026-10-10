'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Spinner, BottomSheet, PageHeader } from '@/components/ui';
import { api } from '@/lib/api';

interface RoomInfo {
  id: string;
  name: string;
}

export default function ConsentPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const router = useRouter();

  const [room, setRoom] = useState<RoomInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [grantLoading, setGrantLoading] = useState(false);
  const [denyLoading, setDenyLoading] = useState(false);
  const [error, setError] = useState('');

  // Bottom sheet for "no consent" explanation
  const [denySheetOpen, setDenySheetOpen] = useState(false);

  useEffect(() => {
    api
      .get<RoomInfo>(`/api/rooms/${roomId}`)
      .then((r) => setRoom(r))
      .catch(() => setError('Could not load room details.'))
      .finally(() => setLoading(false));
  }, [roomId]);

  async function handleConsent(status: 'granted' | 'denied') {
    setError('');
    if (status === 'granted') setGrantLoading(true);
    else setDenyLoading(true);

    try {
      await api.post(`/api/rooms/${roomId}/consent`, { status });
      if (status === 'denied') {
        setDenySheetOpen(true);
      } else {
        router.replace('/student/rooms');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setGrantLoading(false);
      setDenyLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <Spinner />
        <p className="font-body-md text-on-surface-variant">Loading…</p>
      </div>
    );
  }

  return (
    <>
      {/* Override student layout header for this screen */}
      <PageHeader title="Before you start" back />

      <div className="pt-20 pb-8 px-margin flex flex-col gap-space-lg max-w-[480px] mx-auto">
        {/* Content card */}
        <div className="bg-surface-container-lowest rounded-xl shadow-sm border border-outline-variant/30 p-space-lg flex flex-col gap-space-md">
          {/* Shield icon */}
          <div className="flex items-center justify-center w-14 h-14 rounded-full bg-primary-fixed mx-auto">
            <span
              className="material-symbols-outlined text-primary"
              style={{ fontSize: 28, fontVariationSettings: "'FILL' 1" }}
            >
              shield_lock
            </span>
          </div>

          {/* Title */}
          <h2 className="font-headline-md text-on-surface text-center">
            Attendance Privacy Notice
          </h2>

          {/* What is collected */}
          <div className="flex flex-col gap-space-sm">
            <p className="font-label-md text-on-surface-variant font-semibold uppercase tracking-wider">
              What is collected
            </p>
            <div className="flex flex-wrap gap-2">
              <DataChip icon="location_on" label="Location (GPS)" />
              <DataChip icon="photo_camera" label="Selfie photo (if required)" />
              <DataChip icon="schedule" label="Attendance timestamps" />
            </div>
          </div>

          {/* Why */}
          <div className="flex flex-col gap-1">
            <p className="font-label-md text-on-surface-variant font-semibold uppercase tracking-wider">
              Why
            </p>
            <p className="font-body-md text-on-surface">
              Used only for attendance verification in{' '}
              <strong>{room?.name ?? 'this room'}</strong>. Your teacher and school administrator
              can view this data.
            </p>
          </div>

          {/* Retention */}
          <div className="flex items-start gap-2 bg-surface-container-low rounded-xl p-space-md">
            <span
              className="material-symbols-outlined text-primary shrink-0 mt-0.5"
              style={{ fontSize: 18 }}
            >
              auto_delete
            </span>
            <p className="font-body-sm text-on-surface-variant">
              Data is automatically deleted after <strong className="text-on-surface">30 days</strong>.
            </p>
          </div>

          {/* DPA link */}
          <a
            href="https://www.privacy.gov.ph/data-privacy-act/"
            target="_blank"
            rel="noopener noreferrer"
            className="font-body-sm text-primary underline underline-offset-2 text-center"
          >
            Data Privacy Act of 2012 (Philippines) ↗
          </a>
        </div>

        {/* Error */}
        {error && <p className="font-body-sm text-error text-center">{error}</p>}

        {/* Actions */}
        <div className="flex flex-col gap-space-sm">
          <button
            type="button"
            onClick={() => handleConsent('granted')}
            disabled={grantLoading || denyLoading}
            className="w-full h-14 bg-primary text-on-primary rounded-full font-label-lg shadow-sm hover:opacity-95 active:scale-[0.99] transition-all flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {grantLoading ? (
              <Spinner className="text-on-primary" />
            ) : (
              <>
                <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
                  check_circle
                </span>
                I understand and consent
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => handleConsent('denied')}
            disabled={grantLoading || denyLoading}
            className="w-full h-10 border border-outline-variant rounded-full font-label-md text-on-surface-variant hover:bg-surface-container active:scale-[0.99] transition-all flex items-center justify-center disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {denyLoading ? <Spinner /> : 'I do not consent'}
          </button>
        </div>
      </div>

      {/* Denial explanation bottom sheet */}
      <BottomSheet
        open={denySheetOpen}
        onClose={() => {
          setDenySheetOpen(false);
          router.replace('/student/rooms');
        }}
        title="No problem"
      >
        <div className="px-5 pb-8 flex flex-col gap-space-md">
          <div className="flex items-start gap-3">
            <span
              className="material-symbols-outlined text-on-surface-variant shrink-0 mt-0.5"
              style={{ fontSize: 20 }}
            >
              info
            </span>
            <p className="font-body-md text-on-surface-variant">
              You won&apos;t be able to scan QR codes to mark attendance, but your teacher can
              still mark you present manually. You can update your consent at any time from room
              settings.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setDenySheetOpen(false);
              router.replace('/student/rooms');
            }}
            className="w-full h-11 bg-primary text-on-primary rounded-full font-label-lg flex items-center justify-center transition-all hover:opacity-95 active:scale-[0.99]"
          >
            Continue to rooms
          </button>
        </div>
      </BottomSheet>
    </>
  );
}

// ── Data chip ─────────────────────────────────────────────────────────────────

function DataChip({ icon, label }: { icon: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface-container border border-outline-variant/30 font-label-sm text-on-surface">
      <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
        {icon}
      </span>
      {label}
    </span>
  );
}
