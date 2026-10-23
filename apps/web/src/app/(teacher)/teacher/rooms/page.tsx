'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { TeacherGuard, useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { Room } from '@/lib/types';
import { RoomCard } from '@/components/RoomCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { Avatar } from '@/components/ui/Avatar';
import { SproutIcon } from '@/components/ui/SproutIcon';
import { Button } from '@/components/ui/Button';

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

function formatDate(): string {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

function SkeletonCard() {
  return <div className="bg-surface-container animate-pulse rounded-xl h-32" />;
}

function RoomsContent() {
  const router = useRouter();
  const { user } = useAuth();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<Room[]>('/api/rooms')
      .then((data) => setRooms(Array.isArray(data) ? data : []))
      .catch(() => setRooms([]))
      .finally(() => setLoading(false));
  }, []);

  function handleDelete(id: string) {
    api.delete(`/api/rooms/${id}`).then(() => {
      setRooms((prev) => prev.filter((r) => r.id !== id));
    }).catch(() => {});
  }

  return (
    <div className="flex flex-col w-full min-h-full bg-surface">
      {/* ── Desktop page header (sidebar handles branding on lg:) ── */}
      <div className="hidden lg:flex items-center justify-between px-8 py-6 border-b border-outline-variant/30 bg-background/80 backdrop-blur-sm sticky top-0 z-10">
        <div>
          <h1 className="font-headline-lg text-on-surface">Rooms</h1>
          <p className="text-body-sm text-on-surface-variant mt-0.5">{formatDate()}</p>
        </div>
        <div className="flex items-center gap-3">
          {user && (
            <button
              aria-label="Teacher Profile"
              className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-surface-container-low transition-colors"
            >
              <Avatar name={user.name} size="sm" />
            </button>
          )}
          <Button
            variant="primary"
            size="sm"
            icon={<span className="material-symbols-outlined text-[18px]">add</span>}
            onClick={() => router.push('/teacher/rooms/new')}
          >
            New room
          </Button>
        </div>
      </div>

      {/* ── Content ── */}
      <div className="flex flex-col px-margin lg:px-8 pb-32 lg:pb-10 gap-space-lg">
        {/* Greeting section */}
        <div className="flex items-start justify-between pt-space-md">
          <div className="flex flex-col">
            <div className="flex items-center gap-space-xs mb-1">
              <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
              <span className="font-label-sm text-[11px] text-tertiary uppercase tracking-wider">
                {getTimeOfDay()}
              </span>
            </div>
            <h1 className="font-headline-xl-mobile text-[28px] leading-9 font-bold text-on-surface lg:hidden">
              {getGreeting()}, Teacher {user?.name?.split(' ')[0] ?? ''}
            </h1>
            <p className="hidden lg:block font-headline-md text-on-surface">
              {getGreeting()}, Teacher {user?.name?.split(' ')[0] ?? ''}
            </p>
            <div className="flex items-center gap-space-xs mt-1 text-on-surface-variant text-[12px]">
              <span className="material-symbols-outlined text-[16px] text-tertiary">
                calendar_today
              </span>
              <span>{formatDate()}</span>
            </div>
          </div>
        </div>

        {/* Section header */}
        <div className="flex flex-col gap-space-md">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-space-xs">
              <SproutIcon size="sm" className="text-primary" />
              <h2 className="font-headline-sm text-[18px] font-semibold text-on-surface">
                Your Classrooms
              </h2>
            </div>
            <span className="font-label-sm text-[11px] text-on-surface-variant lg:hidden">
              Tap card to scan QR
            </span>
          </div>

          {/* Room list — single column on mobile, 2-col grid on desktop */}
          {loading ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-space-md">
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </div>
          ) : rooms.length === 0 ? (
            <EmptyState
              title="No classrooms yet"
              description="Create your first room to get started"
            />
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-space-md">
              {rooms.map((room, idx) => (
                <RoomCard
                  key={room.id}
                  room={room}
                  index={idx}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Mobile FAB — hidden on desktop (desktop uses header button) */}
      <div className="fixed bottom-20 left-0 right-0 px-margin pb-2 flex justify-center z-40 pointer-events-none lg:hidden">
        <Button
          variant="primary"
          size="lg"
          className="pointer-events-auto shadow-lg"
          icon={<span className="material-symbols-outlined text-[20px]">add</span>}
          onClick={() => router.push('/teacher/rooms/new')}
        >
          New room
        </Button>
      </div>
    </div>
  );
}

export default function TeacherRoomsPage() {
  return (
    <TeacherGuard>
      <RoomsContent />
    </TeacherGuard>
  );
}
