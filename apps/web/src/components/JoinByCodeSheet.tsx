'use client';

import React, { useState } from 'react';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Spinner } from '@/components/ui';
import { api } from '@/lib/api';

interface RoomPreview {
  roomId: string;
  roomName: string;
  teacherName: string;
}

export interface JoinByCodeSheetProps {
  open: boolean;
  onClose: () => void;
  /** Called after a successful join, before the caller navigates to consent. */
  onJoined: (roomId: string) => void;
}

type Step = 'input' | 'preview';

export function JoinByCodeSheet({ open, onClose, onJoined }: JoinByCodeSheetProps) {
  const [step, setStep] = useState<Step>('input');
  const [code, setCode] = useState('');
  const [preview, setPreview] = useState<RoomPreview | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState('');
  const [joinLoading, setJoinLoading] = useState(false);
  const [joinError, setJoinError] = useState('');

  function handleClose() {
    // Reset state on close
    setStep('input');
    setCode('');
    setPreview(null);
    setLookupError('');
    setJoinError('');
    onClose();
  }

  function handleBack() {
    setStep('input');
    setPreview(null);
    setLookupError('');
    setJoinError('');
  }

  async function handleLookup(e: React.FormEvent) {
    e.preventDefault();
    if (code.trim().length < 1) return;
    setLookupError('');
    setLookupLoading(true);
    try {
      const room = await api.get<RoomPreview>(`/api/rooms/join/${code.trim()}`);
      setPreview(room);
      setStep('preview');
    } catch {
      setLookupError('Room not found. Check the ID and try again.');
    } finally {
      setLookupLoading(false);
    }
  }

  async function handleJoin() {
    if (!preview) return;
    setJoinError('');
    setJoinLoading(true);
    try {
      await api.post(`/api/rooms/${preview.roomId}/join`);
      onJoined(preview.roomId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Something went wrong.';
      if (msg.toLowerCase().includes('already')) {
        // Already a member — navigate them in
        onJoined(preview.roomId);
      } else {
        setJoinError(msg);
      }
    } finally {
      setJoinLoading(false);
    }
  }

  return (
    <BottomSheet open={open} onClose={handleClose} title="Join a Class">
      <div className="px-5 pb-8 pt-2 flex flex-col gap-space-md">

        {step === 'input' && (
          <form onSubmit={handleLookup} className="flex flex-col gap-space-md">
            <p className="font-body-md text-on-surface-variant">
              Enter the 8-character Room ID from your teacher.
            </p>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="join-room-id" className="font-label-md text-on-surface-variant">
                Room ID
              </label>
              <input
                id="join-room-id"
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                maxLength={8}
                placeholder="aB3x-K9m"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="w-full h-12 px-4 bg-surface-container-low text-on-surface placeholder:text-outline rounded-xl font-mono text-body-md text-center tracking-widest border border-outline-variant outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
            </div>

            {lookupError && (
              <p className="font-body-sm text-error flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[16px]">error</span>
                {lookupError}
              </p>
            )}

            <button
              type="submit"
              disabled={lookupLoading || code.trim().length < 1}
              className="w-full h-14 bg-primary text-on-primary rounded-full font-label-lg shadow-sm hover:opacity-95 active:scale-[0.99] transition-all flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {lookupLoading ? <Spinner className="text-on-primary" /> : 'Look up'}
            </button>
          </form>
        )}

        {step === 'preview' && preview && (
          <div className="flex flex-col gap-space-md">
            {/* Room preview card */}
            <div className="w-full bg-surface-container rounded-xl p-space-md flex items-center gap-space-md border border-outline-variant/30">
              <div className="w-10 h-10 rounded-full bg-surface-container-high flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-primary" style={{ fontSize: 20 }}>
                  meeting_room
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="font-headline-sm text-on-surface truncate">{preview.roomName}</h3>
                <p className="font-body-md text-on-surface-variant truncate flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px]">school</span>
                  {preview.teacherName}
                </p>
              </div>
            </div>

            {joinError && (
              <p className="font-body-sm text-error flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[16px]">error</span>
                {joinError}
              </p>
            )}

            <button
              type="button"
              onClick={handleJoin}
              disabled={joinLoading}
              className="w-full h-14 bg-primary text-on-primary rounded-full font-label-lg shadow-sm hover:opacity-95 active:scale-[0.99] transition-all flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {joinLoading ? <Spinner className="text-on-primary" /> : `Join ${preview.roomName}`}
            </button>

            <button
              type="button"
              onClick={handleBack}
              className="w-full text-center font-body-md text-primary py-2 hover:opacity-80 transition-opacity"
            >
              ← Try a different code
            </button>
          </div>
        )}

      </div>
    </BottomSheet>
  );
}
