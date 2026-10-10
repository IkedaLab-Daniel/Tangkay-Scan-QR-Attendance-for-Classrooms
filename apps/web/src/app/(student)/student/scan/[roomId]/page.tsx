'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import jsQR from 'jsqr';
import { StudentGuard } from '@/lib/auth';
import { getDeviceFingerprint } from '@/lib/fingerprint';
import type { AttendanceSession } from '@/lib/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ScanReading {
  lat: number;
  lng: number;
  accuracy: number;
  altitude: number | null;
  speed: number | null;
  heading: number | null;
  timestamp: number;
}

// ─── Scanner content ──────────────────────────────────────────────────────────

function QrScannerContent() {
  const { roomId } = useParams<{ roomId: string }>();
  const router = useRouter();

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);
  const readingsRef = useRef<ScanReading[]>([]);
  const selfieStreamRef = useRef<MediaStream | null>(null);

  const [session, setSession] = useState<AttendanceSession | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [camError, setCamError] = useState<string | null>(null);
  const [selfieMode, setSelfieMode] = useState(false);
  const selfieVideoRef = useRef<HTMLVideoElement>(null);
  const pendingScanToken = useRef<string | null>(null);

  // ── Fetch active session ──────────────────────────────────────────────────

  useEffect(() => {
    async function fetchSession() {
      try {
        const res = await fetch(`${API_URL}/api/sessions/active?roomId=${roomId}`, {
          credentials: 'include',
        });
        if (!res.ok) {
          setError('No active session for this room.');
          return;
        }
        const data: AttendanceSession = await res.json();
        setSession(data);
      } catch {
        setError('Could not connect to server.');
      } finally {
        setSessionLoading(false);
      }
    }
    fetchSession();
  }, [roomId]);

  // ── GPS watchPosition ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!navigator.geolocation) return;
    const wid = navigator.geolocation.watchPosition(
      (pos) => {
        readingsRef.current.push({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          altitude: pos.coords.altitude,
          speed: pos.coords.speed,
          heading: pos.coords.heading,
          timestamp: pos.timestamp,
        });
        // Cap at 10
        if (readingsRef.current.length > 10) {
          readingsRef.current = readingsRef.current.slice(-10);
        }
      },
      () => {},
      { enableHighAccuracy: true },
    );
    return () => navigator.geolocation.clearWatch(wid);
  }, []);

  // ── Camera + QR decode loop ───────────────────────────────────────────────

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch {
      setCamError('Camera permission denied. Please allow camera access and reload.');
    }
  }, []);

  const stopCamera = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  // ── Submit scan ───────────────────────────────────────────────────────────

  const handleScan = useCallback(
    async (token: string, photoDataUrl?: string) => {
      if (scanning || !session) return;
      setScanning(true);

      const formData = new FormData();
      formData.append('token', token);
      formData.append('readings', JSON.stringify(readingsRef.current.slice(0, 10)));
      formData.append('client_time', String(Date.now()));
      formData.append('device_fingerprint', getDeviceFingerprint());

      if (photoDataUrl) {
        // Convert dataUrl → Blob
        const res = await fetch(photoDataUrl);
        const blob = await res.blob();
        formData.append('selfie', blob, 'selfie.jpg');
      }

      try {
        const res = await fetch(`${API_URL}/api/sessions/${session.id}/scan`, {
          method: 'POST',
          credentials: 'include',
          body: formData,
        });
        const data = await res.json();
        if (
          data.status === 'recorded' ||
          data.status === 'flagged' ||
          data.status === 'already_recorded'
        ) {
          stopCamera();
          router.push(`/student/scan/${roomId}/success?status=${data.status}`);
        } else {
          setError(data.reason ?? 'Scan failed. Please try again.');
          setScanning(false);
        }
      } catch {
        setError('Network error. Please try again.');
        setScanning(false);
      }
    },
    [scanning, session, roomId, router, stopCamera],
  );

  // ── Selfie capture ────────────────────────────────────────────────────────

  const captureSelfie = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
      });
      selfieStreamRef.current = stream;
      if (selfieVideoRef.current) {
        selfieVideoRef.current.srcObject = stream;
        await selfieVideoRef.current.play();
      }

      // Auto-capture after 1.5s
      setTimeout(() => {
        const canvas = document.createElement('canvas');
        const vid = selfieVideoRef.current;
        if (vid) {
          canvas.width = vid.videoWidth || 640;
          canvas.height = vid.videoHeight || 480;
          canvas.getContext('2d')?.drawImage(vid, 0, 0);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
          // Stop selfie stream
          stream.getTracks().forEach((t) => t.stop());
          selfieStreamRef.current = null;
          setSelfieMode(false);
          if (pendingScanToken.current) {
            handleScan(pendingScanToken.current, dataUrl);
            pendingScanToken.current = null;
          }
        }
      }, 1500);
    } catch {
      // Selfie not available — submit without it
      setSelfieMode(false);
      if (pendingScanToken.current) {
        handleScan(pendingScanToken.current);
        pendingScanToken.current = null;
      }
    }
  }, [handleScan]);

  // ── rAF decode loop ───────────────────────────────────────────────────────

  useEffect(() => {
    if (sessionLoading || !session || camError) return;

    let active = true;

    async function init() {
      await startCamera();
      if (!active) return;

      function tick() {
        if (!active) return;
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (!video || !canvas || video.readyState < video.HAVE_ENOUGH_DATA) {
          rafRef.current = requestAnimationFrame(tick);
          return;
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          rafRef.current = requestAnimationFrame(tick);
          return;
        }
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'dontInvert',
        });

        if (code && code.data && !scanning) {
          // QR found — decide selfie
          const needsSelfie = false; // room selfie_policy check would go here
          if (needsSelfie) {
            pendingScanToken.current = code.data;
            setSelfieMode(true);
            stopCamera();
            captureSelfie();
          } else {
            handleScan(code.data);
          }
          return;
        }

        rafRef.current = requestAnimationFrame(tick);
      }

      rafRef.current = requestAnimationFrame(tick);
    }

    init();

    return () => {
      active = false;
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionLoading, session, camError]);

  // ── Render ────────────────────────────────────────────────────────────────

  if (sessionLoading) {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-white/30 border-t-white animate-spin" />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black overflow-hidden">
      {/* Camera feed */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-cover"
        playsInline
        muted
      />
      <canvas ref={canvasRef} className="hidden" />

      {/* Selfie overlay */}
      {selfieMode && (
        <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center z-30 gap-4">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video
            ref={selfieVideoRef}
            className="w-64 h-64 rounded-full object-cover border-4 border-white"
            playsInline
            muted
          />
          <p className="text-white font-label-lg">Hold still — capturing selfie…</p>
        </div>
      )}

      {/* Dark overlay with viewfinder cutout */}
      {!selfieMode && (
        <div className="absolute inset-0 z-10 pointer-events-none">
          {/* Semi-transparent overlays around the cutout */}
          <div className="absolute inset-0 bg-black/55" style={{
            clipPath: 'polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, calc(50% - 30vw) calc(50% - 30vw), calc(50% - 30vw) calc(50% + 30vw), calc(50% + 30vw) calc(50% + 30vw), calc(50% + 30vw) calc(50% - 30vw), calc(50% - 30vw) calc(50% - 30vw))',
          }} />

          {/* Corner tick marks */}
          <div className="absolute" style={{
            left: 'calc(50% - 30vw)',
            top: 'calc(50% - 30vw)',
            width: '60vw',
            height: '60vw',
          }}>
            {/* Top-left */}
            <div className="absolute top-0 left-0 w-6 h-6 border-t-[3px] border-l-[3px] border-primary rounded-tl-lg" />
            {/* Top-right */}
            <div className="absolute top-0 right-0 w-6 h-6 border-t-[3px] border-r-[3px] border-primary rounded-tr-lg" />
            {/* Bottom-left */}
            <div className="absolute bottom-0 left-0 w-6 h-6 border-b-[3px] border-l-[3px] border-primary rounded-bl-lg" />
            {/* Bottom-right */}
            <div className="absolute bottom-0 right-0 w-6 h-6 border-b-[3px] border-r-[3px] border-primary rounded-br-lg" />
          </div>

          {/* Instruction text below viewfinder */}
          <p className="absolute text-white text-center font-label-lg px-8"
            style={{ top: 'calc(50% + 30vw + 24px)', left: 0, right: 0 }}>
            Point your camera at your class officer&apos;s QR screen
          </p>
        </div>
      )}

      {/* Fixed header */}
      <div className="absolute top-0 left-0 right-0 z-20 flex items-center gap-3 px-4 pt-safe h-16 bg-gradient-to-b from-black/70 to-transparent">
        <button
          onClick={() => { stopCamera(); router.back(); }}
          className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white"
          aria-label="Go back"
        >
          <span className="material-symbols-outlined" style={{ fontSize: 22 }}>arrow_back</span>
        </button>
        <div className="flex flex-col min-w-0">
          <span className="text-white font-label-lg">Scan QR Code</span>
          {session && (
            <span className="text-white/70 font-label-sm truncate">Session active</span>
          )}
        </div>
      </div>

      {/* Error / status overlays */}
      {(error || camError) && (
        <div className="absolute bottom-24 left-4 right-4 z-20 bg-error-container text-on-error-container rounded-xl px-4 py-3 font-label-md text-center">
          {camError ?? error}
          {error && (
            <button
              className="mt-2 block w-full text-center font-label-md underline"
              onClick={() => { setError(null); setScanning(false); }}
            >
              Try again
            </button>
          )}
        </div>
      )}

      {!session && !sessionLoading && !error && (
        <div className="absolute bottom-24 left-4 right-4 z-20 bg-surface-container text-on-surface rounded-xl px-4 py-3 font-label-md text-center">
          No active session for this room.
        </div>
      )}

      {scanning && (
        <div className="absolute inset-0 z-30 bg-black/60 flex flex-col items-center justify-center gap-3">
          <div className="w-10 h-10 rounded-full border-2 border-primary/40 border-t-primary animate-spin" />
          <p className="text-white font-label-lg">Submitting…</p>
        </div>
      )}
    </div>
  );
}

export default function ScanPage() {
  return (
    <StudentGuard>
      <QrScannerContent />
    </StudentGuard>
  );
}
