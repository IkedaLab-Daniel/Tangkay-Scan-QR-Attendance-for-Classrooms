'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Badge, BadgeVariant } from '@/components/ui/Badge';
import { Room } from '@/lib/types';

// Tint colours cycled by card index (green → oat → peach)
const CARD_TINTS = ['#ddf0df', '#f1ebe0', '#ffe8df'] as const;

function getCardTint(index: number): string {
  return CARD_TINTS[index % CARD_TINTS.length];
}

function modeVariant(mode: string): BadgeVariant {
  if (mode === 'strict') return 'strict';
  if (mode === 'static') return 'static';
  return 'balanced';
}

function formatLastSession(value?: string | null): string {
  if (!value) return 'No sessions yet';
  const d = new Date(value);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (diffDays === 0) {
    return `Today, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  }
  if (diffDays === 1) {
    return `Yesterday, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

interface RoomCardProps {
  room: Room;
  index: number;
  onDelete?: (id: string) => void;
  onStartSession?: (id: string) => void;
}

export function RoomCard({ room, index, onDelete, onStartSession }: RoomCardProps) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const tint = getCardTint(index);
  const isActive = room.status === 'active';

  function handleCardClick() {
    router.push(`/teacher/rooms/${room.id}`);
  }

  function handleQrClick(e: React.MouseEvent) {
    e.stopPropagation();
    router.push(`/officer/session/${room.id}/start`);
  }

  function handleMenuClick(e: React.MouseEvent) {
    e.stopPropagation();
    setMenuOpen(true);
  }

  const modeLabel = room.attendance_mode.charAt(0).toUpperCase() + room.attendance_mode.slice(1);

  return (
    <>
      <article
        onClick={handleCardClick}
        style={{ backgroundColor: tint }}
        className="relative flex flex-col rounded-xl p-space-md shadow-sm
                   transition-all duration-200 active:scale-[0.99] cursor-pointer"
      >
        {/* Top row */}
        <div className="flex items-start justify-between gap-space-sm mb-space-sm">
          <div className="flex flex-col min-w-0">
            {/* Badges row */}
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <Badge variant={modeVariant(room.attendance_mode)} label={modeLabel} dot={isActive} />
              {room.status === 'active' && (
                <span className="px-2 py-0.5 rounded-full bg-surface-container-lowest/80 text-primary font-label-sm text-[11px] flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px]">verified</span>
                  Active
                </span>
              )}
            </div>

            {/* Room name */}
            <h3 className="font-headline-sm text-on-surface truncate">{room.name}</h3>

            {/* Subject / room number */}
            <p className="font-body-sm text-[12px] text-tertiary mt-0.5">
              {room.subject && `${room.subject}`}
              {room.subject && room.room_number && ' · '}
              {room.room_number && `Rm ${room.room_number}`}
            </p>
          </div>

          {/* Three-dot menu */}
          <button
            aria-label="Room options"
            onClick={handleMenuClick}
            className="w-8 h-8 flex items-center justify-center rounded-full
                       hover:bg-surface-container-lowest/50 text-on-surface-variant transition-colors shrink-0"
          >
            <span className="material-symbols-outlined text-[20px]">more_vert</span>
          </button>
        </div>

        {/* Divider */}
        <div className="w-full h-px bg-on-surface/5 my-1" />

        {/* Footer */}
        <div className="flex items-center justify-between pt-space-xs">
          <div className="flex items-center gap-space-md text-on-surface-variant font-body-sm text-[12px]">
            {/* Student count */}
            <div className="flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[18px] text-primary">groups</span>
              <span className="font-label-md text-[12px] text-on-surface">
                {room.student_count ?? 0} students
              </span>
            </div>

            {/* Last session */}
            <div className="flex items-center gap-1 text-tertiary">
              <span className="material-symbols-outlined text-[16px]">schedule</span>
              <span>{formatLastSession(room.last_session_at)}</span>
            </div>
          </div>

          {/* QR scan button */}
          <button
            aria-label="Quick scan QR"
            onClick={handleQrClick}
            className="flex items-center justify-center w-9 h-9 rounded-full
                       bg-surface-container-lowest text-primary shadow-sm
                       hover:bg-primary hover:text-on-primary transition-all"
          >
            <span className="material-symbols-outlined text-[20px]">qr_code_scanner</span>
          </button>
        </div>
      </article>

      {/* Options bottom sheet */}
      <BottomSheet open={menuOpen} onClose={() => setMenuOpen(false)} title={room.name}>
        <div className="flex flex-col px-5 pb-6 gap-1">
          <button
            onClick={() => { setMenuOpen(false); router.push(`/teacher/rooms/${room.id}`); }}
            className="flex items-center gap-3 w-full py-3.5 rounded-xl text-on-surface
                       hover:bg-surface-container transition-colors font-label-lg text-[14px]"
          >
            <span className="material-symbols-outlined text-[20px] text-tertiary">info</span>
            View details
          </button>
          <button
            onClick={() => { setMenuOpen(false); if (onStartSession) onStartSession(room.id); else router.push(`/officer/session/${room.id}/start`); }}
            className="flex items-center gap-3 w-full py-3.5 rounded-xl text-on-surface
                       hover:bg-surface-container transition-colors font-label-lg text-[14px]"
          >
            <span className="material-symbols-outlined text-[20px] text-primary">qr_code_scanner</span>
            Start session
          </button>
          <button
            onClick={() => { setMenuOpen(false); router.push(`/teacher/rooms/${room.id}/settings`); }}
            className="flex items-center gap-3 w-full py-3.5 rounded-xl text-on-surface
                       hover:bg-surface-container transition-colors font-label-lg text-[14px]"
          >
            <span className="material-symbols-outlined text-[20px] text-tertiary">edit</span>
            Edit
          </button>
          <button
            onClick={() => { setMenuOpen(false); if (onDelete) onDelete(room.id); }}
            className="flex items-center gap-3 w-full py-3.5 rounded-xl text-error
                       hover:bg-error-container/30 transition-colors font-label-lg text-[14px]"
          >
            <span className="material-symbols-outlined text-[20px]">delete_outline</span>
            Delete
          </button>
        </div>
      </BottomSheet>
    </>
  );
}
