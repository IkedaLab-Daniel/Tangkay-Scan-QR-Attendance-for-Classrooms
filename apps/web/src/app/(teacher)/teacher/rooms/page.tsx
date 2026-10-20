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

function formatDate(): string {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

function SkeletonCard() {
  return (
    <div className="bg-surface-container animate-pulse rounded-xl h-32" />
  );
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

  const activeCount = rooms.filter((r) => r.status === 'active').length;

  function handleDelete(id: string) {
    api.delete(`/api/rooms/${id}`).then(() => {
      setRooms((prev) => prev.filter((r) => r.id !== id));
    }).catch(() => {});
  }

  const avatarAction = user ? (
    <button
      aria-label="Teacher Profile"
      className="w-10 h-10 flex items-center justify-center rounded-full
                 hover:bg-surface-container-low transition-colors"
    >
      <Avatar name={user.name} size="sm" />
    </button>
  ) : null;

  return (
    <div className="flex flex-col w-full min-h-screen bg-surface">
      {/* Override layout header with our custom one */}
      <PageHeader title="Tangkay Scan" subtitle="Rooms" action={avatarAction} />

      <div className="flex flex-col px-margin pt-5 pb-32 gap-space-lg">
        {/* Greeting section */}
        <div className="flex items-start justify-between pt-space-md">
          <div className="flex flex-col">
            {/* Label */}
            <div className="flex items-center gap-space-xs mb-1">
              <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
              <span className="font-label-sm text-[11px] text-tertiary uppercase tracking-wider">
                {getTimeOfDay()}
              </span>
            </div>

            {/* Headline */}
            <h1 className="font-headline-xl-mobile text-[28px] leading-9 font-bold text-on-surface">
              {getGreeting()}, Teacher {user?.name?.split(' ')[0] ?? ''}
            </h1>

            {/* Date + active count */}
            <div className="flex items-center gap-space-xs mt-1 text-on-surface-variant text-[12px]">
              <span className="material-symbols-outlined text-[16px] text-tertiary">
                calendar_today
              </span>
              <span>{formatDate()}</span>
              <span className="text-outline-variant">•</span>
              <span className="font-label-sm text-[11px] px-2 py-0.5 rounded-full bg-surface-container-high text-on-surface">
                {activeCount} active {activeCount === 1 ? 'room' : 'rooms'}
              </span>
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
            <span className="font-label-sm text-[11px] text-on-surface-variant">
              Tap card to scan QR
            </span>
          </div>

          {/* Room list */}
          {loading ? (
            <div className="flex flex-col gap-space-md">
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
            <div className="flex flex-col gap-space-md">
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

      {/* Sticky "New room" button above bottom nav */}
      <div className="fixed bottom-20 left-0 right-0 px-margin pb-2 flex justify-center z-40 pointer-events-none">
        <Button
          variant="primary"
          size="lg"
          className="pointer-events-auto shadow-lg"
          icon={<span className="material-symbols-outlined text-[20px]">add</span>}
          onClick={() => router.push('/rooms/new')}
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
