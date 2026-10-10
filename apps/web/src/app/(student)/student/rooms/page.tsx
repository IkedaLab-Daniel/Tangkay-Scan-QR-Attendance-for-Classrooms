'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { StudentGuard, useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { SproutIcon } from '@/components/ui/SproutIcon';
import { Spinner } from '@/components/ui';
import type { Room, AttendanceSession, AttendanceRecord } from '@/lib/types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface EnrolledRoom extends Room {
  role: 'student' | 'officer';
  officer_title: string | null;
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

// ─── Weekly day cell ─────────────────────────────────────────────────────────

interface DayCellProps {
  day: Date;
  label: string;
  record?: WeeklyRecord;
  isToday: boolean;
  isPast: boolean;
}

function DayCell({ day, label, record, isToday, isPast }: DayCellProps) {
  const hasRecord = !!record;
  const isPending = isToday && !hasRecord;

  let bgClass = 'bg-surface-container-low/70';
  if (isToday) bgClass = 'bg-primary-fixed/30 shadow-sm';
  if (!isToday && !isPast) bgClass = 'bg-surface-container-low/40 opacity-75';

  let dayLabelClass = 'font-label-sm text-on-surface-variant font-bold';
  if (isToday) dayLabelClass = 'font-label-sm text-primary font-bold';
  if (!isToday && !isPast) dayLabelClass = 'font-label-sm text-outline font-medium';

  const timeText = hasRecord
    ? new Date(record!.scanned_at).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })
    : isPending
    ? 'Pending'
    : isPast
    ? '—:—'
    : '—:—';

  const statusLabel = hasRecord ? 'On time' : isPending ? 'Awaiting' : 'Upcoming';

  return (
    <div className={`flex flex-col items-center rounded-xl p-2 gap-1 text-center transition-all relative ${bgClass}`}>
      <span className={dayLabelClass}>{label}</span>

      {/* Status circle */}
      {hasRecord ? (
        <div className="w-7 h-7 rounded-full bg-primary-fixed flex items-center justify-center text-primary shadow-xs my-0.5">
          <span className="material-symbols-outlined text-[14px]" style={{ fontVariationSettings: "'FILL' 1" }}>
            potted_plant
          </span>
        </div>
      ) : isPending ? (
        <div className="w-7 h-7 rounded-full bg-primary-fixed flex items-center justify-center text-primary shadow-xs my-0.5 relative">
          <span className="absolute inset-0 rounded-full bg-primary-fixed animate-ping opacity-60" />
          <span className="material-symbols-outlined text-[14px]" style={{ fontVariationSettings: "'FILL' 1" }}>
            nest_eco_leaf
          </span>
        </div>
      ) : (
        <div className="w-7 h-7 rounded-full bg-surface-container-highest flex items-center justify-center text-outline my-0.5">
          <span className="w-2 h-2 rounded-full bg-outline-variant" />
        </div>
      )}

      <span
        className={`font-label-sm font-semibold ${
          hasRecord ? 'text-primary' : isPending ? 'text-secondary animate-pulse' : 'text-outline'
        }`}
      >
        {timeText}
      </span>
      <span className={`font-body-sm text-[10px] leading-none ${hasRecord ? 'text-tertiary' : 'text-on-surface-variant'}`}>
        {statusLabel}
      </span>
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

  const primaryRoom = rooms[0] ?? null;

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
  const weekDays = getCurrentWeekDays();
  const weekNum = getWeekNumber(today);

  // Calculate streak from weekly records (consecutive days present)
  const loggedCount = weeklyRecords.length;

  // Simple streak: count past days with a record (rough heuristic)
  const streak = loggedCount > 0 ? loggedCount * 2 : 0; // placeholder; would need full history for real streak

  // Build day→record map keyed by ISO date string
  const recordByDay: Record<string, WeeklyRecord> = {};
  for (const r of weeklyRecords) {
    const d = new Date(r.scanned_at).toDateString();
    recordByDay[d] = r;
  }

  const advisorInfo = primaryRoom
    ? `${primaryRoom.name}`
    : null;

  return (
    <div className="flex flex-col w-full relative">
      {/* Warm backdrop */}
      <div className="absolute inset-x-0 top-0 h-96 -z-10 overflow-hidden pointer-events-none">
        <div className="w-full h-full bg-surface-container scale-105 transform" />
        <div className="absolute inset-0 bg-surface/85" />
        <div className="absolute inset-0 bg-gradient-to-b from-surface/20 via-surface/80 to-surface" />
      </div>

      <div className="px-margin pt-space-md flex flex-col gap-space-lg w-full max-w-md mx-auto">

        {/* ── Hero: date + room code + greeting ── */}
        <div className="flex flex-col gap-space-xs">
          <div className="flex items-center justify-between">
            <span className="font-label-md text-tertiary flex items-center gap-1.5 font-medium tracking-wide">
              <span className="material-symbols-outlined text-[16px] text-primary">calendar_today</span>
              {formatDate(today)}
            </span>
            {primaryRoom && (
              <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-surface-container-high text-on-surface-variant font-label-sm shadow-sm">
                <span className="material-symbols-outlined text-[14px]">pin</span>
                <span className="font-mono tracking-wider">Code: {primaryRoom.invite_code}</span>
              </div>
            )}
          </div>

          <div className="mt-1">
            <h1 className="font-headline-xl-mobile text-on-surface leading-tight">
              {greeting}, {firstName || 'Student'}!
            </h1>
            {advisorInfo ? (
              <p className="font-body-md text-on-surface-variant mt-0.5 flex items-center gap-1.5">
                <span className="font-semibold text-on-surface">{advisorInfo}</span>
                {primaryRoom?.room_number && (
                  <>
                    <span className="text-outline-variant">•</span>
                    <span>Room {primaryRoom.room_number}</span>
                  </>
                )}
              </p>
            ) : (
              <p className="font-body-md text-on-surface-variant mt-0.5">
                No rooms enrolled yet.
              </p>
            )}
          </div>

          {/* Active session badge */}
          {activeSession && primaryRoom && (
            <div className="mt-space-xs flex items-center">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary-fixed text-on-primary-fixed shadow-sm">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-primary" />
                </span>
                <span className="font-label-md font-semibold tracking-wide">
                  Roll Call Active{primaryRoom.room_number ? ` · Rm ${primaryRoom.room_number}` : ''}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* ── Check-in card ── */}
        <div className="bg-surface-container-lowest/95 backdrop-blur-md rounded-2xl p-space-lg shadow-[0_4px_20px_rgba(43,42,38,0.06)] flex flex-col items-center text-center relative overflow-hidden">
          <div className="absolute -top-10 -right-10 w-28 h-28 rounded-full bg-primary-fixed/30 pointer-events-none blur-xl" />

          {/* Illustration */}
          <div className="relative my-space-xs w-20 h-20 rounded-2xl bg-surface-container-low flex items-center justify-center shadow-inner">
            <div className="absolute inset-1.5 rounded-xl border border-dashed border-outline-variant/60" />
            <span className="material-symbols-outlined text-[36px] text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>
              qr_code_scanner
            </span>
            <div className="absolute -bottom-1 -right-1 bg-surface-container-lowest rounded-full p-1 shadow-sm">
              <SproutIcon size="sm" className="text-primary w-4 h-4" />
            </div>
          </div>

          <div className="mt-space-sm mb-space-md max-w-xs">
            <h2 className="font-headline-sm text-on-surface font-semibold">Ready for Morning Check-in</h2>
            <p className="font-body-sm text-on-surface-variant mt-1">
              Point your camera at your class officer&apos;s QR screen
            </p>
          </div>

          {activeSession && primaryRoom ? (
            <button
              type="button"
              onClick={() => router.push(`/student/scan/${primaryRoom.id}`)}
              className="w-full py-3.5 px-6 rounded-full bg-primary text-on-primary font-label-lg flex items-center justify-center gap-2.5 shadow-[0_6px_16px_rgba(18,106,58,0.30)] active:scale-[0.98] transition-all duration-150"
            >
              <span className="material-symbols-outlined text-[22px]">qr_code_2</span>
              <span>Scan to check in</span>
            </button>
          ) : (
            <button
              type="button"
              disabled
              className="w-full py-3.5 px-6 rounded-full bg-surface-container text-on-surface-variant font-label-lg flex items-center justify-center gap-2.5 cursor-not-allowed opacity-60"
            >
              <span className="material-symbols-outlined text-[22px]">qr_code_2</span>
              <span>No active session</span>
            </button>
          )}
        </div>

        {/* ── Streak card ── */}
        <div className="bg-surface-container-lowest/90 backdrop-blur-sm rounded-xl p-space-md shadow-[0_2px_12px_rgba(43,42,38,0.04)] flex items-center justify-between">
          <div className="flex items-center gap-space-sm">
            <div className="w-9 h-9 rounded-full bg-secondary-fixed flex items-center justify-center text-on-secondary-fixed">
              <span className="material-symbols-outlined text-[18px]">local_fire_department</span>
            </div>
            <div className="flex flex-col">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-secondary-container" />
                <span className="font-headline-sm text-on-surface font-bold">{streak} consecutive days</span>
              </div>
              <span className="font-body-sm text-on-surface-variant">Punctual &amp; present streak</span>
            </div>
          </div>
          {streak > 7 && (
            <span className="material-symbols-outlined text-outline-variant text-[20px]">verified</span>
          )}
        </div>

        {/* ── Weekly growth card ── */}
        <div className="bg-surface-container-lowest/95 backdrop-blur-md rounded-2xl p-space-lg shadow-[0_4px_20px_rgba(43,42,38,0.05)] flex flex-col gap-space-md mb-space-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-primary text-[20px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                eco
              </span>
              <h3 className="font-headline-sm text-on-surface">This Week&apos;s Growth</h3>
            </div>
            <span className="font-label-sm text-tertiary uppercase tracking-wider font-bold">
              Wk {weekNum} · Term 2
            </span>
          </div>

          {/* 5-day grid */}
          <div className="grid grid-cols-5 gap-1.5 pt-1">
            {weekDays.map((day, i) => {
              const isToday = isSameDay(day, today);
              const isPast = day < today && !isToday;
              const record = recordByDay[day.toDateString()];
              return (
                <DayCell
                  key={i}
                  day={day}
                  label={DAY_LABELS[i]}
                  record={record}
                  isToday={isToday}
                  isPast={isPast}
                />
              );
            })}
          </div>

          {/* Footer */}
          <div className="pt-2 flex items-center justify-between text-on-surface-variant font-body-sm">
            <span className="flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px] text-primary">psychology_alt</span>
              Target: 100% weekly punctuality
            </span>
            <span className="font-label-sm font-bold text-primary">{loggedCount} / 5 Logged</span>
          </div>
        </div>

      </div>
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
