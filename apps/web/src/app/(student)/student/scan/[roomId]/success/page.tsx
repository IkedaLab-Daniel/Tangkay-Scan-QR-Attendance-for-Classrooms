'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { StudentGuard } from '@/lib/auth';
import { SproutIcon } from '@/components/ui/SproutIcon';

type ScanStatus = 'recorded' | 'already_recorded' | 'flagged' | string;

function headlineFor(status: ScanStatus): string {
  if (status === 'already_recorded') return 'Already marked present ✓';
  if (status === 'flagged') return 'Marked present (under review)';
  return "You're in. Nice and early.";
}

function sublineFor(status: ScanStatus): string {
  if (status === 'flagged') return 'Your attendance is pending teacher review.';
  return 'Your parent has been notified.';
}

function SuccessContent() {
  const { roomId } = useParams<{ roomId: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();

  const status: ScanStatus = searchParams.get('status') ?? 'recorded';
  const [timeStr] = useState(() =>
    new Date().toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' }),
  );
  const [animate, setAnimate] = useState(false);

  // Trigger animation on mount
  useEffect(() => {
    const t = setTimeout(() => setAnimate(true), 50);
    return () => clearTimeout(t);
  }, []);

  // Auto-redirect after 3 seconds
  useEffect(() => {
    const t = setTimeout(() => {
      router.replace('/student/rooms');
    }, 3000);
    return () => clearTimeout(t);
  }, [router]);

  return (
    <div className="fixed inset-0 bg-surface flex flex-col items-center justify-center px-margin gap-6 overflow-hidden">
      {/* Warm background glow */}
      <div className="absolute inset-0 -z-10 pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 h-80 rounded-full bg-primary-fixed/30 blur-3xl" />
      </div>

      {/* Animated sprout + checkmark */}
      <div className={`flex items-center justify-center relative ${animate ? 'animate-sprout' : 'opacity-0'}`}>
        {/* Checkmark circle */}
        <div className="w-24 h-24 rounded-full bg-primary flex items-center justify-center text-on-primary shadow-[0_8px_32px_rgba(18,106,58,0.35)]">
          <span className="material-symbols-outlined text-[40px]" style={{ fontVariationSettings: "'FILL' 1" }}>
            check_circle
          </span>
        </div>
        {/* Sprout on top */}
        <div className="absolute -top-3 -right-3 w-10 h-10 rounded-full bg-primary-fixed flex items-center justify-center shadow-sm">
          <SproutIcon size="sm" className="text-primary w-5 h-5" />
        </div>
      </div>

      {/* Headline */}
      <div className="flex flex-col items-center text-center gap-2 max-w-xs">
        <h1 className="font-headline-lg text-on-surface">{headlineFor(status)}</h1>
        <p className="font-body-sm text-on-surface-variant">{sublineFor(status)}</p>
      </div>

      {/* Time */}
      <div className="flex flex-col items-center gap-1">
        <span className="font-headline-md text-primary">{timeStr}</span>
        <span className="font-label-sm text-on-surface-variant uppercase tracking-wider">Check-in time</span>
      </div>

      {/* Back button */}
      <button
        type="button"
        onClick={() => router.replace('/student/rooms')}
        className="mt-2 px-6 py-3 rounded-full border border-outline text-on-surface font-label-lg flex items-center gap-2 transition-colors hover:bg-surface-container active:scale-[0.98]"
      >
        <span className="material-symbols-outlined text-[18px]">arrow_back</span>
        Back to home
      </button>

      {/* Auto-redirect notice */}
      <p className="font-label-sm text-on-surface-variant">Redirecting in 3 seconds…</p>
    </div>
  );
}

export default function ScanSuccessPage() {
  return (
    <StudentGuard>
      <SuccessContent />
    </StudentGuard>
  );
}
