'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import QRCode from 'react-qr-code';
import { OfficerGuard } from '@/lib/auth';
import { api, BASE } from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';

// ─── Countdown ring ───────────────────────────────────────────────────────────

function CountdownRing({ expiresAt }: { expiresAt: Date | null }) {
  const [progress, setProgress] = useState(1); // 1 = full, 0 = empty

  useEffect(() => {
    if (!expiresAt) return;
    const DURATION = 30_000;

    function tick() {
      const remaining = expiresAt!.getTime() - Date.now();
      setProgress(Math.max(0, Math.min(1, remaining / DURATION)));
    }

    tick();
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [expiresAt]);

  const radius = 48;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - progress);

  return (
    <svg width="108" height="108" className="absolute -top-[6px] -left-[6px] -right-[6px] pointer-events-none">
      {/* Track */}
      <circle
        cx="54"
        cy="54"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        className="text-primary-fixed"
      />
      {/* Progress arc */}
      <circle
        cx="54"
        cy="54"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={dashOffset}
        transform="rotate(-90 54 54)"
        className="text-primary transition-none"
      />
    </svg>
  );
}

// ─── Inner content ────────────────────────────────────────────────────────────

interface SessionData {
  id: string;
  room_id: string;
  status: string;
  present_count?: number;
}

function LiveQrContent() {
  const { roomId, sessionId } = useParams<{ roomId: string; sessionId: string }>();
  const router = useRouter();

  const [roomName, setRoomName] = useState<string>('');
  const [token, setToken] = useState<string>('');
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [presentCount, setPresentCount] = useState(0);
  const [ending, setEnding] = useState(false);

  // Load room name
  useEffect(() => {
    if (!roomId) return;
    api
      .get<{ name: string }>(`/api/rooms/${roomId}`)
      .then((r) => setRoomName(r.name))
      .catch(() => {});
  }, [roomId]);

  // SSE subscription
  useEffect(() => {
    if (!sessionId) return;
    const es = new EventSource(`${BASE}/api/sessions/${sessionId}/stream`, {
      withCredentials: true,
    });

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data as string) as {
          token?: string;
          expiresAt?: string;
          ended?: boolean;
        };
        if (data.ended) {
          router.push('/officer/rooms');
          return;
        }
        if (data.token) setToken(data.token);
        if (data.expiresAt) setExpiresAt(new Date(data.expiresAt));
      } catch {
        // ignore parse errors
      }
    };

    es.onerror = () => {
      // SSE error — could retry; for now close silently
      es.close();
    };

    return () => es.close();
  }, [sessionId, router]);

  // Poll present count every 10s
  useEffect(() => {
    if (!sessionId) return;

    function poll() {
      api
        .get<SessionData>(`/api/sessions/${sessionId}`)
        .then((s) => {
          if (typeof s.present_count === 'number') setPresentCount(s.present_count);
        })
        .catch(() => {});
    }

    poll();
    const id = setInterval(poll, 10_000);
    return () => clearInterval(id);
  }, [sessionId]);

  async function handleEndSession() {
    setEnding(true);
    try {
      await api.post(`/api/sessions/${sessionId}/end`);
    } catch {
      // ignore — session may already be ended
    }
    router.push('/officer/rooms');
  }

  const endAction = (
    <button
      onClick={handleEndSession}
      disabled={ending}
      className="font-label-md text-[12px] text-error border border-error/40 rounded-full
                 px-4 py-1.5 hover:bg-error-container/30 transition-colors disabled:opacity-50"
    >
      {ending ? 'Ending...' : 'End session'}
    </button>
  );

  return (
    <div className="flex flex-col w-full min-h-screen bg-surface">
      <PageHeader back title={roomName || 'Live Session'} action={endAction} />

      <div className="flex flex-col items-center justify-center px-margin pt-24 pb-24 gap-space-lg min-h-screen">

        {/* QR panel */}
        <div className="flex flex-col items-center gap-space-md w-full max-w-xs">
          <div className="bg-white rounded-2xl p-6 shadow-[0_8px_32px_rgba(43,42,38,0.12)] flex flex-col items-center gap-space-sm">
            {token ? (
              <QRCode value={token} size={220} bgColor="#ffffff" fgColor="#1c1c18" />
            ) : (
              <div className="w-[220px] h-[220px] flex items-center justify-center bg-surface-container animate-pulse rounded-lg">
                <span className="material-symbols-outlined text-[40px] text-outline-variant">qr_code_2</span>
              </div>
            )}

            {/* Countdown arc beneath QR */}
            <div className="relative w-[96px] h-[96px] flex items-center justify-center">
              {expiresAt && <CountdownRing expiresAt={expiresAt} />}
              <div className="w-[96px] h-[96px] rounded-full flex items-center justify-center">
                <span className="material-symbols-outlined text-[32px] text-primary">qr_code_scanner</span>
              </div>
            </div>

            <p className="font-label-sm text-[11px] text-on-surface-variant tracking-wide">
              Refreshes every 30 seconds
            </p>
          </div>

          {/* Present count */}
          <div className="flex items-center gap-space-sm bg-primary-fixed/60 rounded-full px-6 py-3">
            <span
              className="material-symbols-outlined text-[24px] text-primary"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              how_to_reg
            </span>
            <span className="font-headline-md text-[20px] text-on-surface font-semibold">
              {presentCount} students present
            </span>
          </div>

          {/* Manual check-in link */}
          <button
            onClick={() => router.push(`/officer/session/${roomId}/live/${sessionId}/manual`)}
            className="flex items-center gap-space-xs font-label-md text-[12px] text-primary
                       hover:text-primary-container transition-colors"
          >
            <span className="material-symbols-outlined text-[18px]">edit_note</span>
            Manual check-in
          </button>

          <p className="font-body-sm text-[12px] text-on-surface-variant text-center">
            Keep this screen on while the session is active
          </p>
        </div>
      </div>
    </div>
  );
}

export default function OfficerLiveQrPage() {
  return (
    <OfficerGuard>
      <LiveQrContent />
    </OfficerGuard>
  );
}
