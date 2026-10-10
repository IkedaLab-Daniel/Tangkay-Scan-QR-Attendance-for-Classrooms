'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { SproutIcon, Spinner } from '@/components/ui';
import { api } from '@/lib/api';

export default function CheckEmailPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [resendLoading, setResendLoading] = useState(false);
  const [resendError, setResendError] = useState('');
  const [resendSent, setResendSent] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setEmail(sessionStorage.getItem('ts_magic_email') ?? '');
      setInviteCode(sessionStorage.getItem('ts_pending_invite') ?? '');
    }
  }, []);

  async function handleResend() {
    if (!email) return;
    setResendError('');
    setResendLoading(true);
    try {
      await api.post('/api/auth/student/request-link', { email, inviteCode });
      setResendSent(true);
      setTimeout(() => setResendSent(false), 4000);
    } catch (err: unknown) {
      setResendError(err instanceof Error ? err.message : 'Could not resend. Try again.');
    } finally {
      setResendLoading(false);
    }
  }

  return (
    <div className="w-full max-w-[400px] flex flex-col items-center gap-space-lg mx-auto text-center">
      {/* Sprout icon */}
      <div className="flex items-center justify-center w-16 h-16 rounded-full bg-primary-fixed shadow-sm">
        <SproutIcon size="lg" className="text-primary" />
      </div>

      {/* Heading */}
      <div className="flex flex-col gap-2">
        <h1 className="font-headline-xl-mobile text-on-surface">Check your email!</h1>
        <p className="font-body-md text-on-surface-variant">
          We sent a sign-in link to{' '}
          {email ? (
            <span className="font-semibold text-on-surface">{email}</span>
          ) : (
            'your email address'
          )}
          . Tap the link in the email to continue.
        </p>
      </div>

      {/* Expiry note */}
      <div className="w-full bg-surface-container-low rounded-xl p-space-md text-left border border-outline-variant/30">
        <div className="flex items-start gap-space-sm">
          <span
            className="material-symbols-outlined text-outline shrink-0 mt-0.5"
            style={{ fontSize: 18 }}
          >
            schedule
          </span>
          <p className="font-body-sm text-on-surface-variant">
            The link expires in <strong className="text-on-surface">15 minutes</strong>. Check
            your spam or junk folder if you don&apos;t see it.
          </p>
        </div>
      </div>

      {/* Resend button */}
      {resendError && <p className="font-body-sm text-error w-full text-left">{resendError}</p>}
      {resendSent && (
        <p className="font-body-sm text-primary w-full text-left">
          ✓ A new link was sent.
        </p>
      )}
      <button
        type="button"
        onClick={handleResend}
        disabled={resendLoading}
        className="w-full h-11 border border-outline-variant rounded-full font-label-lg text-on-surface hover:bg-surface-container active:scale-[0.99] transition-all flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {resendLoading ? <Spinner /> : 'Resend link'}
      </button>

      {/* Back link */}
      {inviteCode ? (
        <Link
          href={`/join/${inviteCode}`}
          className="font-body-md text-on-surface-variant hover:text-primary transition-colors"
        >
          Wrong email? Go back
        </Link>
      ) : (
        <button
          type="button"
          onClick={() => router.back()}
          className="font-body-md text-on-surface-variant hover:text-primary transition-colors focus:outline-none"
        >
          Wrong email? Go back
        </button>
      )}
    </div>
  );
}
