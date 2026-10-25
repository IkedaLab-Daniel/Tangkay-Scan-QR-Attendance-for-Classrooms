'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { StudentGuard, useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { Room } from '@/lib/types';
import { Badge, BadgeVariant } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Avatar } from '@/components/ui/Avatar';
import { PageHeader } from '@/components/ui/PageHeader';

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function getTimeOfDay(): string {
  const h = new Date().getHours();
  if (h < 12) return 'MORNING ROLL CALL';
  if (h < 17) return 'AFTERNOON ROLL CALL';
  return 'EVENING ROLL CALL';
}

function modeVariant(mode: string): BadgeVariant {
  if (mode === 'strict') return 'strict';
  if (mode === 'static') return 'static';
  if (mode === 'manual') return 'manual';
  return 'balanced';
}

const CARD_TINTS = ['#ddf0df', '#f1ebe0', '#ffe8df'] as const;

function SkeletonCard() {
  return <div className="bg-surface-container animate-pulse rounded-xl h-28" />;
}

interface OfficerRoom extends Room {
  officer_title?: string | null;
}

function OfficerRoomsContent() {
  const router = useRouter();
  const { user } = useAuth();
  const [rooms, setRooms] = useState<OfficerRoom[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<OfficerRoom[]>('/api/rooms/my-officer-rooms')
      .then((data) => setRooms(data))
      .catch(() => setRooms([]))
      .finally(() => setLoading(false));
  }, []);

  const avatarAction = user ? (
    <button
      aria-label="Officer Profile"
      className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-surface-container-low transition-colors"
    >
      <Avatar name={user.name} size="sm" />
    </button>
  ) : null;

  return (
    <div className="flex flex-col w-full min-h-screen bg-surface">
      <PageHeader title="Tangkay Scan" subtitle="Officer" action={avatarAction} />

      <div className="flex flex-col px-margin pt-20 pb-24 gap-space-lg">
        {/* Greeting */}
        <div className="flex flex-col pt-space-md">
          <div className="flex items-center gap-space-xs mb-1">
            <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            <span className="font-label-sm text-[11px] text-tertiary uppercase tracking-wider">
              {getTimeOfDay()}
            </span>
          </div>
          <h1 className="font-headline-xl-mobile text-[28px] leading-9 font-bold text-on-surface">
            {getGreeting()}, {user?.name?.split(' ')[0] ?? 'Officer'}
          </h1>
          <p className="font-body-sm text-[12px] text-on-surface-variant mt-1">
            Your assigned rooms as officer
          </p>
        </div>

        {/* Room list */}
        <div className="flex flex-col gap-space-md">
          <div className="flex items-center gap-space-xs">
            <span className="material-symbols-outlined text-[20px] text-primary">badge</span>
            <h2 className="font-headline-sm text-[18px] font-semibold text-on-surface">
              Your Active Rooms
            </h2>
          </div>

          {loading ? (
            <div className="flex flex-col gap-space-md">
              <SkeletonCard />
              <SkeletonCard />
            </div>
          ) : rooms.length === 0 ? (
            <EmptyState
              title="No rooms assigned"
              description="Contact your teacher to get your room invite link"
            />
          ) : (
            <div className="flex flex-col gap-space-md">
              {rooms.map((room, idx) => {
                const tint = CARD_TINTS[idx % CARD_TINTS.length];
                const modeLabel =
                  room.attendance_mode.charAt(0).toUpperCase() +
                  room.attendance_mode.slice(1);
                return (
                  <article
                    key={room.id}
                    style={{ backgroundColor: tint }}
                    className="relative flex flex-col rounded-xl p-space-md shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-space-sm mb-space-sm">
                      <div className="flex flex-col min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <Badge variant={modeVariant(room.attendance_mode)} label={modeLabel} />
                        </div>
                        <h3 className="font-headline-sm text-on-surface truncate">{room.name}</h3>
                        {room.officer_title && (
                          <p className="font-body-sm text-[12px] text-tertiary mt-0.5">
                            {room.officer_title}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 font-label-sm text-[11px] text-on-surface-variant">
                        <span className="material-symbols-outlined text-[16px] text-primary">groups</span>
                        {room.student_count ?? 0}
                      </div>
                    </div>

                    <button
                      onClick={() => router.push(`/officer/session/${room.id}/start`)}
                      className="mt-space-xs w-full h-10 rounded-full bg-primary text-on-primary
                                 font-label-lg text-[14px] flex items-center justify-center gap-2
                                 active:scale-[0.98] transition-all"
                    >
                      <span className="material-symbols-outlined text-[18px]">qr_code_scanner</span>
                      Start Session
                    </button>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function OfficerRoomsPage() {
  return (
    <StudentGuard>
      <OfficerRoomsContent />
    </StudentGuard>
  );
}
