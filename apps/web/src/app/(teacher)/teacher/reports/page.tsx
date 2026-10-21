'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { TeacherGuard } from '@/lib/auth';
import { api } from '@/lib/api';
import { RecentSession } from '@/lib/types';
import { PageHeader } from '@/components/ui/PageHeader';
import { Spinner } from '@/components/ui/Spinner';

// ─── Pending approvals banner ─────────────────────────────────────────────────

function PendingApprovalsBanner({ sessions }: { sessions: RecentSession[] }) {
  const router = useRouter();
  const sessionsWithPending = sessions.filter((s) => s.pendingCount > 0);
  if (sessionsWithPending.length === 0) return null;

  const totalPending = sessionsWithPending.reduce((sum, s) => sum + s.pendingCount, 0);

  return (
    <div className="flex flex-col gap-2 px-margin">
      <div className="flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
        <h2 className="font-label-lg text-[13px] text-on-surface font-semibold">
          Pending Approvals
        </h2>
        <span className="px-2 py-0.5 rounded-full bg-error text-on-error font-label-sm text-[11px]">
          {totalPending}
        </span>
      </div>
      <p className="font-body-sm text-[12px] text-on-surface-variant px-0.5">
        These manual entries need your review before they are logged.
      </p>
      <div className="flex flex-col gap-2">
        {sessionsWithPending.map((session) => (
          <button
            key={session.id}
            onClick={() =>
              router.push(
                `/teacher/rooms/${session.room.id}/sessions/${session.id}/approvals`,
              )
            }
            className="w-full bg-surface-container-lowest rounded-2xl p-4 shadow-sm
                       flex items-center justify-between gap-3 text-left ring-1 ring-tertiary-fixed
                       hover:bg-surface-container active:scale-[0.99] transition-all"
          >
            <div className="flex flex-col min-w-0 gap-0.5">
              <span className="font-label-lg text-[14px] text-on-surface">{session.room.name}</span>
              <span className="font-body-sm text-[12px] text-on-surface-variant">
                {new Date(session.started_at).toLocaleDateString('en-US', {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                })}
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-tertiary-fixed text-on-tertiary-fixed font-label-sm text-[11px]">
                <span className="material-symbols-outlined text-[12px]">hourglass_empty</span>
                {session.pendingCount} pending
              </span>
              <span className="material-symbols-outlined text-on-surface-variant text-[20px]">
                chevron_right
              </span>
            </div>
          </button>
        ))}
      </div>
      {/* divider */}
      <div className="h-px bg-outline-variant/30 mt-2" />
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatSessionDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function formatSessionTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

// ─── Stat Chip ────────────────────────────────────────────────────────────────

function StatChip({
  value,
  label,
  dotColor,
}: {
  value: number;
  label: string;
  dotColor: string;
}) {
  return (
    <div className="bg-surface-container-lowest rounded-xl px-4 py-3 shadow-card flex-shrink-0 min-w-[140px]">
      <div className="flex items-center gap-2 mb-0.5">
        <span className={`w-2 h-2 rounded-full ${dotColor}`} />
        <span className="font-headline-sm text-on-surface">{value}</span>
      </div>
      <span className="font-label-sm text-on-surface-variant">{label}</span>
    </div>
  );
}

// ─── Session Row ──────────────────────────────────────────────────────────────

function SessionRow({ session }: { session: RecentSession }) {
  const router = useRouter();

  function handleClick() {
    router.push(`/teacher/rooms/${session.room.id}/sessions/${session.id}/review`);
  }

  return (
    <button
      onClick={handleClick}
      className="w-full bg-surface-container-lowest rounded-2xl p-4 shadow-sm
                 flex items-center justify-between gap-3 text-left
                 hover:bg-surface-container active:scale-[0.99] transition-all"
    >
      {/* Left */}
      <div className="flex flex-col min-w-0 gap-0.5">
        <span className="font-label-lg text-on-surface">
          {formatSessionDate(session.started_at)}
          {' · '}
          {formatSessionTime(session.started_at)}
        </span>
        <span className="font-body-md text-on-surface-variant truncate">{session.room.name}</span>

        {/* Count badges */}
        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
          {/* Present */}
          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary-fixed text-on-primary-fixed font-label-sm text-[11px]">
            <span
              className="material-symbols-outlined text-[12px]"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              check_circle
            </span>
            {session.presentCount}
          </span>

          {/* Flagged */}
          {session.flaggedCount > 0 && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-secondary-fixed text-on-secondary-fixed-variant font-label-sm text-[11px]">
              <span className="material-symbols-outlined text-[12px]">flag</span>
              {session.flaggedCount}
            </span>
          )}

          {/* Pending */}
          {session.pendingCount > 0 && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-tertiary-fixed text-on-tertiary-fixed font-label-sm text-[11px]">
              <span className="material-symbols-outlined text-[12px]">hourglass_empty</span>
              {session.pendingCount}
            </span>
          )}
        </div>
      </div>

      {/* Right: status + chevron */}
      <div className="flex items-center gap-2 shrink-0">
        {session.status === 'active' ? (
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary-fixed text-on-primary-fixed-variant font-label-sm text-[11px]">
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            Active
          </span>
        ) : (
          <span className="px-2.5 py-1 rounded-full bg-surface-container text-on-surface-variant font-label-sm text-[11px]">
            Ended
          </span>
        )}
        <span className="material-symbols-outlined text-on-surface-variant text-[20px]">
          chevron_right
        </span>
      </div>
    </button>
  );
}

// ─── Main content ─────────────────────────────────────────────────────────────

function ReportsContent() {
  const [sessions, setSessions] = useState<RecentSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeRoom, setActiveRoom] = useState<string>('all');

  useEffect(() => {
    api
      .get<RecentSession[]>('/api/sessions/recent?limit=50')
      .then(setSessions)
      .catch(() => setSessions([]))
      .finally(() => setLoading(false));
  }, []);

  // Build unique room list
  const rooms = useMemo(() => {
    const seen = new Map<string, string>();
    sessions.forEach((s) => {
      if (!seen.has(s.room.id)) seen.set(s.room.id, s.room.name);
    });
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
  }, [sessions]);

  const filtered =
    activeRoom === 'all' ? sessions : sessions.filter((s) => s.room.id === activeRoom);

  // Hero stats
  const totalPresent = sessions.reduce((a, s) => a + s.presentCount, 0);
  const totalFlagged = sessions.reduce((a, s) => a + s.flaggedCount, 0);
  const totalPending = sessions.reduce((a, s) => a + s.pendingCount, 0);

  const filterAction = (
    <button
      aria-label="Filter by date"
      className="w-9 h-9 flex items-center justify-center rounded-full
                 text-on-surface-variant hover:bg-surface-container transition-colors"
    >
      <span className="material-symbols-outlined text-[20px]">filter_list</span>
    </button>
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-surface">
      <PageHeader title="Reports" action={filterAction} />

      <div className="flex flex-col pt-20 pb-10 gap-space-md">
        {/* Pending approvals action banner */}
        <PendingApprovalsBanner sessions={sessions} />

        {/* Hero stat chips */}
        <div className="flex items-start gap-3 overflow-x-auto px-margin no-scrollbar pb-1 pt-space-xs">
          <StatChip value={totalPresent} label="Total Present Today" dotColor="bg-primary" />
          <StatChip value={totalFlagged} label="Flagged for Review" dotColor="bg-secondary" />
          <StatChip value={totalPending} label="Pending Approval" dotColor="bg-tertiary-fixed-dim" />
        </div>

        {/* Room filter tabs */}
        {rooms.length > 0 && (
          <div className="flex items-center gap-2 overflow-x-auto px-margin no-scrollbar pb-1">
            <button
              onClick={() => setActiveRoom('all')}
              className={[
                'whitespace-nowrap px-4 py-1.5 rounded-full font-label-md transition-all',
                activeRoom === 'all'
                  ? 'bg-primary-fixed text-on-primary-fixed'
                  : 'text-on-surface-variant hover:text-on-surface',
              ].join(' ')}
            >
              All Rooms
            </button>
            {rooms.map((room) => (
              <button
                key={room.id}
                onClick={() => setActiveRoom(room.id)}
                className={[
                  'whitespace-nowrap px-4 py-1.5 rounded-full font-label-md transition-all',
                  activeRoom === room.id
                    ? 'bg-primary-fixed text-on-primary-fixed'
                    : 'text-on-surface-variant hover:text-on-surface',
                ].join(' ')}
              >
                {room.name}
              </button>
            ))}
          </div>
        )}

        {/* Session list */}
        <div className="flex flex-col gap-2 px-margin">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <span className="material-symbols-outlined text-[48px] text-outline-variant">
                assignment
              </span>
              <p className="font-body-md text-on-surface-variant text-center">
                No sessions yet.
                <br />
                Start a session from a room to see it here.
              </p>
            </div>
          ) : (
            filtered.map((session) => <SessionRow key={session.id} session={session} />)
          )}
        </div>
      </div>
    </div>
  );
}

export default function TeacherReportsPage() {
  return (
    <TeacherGuard>
      <ReportsContent />
    </TeacherGuard>
  );
}
