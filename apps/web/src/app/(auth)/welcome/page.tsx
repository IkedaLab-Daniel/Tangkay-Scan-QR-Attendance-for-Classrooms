'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { SproutIcon } from '@/components/ui';
import { useAuth } from '@/lib/auth';

export default function WelcomePage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  // Redirect if already authenticated
  useEffect(() => {
    if (!loading && user?.typ === 'teacher') router.replace('/teacher/rooms');
    if (!loading && user?.typ === 'student') router.replace('/student/rooms');
  }, [user, loading, router]);

  return (
    <div className="min-h-dvh w-full bg-background flex flex-col items-center justify-center px-margin py-space-xl pt-safe pb-safe">
      {/* Brand header */}
      <header className="flex flex-col items-center text-center mb-space-xl">
        <div className="relative flex items-center justify-center w-16 h-16 rounded-full bg-tertiary-fixed/30 mb-space-md shadow-sm">
          <SproutIcon size="lg" className="text-primary" />
          <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-primary-fixed flex items-center justify-center">
            <span className="w-1.5 h-1.5 rounded-full bg-primary" />
          </div>
        </div>
        <div className="flex items-center gap-1.5 mb-space-xs">
          <h1 className="font-headline-xl-mobile text-on-surface tracking-tight">Tangkay Scan</h1>
          <span className="bg-primary-fixed/50 text-on-primary-fixed text-[11px] font-label-sm px-2 py-0.5 rounded-full">
            v1.2
          </span>
        </div>
        <p className="font-body-md text-on-surface-variant max-w-xs">
          Attendance that takes a minute.
        </p>
      </header>

      {/* Role picker */}
      <section className="w-full max-w-[360px] flex flex-col gap-space-md">
        <p className="font-label-md text-on-surface-variant text-center mb-space-xs">
          How are you using TangkayScan?
        </p>

        <Link
          href="/auth/teacher"
          className="w-full bg-primary text-on-primary py-4 px-6 rounded-full font-label-lg text-[14px] shadow-sm hover:opacity-95 active:scale-[0.99] transition-all flex items-center justify-center gap-2"
        >
          <span className="material-symbols-outlined text-[18px] leading-none">school</span>
          <span>I&apos;m a Teacher</span>
          <span className="material-symbols-outlined text-[16px] leading-none ml-auto">arrow_forward</span>
        </Link>

        <Link
          href="/auth/student"
          className="w-full bg-surface-container-lowest text-on-surface py-4 px-6 rounded-full font-label-lg text-[14px] shadow-sm border border-outline-variant hover:bg-surface-container active:scale-[0.99] transition-all flex items-center justify-center gap-2"
        >
          <span className="material-symbols-outlined text-[18px] leading-none text-secondary">person</span>
          <span>I&apos;m a Student</span>
          <span className="material-symbols-outlined text-[16px] leading-none ml-auto text-on-surface-variant">arrow_forward</span>
        </Link>
      </section>
    </div>
  );
}
