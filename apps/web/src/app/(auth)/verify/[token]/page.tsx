'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { SproutIcon, Spinner } from '@/components/ui';
import { api } from '@/lib/api';

type Status = 'loading' | 'success' | 'error';

export default function VerifyTokenPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const [status, setStatus] = useState<Status>('loading');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    async function verify() {
      try {
        await api.get(`/api/auth/student/verify/${token}`);

        // Check for a pending invite stored before the magic link was requested
        let pendingInvite: string | null = null;
        if (typeof window !== 'undefined') {
          pendingInvite = sessionStorage.getItem('ts_pending_invite');
        }

        if (pendingInvite) {
          try {
            // Resolve the invite code to a room id, then join
            const preview = await api.get<{ id: string }>(`/api/rooms/join/${pendingInvite}`);
            await api.post(`/api/rooms/${preview.id}/join`);
            sessionStorage.removeItem('ts_pending_invite');
            sessionStorage.removeItem('ts_magic_email');
            router.replace(`/student/consent/${preview.id}`);
          } catch {
            // If join fails (e.g. already a member), fall through to rooms list
            sessionStorage.removeItem('ts_pending_invite');
            sessionStorage.removeItem('ts_magic_email');
            router.replace('/student/rooms');
          }
        } else {
          setStatus('success');
          router.replace('/student/rooms');
        }
      } catch (err: unknown) {
        setErrorMsg(err instanceof Error ? err.message : 'This link has expired or is invalid.');
        setStatus('error');
      }
    }

    verify();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <div className="w-full max-w-[400px] flex flex-col items-center gap-space-lg mx-auto text-center">
      {/* Sprout icon */}
      <div className="flex items-center justify-center w-16 h-16 rounded-full bg-primary-fixed shadow-sm">
        <SproutIcon size="lg" className="text-primary" />
      </div>

      {status === 'loading' && (
        <>
          <Spinner className="w-8 h-8" />
          <p className="font-body-md text-on-surface-variant">Signing you in…</p>
        </>
      )}

      {status === 'error' && (
        <div className="flex flex-col items-center gap-space-md w-full">
          <div className="w-full bg-error-container rounded-xl p-space-md text-left">
            <div className="flex items-start gap-space-sm">
              <span
                className="material-symbols-outlined text-on-error-container shrink-0 mt-0.5"
                style={{ fontSize: 20 }}
              >
                error
              </span>
              <div>
                <p className="font-label-lg text-on-error-container font-semibold">Link expired</p>
                <p className="font-body-sm text-on-error-container mt-0.5">
                  {errorMsg}
                </p>
              </div>
            </div>
          </div>

          {/* Request a new link — back to the join page if we have an invite code */}
          <RequestNewLinkButton />
        </div>
      )}
    </div>
  );
}

function RequestNewLinkButton() {
  const router = useRouter();
  const [inviteCode, setInviteCode] = React.useState('');

  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      setInviteCode(sessionStorage.getItem('ts_pending_invite') ?? '');
    }
  }, []);

  if (inviteCode) {
    return (
      <Link
        href={`/join/${inviteCode}`}
        className="w-full h-11 border border-outline-variant rounded-full font-label-lg text-on-surface hover:bg-surface-container active:scale-[0.99] transition-all flex items-center justify-center gap-2"
      >
        Request a new link
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={() => router.replace('/welcome')}
      className="w-full h-11 border border-outline-variant rounded-full font-label-lg text-on-surface hover:bg-surface-container active:scale-[0.99] transition-all flex items-center justify-center gap-2"
    >
      Request a new link
    </button>
  );
}
