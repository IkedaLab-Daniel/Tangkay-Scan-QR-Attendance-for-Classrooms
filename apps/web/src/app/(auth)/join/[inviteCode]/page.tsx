'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { SproutIcon, Spinner, EmptyState } from '@/components/ui';
import { api } from '@/lib/api';

interface RoomPreview {
  id: string;
  name: string;
  teacherName: string;
  roomNumber?: string;
}

export default function JoinRoomPage() {
  const { inviteCode } = useParams<{ inviteCode: string }>();
  const router = useRouter();

  const [room, setRoom] = useState<RoomPreview | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [checking, setChecking] = useState(true);

  // Form state
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState('');

  // Join code fallback
  const [joinCodeOpen, setJoinCodeOpen] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [codeLoading, setCodeLoading] = useState(false);
  const [codeError, setCodeError] = useState('');

  useEffect(() => {
    // Check if already authenticated as a student
    api
      .get<{ id: string; typ: string; roomIds?: string[] }>('/api/auth/student/me')
      .then(async (me) => {
        if (me?.typ === 'student') {
          // Fetch the room first to get its id
          try {
            const preview = await api.get<RoomPreview>(`/api/rooms/join/${inviteCode}`);
            if (me.roomIds?.includes(preview.id)) {
              router.replace('/student/rooms');
            } else {
              // Already logged in but not a member — skip magic link, join directly
              await api.post(`/api/rooms/${preview.id}/join`);
              router.replace(`/student/consent/${preview.id}`);
            }
          } catch {
            // Room not found or join failed — fall through to normal flow
          }
        }
      })
      .catch(() => {/* not authenticated */})
      .finally(() => {
        // Whether auth check succeeded or not, still load the room preview
        api
          .get<RoomPreview>(`/api/rooms/join/${inviteCode}`)
          .then((r) => setRoom(r))
          .catch(() => setNotFound(true))
          .finally(() => setChecking(false));
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inviteCode]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) {
      setFormError('Name must be at least 2 characters.');
      return;
    }
    setFormError('');
    setFormLoading(true);
    try {
      // Store email + inviteCode so check-email page can resend and post-verify can pick up the room
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('ts_pending_invite', inviteCode);
        sessionStorage.setItem('ts_magic_email', email);
      }
      await api.post('/api/auth/student/request-link', { name, email, inviteCode });
      router.push('/join/check-email');
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Something went wrong. Try again.');
    } finally {
      setFormLoading(false);
    }
  }

  async function handleVerifyCode(e: React.FormEvent) {
    e.preventDefault();
    setCodeError('');
    setCodeLoading(true);
    try {
      await api.post('/api/auth/student/verify-code', { joinCode, inviteCode });
      router.replace('/student/rooms');
    } catch (err: unknown) {
      setCodeError(err instanceof Error ? err.message : 'Invalid or expired code.');
    } finally {
      setCodeLoading(false);
    }
  }

  if (checking) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <Spinner />
        <p className="font-body-md text-on-surface-variant">Loading room…</p>
      </div>
    );
  }

  if (notFound) {
    return (
      <EmptyState
        title="Room not found"
        description="This invite link is invalid or has expired."
        action={{ label: 'Go home', onClick: () => router.replace('/welcome') }}
      />
    );
  }

  return (
    <div className="w-full max-w-[400px] flex flex-col items-center gap-space-lg mx-auto">
      {/* Sprout icon */}
      <div className="flex items-center justify-center w-16 h-16 rounded-full bg-primary-fixed shadow-sm">
        <SproutIcon size="lg" className="text-primary" />
      </div>

      {/* Room preview card */}
      {room && (
        <div className="w-full bg-surface-container-lowest rounded-xl shadow-sm p-space-md flex items-center gap-space-md border border-outline-variant/30">
          <div className="w-10 h-10 rounded-full bg-surface-container flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-primary" style={{ fontSize: 20 }}>
              meeting_room
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-headline-md text-on-surface truncate">{room.name}</h2>
            <p className="font-body-md text-on-surface-variant truncate">{room.teacherName}</p>
          </div>
          {room.roomNumber && (
            <span className="font-label-sm text-on-surface-variant bg-surface-container px-2 py-1 rounded-lg shrink-0">
              {room.roomNumber}
            </span>
          )}
        </div>
      )}

      {/* Heading */}
      <div className="w-full text-center">
        <h1 className="font-headline-xl-mobile text-on-surface">
          Join {room?.name ?? 'Room'}
        </h1>
        <p className="font-body-md text-on-surface-variant mt-1">
          Enter your name and email to receive a sign-in link.
        </p>
      </div>

      {/* Registration form */}
      <form onSubmit={handleSubmit} className="w-full flex flex-col gap-space-md">
        {/* Name */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="student-name" className="font-label-md text-on-surface-variant">
            Your name
          </label>
          <div className="relative flex items-center">
            <span
              className="material-symbols-outlined text-outline absolute left-3.5 pointer-events-none"
              style={{ fontSize: 20 }}
            >
              person
            </span>
            <input
              id="student-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Maria Santos"
              required
              minLength={2}
              className="w-full h-12 pl-11 pr-4 bg-surface-container-low text-on-surface placeholder:text-outline rounded-xl font-sans text-body-md border border-outline-variant outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </div>
        </div>

        {/* Email */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="student-email" className="font-label-md text-on-surface-variant">
            Email for sign-in link
          </label>
          <div className="relative flex items-center">
            <span
              className="material-symbols-outlined text-outline absolute left-3.5 pointer-events-none"
              style={{ fontSize: 20 }}
            >
              mark_email_read
            </span>
            <input
              id="student-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              required
              className="w-full h-12 pl-11 pr-4 bg-surface-container-low text-on-surface placeholder:text-outline rounded-xl font-sans text-body-md border border-outline-variant outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <p className="font-body-sm text-on-surface-variant">
            A magic link will be sent here. You can use a parent&apos;s email.
          </p>
        </div>

        {formError && <p className="font-body-sm text-error">{formError}</p>}

        <button
          type="submit"
          disabled={formLoading}
          className="w-full h-14 bg-primary text-on-primary rounded-full font-label-lg shadow-sm hover:opacity-95 active:scale-[0.99] transition-all flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed mt-space-xs"
        >
          {formLoading ? (
            <Spinner className="text-on-primary" />
          ) : (
            <>
              <span>Send sign-in link</span>
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                arrow_forward
              </span>
            </>
          )}
        </button>
      </form>

      {/* Join code fallback */}
      <div className="w-full">
        <button
          type="button"
          onClick={() => setJoinCodeOpen((v) => !v)}
          className="w-full font-body-md text-primary text-center py-2 hover:opacity-80 transition-opacity focus:outline-none"
        >
          Have a join code from your teacher?
        </button>

        {joinCodeOpen && (
          <form
            onSubmit={handleVerifyCode}
            className="mt-space-sm bg-surface-container-low rounded-xl p-space-md flex flex-col gap-space-md border border-outline-variant/30"
          >
            <div className="flex flex-col gap-1.5">
              <label htmlFor="join-code" className="font-label-md text-on-surface-variant">
                Join code
              </label>
              <input
                id="join-code"
                type="text"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                maxLength={6}
                placeholder="123456"
                className="w-full h-12 px-4 bg-surface-container-lowest text-on-surface placeholder:text-outline rounded-xl font-sans text-body-md text-center tracking-widest border border-outline-variant outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
            </div>
            {codeError && <p className="font-body-sm text-error">{codeError}</p>}
            <button
              type="submit"
              disabled={codeLoading || joinCode.length < 4}
              className="w-full h-11 bg-primary-fixed text-on-primary-fixed rounded-full font-label-lg transition-all hover:opacity-90 active:scale-[0.99] flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {codeLoading ? <Spinner /> : 'Verify code'}
            </button>
          </form>
        )}
      </div>

      {/* Trust note */}
      <p className="font-body-sm text-on-surface-variant text-center pb-space-sm">
        <span className="material-symbols-outlined align-middle mr-1" style={{ fontSize: 14 }}>
          verified_user
        </span>
        Protected by the Data Privacy Act of 2012
      </p>
    </div>
  );
}
