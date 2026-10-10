'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { TeacherGuard } from '@/lib/auth';
import { api } from '@/lib/api';
import { AttendanceSession, AttendanceRecord } from '@/lib/types';
import { PageHeader } from '@/components/ui/PageHeader';
import { Spinner } from '@/components/ui/Spinner';

// ─── Signal label map ─────────────────────────────────────────────────────────

const SIGNAL_LABELS: Record<string, string> = {
  constant_accuracy: 'Constant GPS accuracy',
  all_null_sensors: 'No sensor data',
  identical_coords: 'Identical coordinates',
  impossible_jump: 'Impossible movement',
  clock_delta: 'Clock mismatch',
  ip_geo_mismatch: 'IP location mismatch',
  fingerprint_collision: 'Device used by another student',
};

// ─── Types ────────────────────────────────────────────────────────────────────

type FilterTab = 'all' | 'flagged' | 'pending';

interface RecordWithStudent extends Omit<AttendanceRecord, 'student'> {
  student?: { id: string; name: string; email?: string };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isFlagged(rec: RecordWithStudent): boolean {
  return (
    rec.location_flag === 'mismatch' ||
    rec.location_flag === 'unverified' ||
    rec.risk_score === 'high' ||
    rec.risk_score === 'medium' ||
    (rec.risk_signals ?? []).length > 0
  );
}

function getInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatSessionDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

// ─── Location chip ────────────────────────────────────────────────────────────

function LocationChip({ flag }: { flag: string | null }) {
  if (flag === 'verified') {
    return (
      <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-tertiary-fixed text-on-tertiary-fixed font-label-sm text-[11px]">
        <span
          className="material-symbols-outlined text-[12px] text-primary"
          style={{ fontVariationSettings: "'FILL' 1" }}
        >
          check_circle
        </span>
        Verified
      </span>
    );
  }
  if (flag === 'mismatch') {
    return (
      <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-error-container text-on-error-container font-label-sm text-[11px]">
        <span className="material-symbols-outlined text-[12px]">location_off</span>
        Mismatch
      </span>
    );
  }
  if (flag === 'unverified') {
    return (
      <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-secondary-fixed text-on-secondary-fixed-variant font-label-sm text-[11px]">
        <span className="material-symbols-outlined text-[12px]">near_me</span>
        Unverified
      </span>
    );
  }
  return null;
}

// ─── Risk chip ────────────────────────────────────────────────────────────────

function RiskChip({ score }: { score: string | null }) {
  if (!score || score === 'low') {
    return (
      <span className="px-2 py-0.5 rounded-full bg-surface-container text-outline font-label-sm text-[11px]">
        Low risk
      </span>
    );
  }
  if (score === 'medium') {
    return (
      <span className="px-2 py-0.5 rounded-full bg-secondary-fixed text-on-secondary-fixed-variant font-label-sm text-[11px]">
        Medium risk
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-error-container text-on-error-container font-label-sm text-[11px]">
      <span className="material-symbols-outlined text-[12px]">report</span>
      High risk
    </span>
  );
}

// ─── Record row ───────────────────────────────────────────────────────────────

function RecordRow({
  record,
  onApprove,
  onReject,
}: {
  record: RecordWithStudent;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const flagged = isFlagged(record);
  const name = record.student?.name ?? 'Unknown';
  const initials = getInitials(name);
  const signals = (record.risk_signals ?? []) as string[];
  const isPending = record.approval_status === 'pending';
  const isManual = record.method === 'manual';

  return (
    <article
      className={[
        'w-full bg-surface-container-lowest rounded-2xl p-4 shadow-sm transition-all',
        flagged ? 'ring-1 ring-secondary/30' : '',
      ].join(' ')}
    >
      {/* Main row */}
      <div className="flex items-start justify-between gap-3">
        {/* Avatar + info */}
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={[
              'w-10 h-10 rounded-full flex items-center justify-center font-headline-sm text-[15px] font-semibold shrink-0',
              flagged
                ? 'bg-secondary-fixed text-on-secondary-fixed'
                : 'bg-tertiary-fixed text-on-tertiary-fixed',
            ].join(' ')}
          >
            {initials}
          </div>

          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-label-lg text-on-surface truncate">{name}</span>
              {/* Method badge */}
              <span className="px-1.5 py-0.5 rounded-full bg-surface-container text-outline font-label-sm text-[11px]">
                {record.method === 'qr_scan' ? 'QR' : 'Manual'}
              </span>
            </div>
            <span className="font-body-sm text-outline">{formatTime(record.scanned_at)}</span>
          </div>
        </div>

        {/* Right: status badges + expand toggle */}
        <div className="flex flex-col items-end shrink-0 gap-1">
          <LocationChip flag={record.location_flag} />
          <RiskChip score={record.risk_score} />
        </div>
      </div>

      {/* Risk signals (expandable) */}
      {signals.length > 0 && (
        <div className="mt-2.5">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1 font-label-sm text-[11px] text-secondary hover:text-on-surface transition-colors"
          >
            <span className="material-symbols-outlined text-[14px]">
              {expanded ? 'expand_less' : 'expand_more'}
            </span>
            {signals.length} signal{signals.length > 1 ? 's' : ''} detected
          </button>
          {expanded && (
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {signals.map((sig) => (
                <span
                  key={sig}
                  className="px-2 py-0.5 rounded-full bg-secondary-fixed/40 text-on-secondary-fixed-variant font-label-sm text-[10px]"
                >
                  {SIGNAL_LABELS[sig] ?? sig}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Pending manual approval actions */}
      {isPending && isManual && (
        <div className="grid grid-cols-2 gap-2 mt-3">
          <button
            onClick={() => onReject(record.id)}
            className="py-2.5 rounded-full bg-surface-container-lowest text-error
                       font-label-md text-[13px] shadow-sm hover:bg-error-container/20
                       active:scale-95 transition-all flex items-center justify-center gap-1.5 border border-outline-variant/30"
          >
            <span className="material-symbols-outlined text-[16px]">close</span>
            Reject
          </button>
          <button
            onClick={() => onApprove(record.id)}
            className="py-2.5 rounded-full bg-primary text-on-primary
                       font-label-md text-[13px] shadow-[0_4px_12px_rgba(63,143,91,0.25)]
                       hover:opacity-90 active:scale-95 transition-all flex items-center justify-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[16px]">check</span>
            Approve
          </button>
        </div>
      )}

      {/* Approved/Rejected badge (non-pending) */}
      {!isPending && (
        <div className="mt-2">
          {record.approval_status === 'approved' ? (
            <span className="flex items-center gap-1 font-label-sm text-[11px] text-primary">
              <span
                className="material-symbols-outlined text-[14px]"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                check_circle
              </span>
              Approved
            </span>
          ) : record.approval_status === 'rejected' ? (
            <span className="flex items-center gap-1 font-label-sm text-[11px] text-error">
              <span className="material-symbols-outlined text-[14px]">cancel</span>
              Rejected
            </span>
          ) : null}
        </div>
      )}
    </article>
  );
}

// ─── Main content ─────────────────────────────────────────────────────────────

function ReviewContent() {
  const params = useParams();
  const roomId = params.id as string;
  const sessionId = params.sessionId as string;

  const [session, setSession] = useState<AttendanceSession | null>(null);
  const [records, setRecords] = useState<RecordWithStudent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterTab>('all');

  useEffect(() => {
    Promise.all([
      api
        .get<AttendanceSession>(`/api/rooms/${roomId}/sessions/${sessionId}`)
        .catch(() => null),
      api
        .get<{ data: RecordWithStudent[] }>(`/api/sessions/${sessionId}/records?limit=100`)
        .catch(() => ({ data: [] })),
    ])
      .then(([s, r]) => {
        setSession(s);
        setRecords(r.data ?? []);
      })
      .finally(() => setLoading(false));
  }, [roomId, sessionId]);

  const handleApprove = useCallback(
    async (recordId: string) => {
      try {
        await api.patch(`/api/sessions/${sessionId}/records/${recordId}/approve`, {
          decision: 'approved',
        });
        setRecords((prev) =>
          prev.map((r) => (r.id === recordId ? { ...r, approval_status: 'approved' } : r)),
        );
      } catch {
        // silent — keep UI stable
      }
    },
    [sessionId],
  );

  const handleReject = useCallback(
    async (recordId: string) => {
      try {
        await api.patch(`/api/sessions/${sessionId}/records/${recordId}/approve`, {
          decision: 'rejected',
        });
        setRecords((prev) =>
          prev.map((r) => (r.id === recordId ? { ...r, approval_status: 'rejected' } : r)),
        );
      } catch {
        // silent
      }
    },
    [sessionId],
  );

  const filtered = records.filter((rec) => {
    if (filter === 'flagged') return isFlagged(rec);
    if (filter === 'pending') return rec.approval_status === 'pending';
    return true;
  });

  const presentCount = records.filter((r) => r.approval_status === 'approved').length;
  const flaggedCount = records.filter(isFlagged).length;
  const pendingCount = records.filter((r) => r.approval_status === 'pending').length;
  const totalCount = records.length;

  const subtitle = session ? formatSessionDate(session.started_at) : undefined;

  if (loading) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-surface">
      <PageHeader title="Session Review" subtitle={subtitle} back />

      <div className="flex flex-col px-margin pt-20 pb-10 gap-space-md">
        {/* Summary card */}
        {session && (
          <section className="w-full bg-surface-container-lowest rounded-[20px] p-4 shadow-sm flex flex-col gap-3">
            <div className="flex items-start justify-between">
              <div className="flex flex-col">
                <span className="font-label-sm text-outline uppercase tracking-wider">
                  Session Attendance
                </span>
                <h2 className="font-headline-md text-on-surface">{subtitle}</h2>
              </div>
              <span
                className={[
                  'inline-flex items-center gap-1.5 px-3 py-1 rounded-full font-label-sm text-[12px]',
                  session.status === 'active'
                    ? 'bg-primary-fixed text-on-primary-fixed-variant'
                    : 'bg-surface-container text-on-surface-variant',
                ].join(' ')}
              >
                {session.status === 'active' && (
                  <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                )}
                {session.status === 'active' ? 'Active' : 'Closed'}
              </span>
            </div>

            <div className="bg-surface-container-low rounded-xl px-3 py-2.5 flex flex-col gap-2">
              <div className="flex items-baseline justify-between">
                <div className="flex items-baseline gap-1.5">
                  <span className="font-headline-md text-on-surface font-bold">{presentCount}</span>
                  <span className="font-body-md text-on-surface-variant">
                    of {totalCount} present
                  </span>
                </div>
                {flaggedCount > 0 && (
                  <div className="flex items-center gap-1 font-label-sm text-[12px] text-secondary">
                    <span className="material-symbols-outlined text-[14px]">flag</span>
                    {flaggedCount} need review
                  </div>
                )}
              </div>
              {totalCount > 0 && (
                <div className="w-full h-2 bg-surface-variant rounded-full overflow-hidden">
                  <div
                    className="bg-primary h-full rounded-full transition-all duration-500"
                    style={{ width: `${Math.round((presentCount / totalCount) * 100)}%` }}
                  />
                </div>
              )}
              {totalCount > 0 && (
                <span className="font-label-sm text-[11px] text-outline">
                  {Math.round((presentCount / totalCount) * 100)}% attendance rate
                </span>
              )}
            </div>
          </section>
        )}

        {/* Filter tabs */}
        <nav className="w-full overflow-x-auto no-scrollbar flex items-center gap-2 py-0.5">
          {(['all', 'flagged', 'pending'] as const).map((tab) => {
            const count =
              tab === 'all' ? totalCount : tab === 'flagged' ? flaggedCount : pendingCount;
            const isActive = filter === tab;
            return (
              <button
                key={tab}
                onClick={() => setFilter(tab)}
                className={[
                  'px-4 py-1.5 rounded-full font-label-md text-[13px] whitespace-nowrap transition-all',
                  'flex items-center gap-1.5 active:scale-95',
                  isActive
                    ? 'bg-primary text-on-primary shadow-[0_2px_8px_rgba(18,106,58,0.25)]'
                    : 'bg-surface-container-highest text-on-surface-variant',
                ].join(' ')}
              >
                <span className="capitalize">{tab}</span>
                <span
                  className={[
                    'px-1.5 rounded-full text-[11px]',
                    isActive
                      ? 'bg-primary-container text-on-primary'
                      : 'bg-surface-variant text-on-surface-variant',
                  ].join(' ')}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </nav>

        {/* Record list */}
        <div className="flex flex-col gap-2">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <span className="material-symbols-outlined text-[48px] text-outline-variant">
                {filter === 'flagged' ? 'flag_circle' : 'check_circle'}
              </span>
              <p className="font-body-md text-on-surface-variant text-center">
                {filter === 'all'
                  ? 'No records yet.'
                  : filter === 'flagged'
                    ? 'No flagged records.'
                    : 'No pending records.'}
              </p>
            </div>
          ) : (
            filtered.map((rec) => (
              <RecordRow
                key={rec.id}
                record={rec}
                onApprove={handleApprove}
                onReject={handleReject}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default function SessionReviewPage() {
  return (
    <TeacherGuard>
      <ReviewContent />
    </TeacherGuard>
  );
}
