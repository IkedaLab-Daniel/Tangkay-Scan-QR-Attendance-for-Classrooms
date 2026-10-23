'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { SproutIcon, Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

type Status = 'verifying' | 'success' | 'error';

export default function VerifyEmailPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const { refresh } = useAuth();
  const [status, setStatus] = useState<Status>('verifying');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    async function verify() {
      try {
        await api.get(`/api/auth/student/verify-email/${token}`);
        await refresh();
        setStatus('success');
        setTimeout(() => router.replace('/student/rooms'), 1500);
      } catch (err: unknown) {
        setErrorMsg(err instanceof Error ? err.message : 'Invalid or expired link.');
        setStatus('error');
      }
    }
    verify();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <div className="min-h-dvh w-full bg-background flex flex-col items-center justify-center px-margin py-space-xl pt-safe pb-safe">
      {/* Brand header */}
      <header className="flex flex-col items-center text-center mb-space-xl">
        <div className="relative flex items-center justify-center w-16 h-16 rounded-full bg-tertiary-fixed/30 mb-space-md shadow-sm">
          <SproutIcon size="lg" className="text-primary" />
        </div>
        <h1 className="font-headline-xl-mobile text-on-surface tracking-tight">Tangkay Scan</h1>
      </header>

      <div className="w-full max-w-[360px] bg-surface-container-lowest rounded-xl shadow-card p-space-lg flex flex-col items-center gap-space-md text-center">
        {status === 'verifying' && (
          <>
            <Spinner />
            <p className="font-body-md text-on-surface-variant">Verifying your email…</p>
          </>
        )}

        {status === 'success' && (
          <>
            <div className="w-14 h-14 rounded-full bg-primary-fixed flex items-center justify-center">
              <span
                className="material-symbols-outlined text-primary"
                style={{ fontSize: 28, fontVariationSettings: "'FILL' 1" }}
              >
                check_circle
              </span>
            </div>
            <div>
              <h2 className="font-headline-md text-on-surface">Email verified!</h2>
              <p className="font-body-md text-on-surface-variant mt-1">Taking you to your dashboard…</p>
            </div>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="w-14 h-14 rounded-full bg-error-container flex items-center justify-center">
              <span
                className="material-symbols-outlined text-error"
                style={{ fontSize: 28 }}
              >
                error
              </span>
            </div>
            <div>
              <h2 className="font-headline-md text-on-surface">Link invalid</h2>
              <p className="font-body-md text-on-surface-variant mt-1">{errorMsg}</p>
            </div>
            <Link
              href="/auth/student"
              className="w-full h-11 border border-outline-variant rounded-full font-label-lg text-on-surface hover:bg-surface-container active:scale-[0.99] transition-all flex items-center justify-center gap-2"
            >
              Back to sign in
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
