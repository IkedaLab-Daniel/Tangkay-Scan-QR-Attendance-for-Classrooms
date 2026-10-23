'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { StudentGuard, useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { Spinner } from '@/components/ui';
import { JoinByCodeSheet } from '@/components/JoinByCodeSheet';
import type { Room, AttendanceSession, AttendanceRecord } from '@/lib/types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface EnrolledRoom extends Room {
  role: 'student' | 'officer';
  officer_title: string | null;
  teacher_name?: string;
}

interface WeeklyRecord extends AttendanceRecord {
  session: AttendanceSession & { room: Room };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Magandang umaga';
  if (hour < 18) return 'Magandang hapon';
  return 'Magandang gabi';
}

function getFirstName(name: string): string {
  return name.trim().split(/\s+/)[0];
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-PH', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

// Get Mon–Fri of the current week
function getCurrentWeekDays(): Date[] {
  const today = new Date();
  const day = today.getDay(); // 0=Sun
  const monday = new Date(today);
  monday.setDate(today.getDate() - (day === 0 ? 6 : day - 1));
  monday.setHours(0, 0, 0, 0);
  return Array.from({ length: 5 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

const DAY_LABELS = ['MON', 'TUE', 'WED', 'THU', 'FRI'];

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function getWeekNumber(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 1);
  const diff = date.getTime() - start.getTime();
  return Math.ceil(diff / (7 * 24 * 60 * 60 * 1000));
}

/** Returns the count of weekly attendance records belonging to a specific room. */
function getWeeklyCountForRoom(roomId: string, weeklyRecords: WeeklyRecord[]): number {
  const weekDays = getCurrentWeekDays();
  const weekStart = weekDays[0];
  const weekEnd = new Date(weekDays[4]);
  weekEnd.setHours(23, 59, 59, 999);
  return weeklyRecords.filter((r) => {
    const scannedAt = new Date(r.scanned_at);
    return (
      r.session?.room?.id === roomId &&
      scannedAt >= weekStart &&
      scannedAt <= weekEnd
    );
  }).length;
}

// ─── Room Card ────────────────────────────────────────────────────────────────

interface RoomCardProps {
  room: EnrolledRoom;
  weeklyCount: number;
  hasActiveSession: boolean;
  onScan: () => void;
  onTap: () => void;
  onStartSession: () => void;
}

function RoomCard({ room, weeklyCount, hasActiveSession, onScan, onTap, onStartSession }: RoomCardProps) {
  const attendancePill =
    weeklyCount >= 5
      ? 'bg-primary-fixed text-on-primary-fixed'
      : weeklyCount >= 3
      ? 'bg-secondary-fixed text-on-secondary-fixed'
      : 'bg-surface-container-high text-on-surface-variant';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onTap}
      onKeyDown={(e) => e.key === 'Enter' && onTap()}
      className="w-full bg-surface-container-lowest rounded-2xl shadow-[0_2px_12px_rgba(43,42,38,0.06)] border border-outline-variant/20 p-space-md flex flex-col gap-space-sm cursor-pointer active:scale-[0.99] transition-all duration-150"
    >
      {/* Top row: room name + badges */}
      <div className="flex items-start justify-between gap-2">
        <h2 className="font-headline-sm text-on-surface leading-snug flex-1 min-w-0 truncate">
          {room.name}
        </h2>
        <div className="flex items-center gap-1.5 shrink-0">
          {room.role === 'officer' && (
            <span className="px-2 py-0.5 rounded-full bg-tertiary-fixed text-on-tertiary-fixed font-label-sm text-[11px] font-semibold">
              Officer
            </span>
          )}
          <span className={`px-2.5 py-0.5 rounded-full font-label-sm text-[11px] font-semibold ${attendancePill}`}>
            {weeklyCount} / 5 this week
          </span>
        </div>
      </div>

      {/* Teacher name */}
      <p className="font-body-sm text-on-surface-variant flex items-center gap-1.5">
        <span className="material-symbols-outlined text-[14px]">school</span>
        <span className="truncate">{room.teacher_name ?? 'Unknown teacher'}</span>
      </p>

      {/* Action buttons */}
      <div className="pt-1 flex flex-col gap-2">
        {/* Officer: Start Session button */}
        {room.role === 'officer' && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onStartSession();
            }}
            className="w-full h-11 rounded-full bg-tertiary text-on-tertiary font-label-lg flex items-center justify-center gap-2 shadow-sm hover:opacity-95 active:scale-[0.98] transition-all duration-150"
          >
            <span className="material-symbols-outlined text-[18px]">qr_code_scanner</span>
            <span>Start Session</span>
          </button>
        )}

        {/* Scan button */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onScan();
          }}
          disabled={!hasActiveSession}
          className={[
            'w-full h-11 rounded-full font-label-lg flex items-center justify-center gap-2 transition-all duration-150',
            hasActiveSession
              ? 'bg-primary text-on-primary shadow-sm hover:opacity-95 active:scale-[0.98]'
              : 'bg-surface-container text-on-surface-variant cursor-not-allowed opacity-60',
          ].join(' ')}
        >
          <span className="material-symbols-outlined text-[18px]">qr_code_2</span>
          <span>{hasActiveSession ? 'Scan to check in' : 'No active session'}</span>
        </button>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

function StudentHomeContent() {
  const { user } = useAuth();
  const router = useRouter();

  const [rooms, setRooms] = useState<EnrolledRoom[]>([]);
  const [activeSession, setActiveSession] = useState<AttendanceSession | null>(null);
  const [weeklyRecords, setWeeklyRecords] = useState<WeeklyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [joinSheetOpen, setJoinSheetOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState('');

  useEffect(() => {
    async function load() {
      try {
        const [roomsData, recordsData] = await Promise.all([
          api.get<EnrolledRoom[]>('/api/rooms/my-rooms'),
          api.get<WeeklyRecord[]>('/api/student/my-attendance'),
        ]);
        setRooms(roomsData);
        setWeeklyRecords(recordsData);

        // Check active session for the first enrolled room
        if (roomsData.length > 0) {
          try {
            const session = await api.get<AttendanceSession>(
              `/api/sessions/active?roomId=${roomsData[0].id}`,
            );
            setActiveSession(session);
          } catch {
            // 404 = no active session, that's fine
          }
        }
      } catch {
        // ignore — we just show empty states
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  function showToast(msg: string) {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 3000);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Spinner />
      </div>
    );
  }

  const greeting = user ? getGreeting() : 'Magandang araw';
  const firstName = user ? getFirstName(user.name) : '';
  const today = new Date();

  return (
    <div className="flex flex-col w-full relative">
      {/* Toast */}
      {toastMsg && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-inverse-surface text-inverse-on-surface rounded-full px-4 py-2.5 font-label-md shadow-float pointer-events-none animate-fade-in">
          {toastMsg}
        </div>
      )}

      <div className="px-margin pt-space-md flex flex-col gap-space-lg w-full max-w-md mx-auto pb-space-xl">

        {/* ── Header: greeting + date ── */}
        <div className="flex flex-col gap-space-xs">
          <span className="font-label-md text-tertiary flex items-center gap-1.5 font-medium tracking-wide">
            <span className="material-symbols-outlined text-[16px] text-primary">calendar_today</span>
            {formatDate(today)}
          </span>
          <h1 className="font-headline-xl-mobile text-on-surface leading-tight mt-1">
            {greeting}, {firstName || 'Student'}!
          </h1>
          <p className="font-body-md text-on-surface-variant">
            {rooms.length === 0
              ? 'Join a class to get started.'
              : rooms.length === 1
              ? '1 class enrolled.'
              : `${rooms.length} classes enrolled.`}
          </p>
        </div>

        {/* ── Room cards list or empty state ── */}
        {rooms.length === 0 ? (
          <div className="flex flex-col items-center text-center gap-space-md mt-space-lg">
            {/* Illustration */}
            <div className="w-20 h-20 rounded-full bg-surface-container flex items-center justify-center">
              <span
                className="material-symbols-outlined text-on-surface-variant text-[40px]"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                meeting_room
              </span>
            </div>
            <div>
              <h2 className="font-headline-sm text-on-surface">You haven&apos;t joined any classes yet</h2>
              <p className="font-body-md text-on-surface-variant mt-1">
                Enter a Room ID from your teacher to get started.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setJoinSheetOpen(true)}
              className="mt-space-sm h-14 px-8 bg-primary text-on-primary rounded-full font-label-lg shadow-sm hover:opacity-95 active:scale-[0.99] transition-all flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-[20px]">add</span>
              Join a Class
            </button>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-space-md">
              {rooms.map((room) => {
                const weeklyCount = getWeeklyCountForRoom(room.id, weeklyRecords);
                // Active session: for simplicity, check the fetched activeSession (first room).
                // The scan page handles the no-active-session case gracefully.
                const hasActive =
                  activeSession?.room_id === room.id ||
                  (rooms[0]?.id === room.id && activeSession != null);
                return (
                  <RoomCard
                    key={room.id}
                    room={room}
                    weeklyCount={weeklyCount}
                    hasActiveSession={hasActive}
                    onScan={() => router.push(`/student/scan/${room.id}`)}
                    onTap={() => room.role === 'officer'
                      ? router.push(`/officer/session/${room.id}/start`)
                      : showToast('Room detail coming soon')}
                    onStartSession={() => router.push(`/officer/session/${room.id}/start`)}
                  />
                );
              })}
            </div>

            {/* Non-empty footer: Join another class */}
            <button
              type="button"
              onClick={() => setJoinSheetOpen(true)}
              className="w-full h-12 rounded-full border border-outline-variant text-on-surface-variant font-label-lg hover:bg-surface-container-low active:scale-[0.99] transition-all flex items-center justify-center gap-2"
            >
              <span className="material-symbols-outlined text-[18px]">add</span>
              Join another class
            </button>
          </>
        )}

      </div>

      {/* ── Join by code sheet ── */}
      <JoinByCodeSheet
        open={joinSheetOpen}
        onClose={() => setJoinSheetOpen(false)}
        onJoined={(roomId) => {
          setJoinSheetOpen(false);
          router.push(`/student/consent/${roomId}`);
        }}
      />
    </div>
  );
}

export default function StudentRoomsPage() {
  return (
    <StudentGuard>
      <StudentHomeContent />
    </StudentGuard>
  );
}
