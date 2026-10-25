'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { TeacherGuard } from '@/lib/auth';
import { api } from '@/lib/api';
import { AttendanceRecord, AttendanceSession } from '@/lib/types';
import { PageHeader } from '@/components/ui/PageHeader';
import { Badge, BadgeVariant } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';

type FilterTab = 'all' | 'flagged' | 'pending';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function methodLabel(method: string): string {
  if (method === 'qr_scan') return 'QR';
  if (method === 'manual') return 'Manual';
  return method;
}

function methodVariant(method: string): BadgeVariant {
  if (method === 'manual') return 'manual';
  return 'present';
}

function approvalVariant(status: string): BadgeVariant {
  if (status === 'pending') return 'pending';
  if (status === 'rejected') return 'absent';
  return 'present';
}

function isFlagged(record: AttendanceRecord): boolean {
  return (
    record.location_flag !== 'ok' ||
    record.risk_score === 'high' ||
    record.approval_status === 'rejected' ||
    (record.risk_signals ?? []).length > 0
  );
}

function SessionDetailContent() {
  const params = useParams();
  const roomId = params.id as string;
  const sessionId = params.sessionId as string;

  const [session, setSession] = useState<AttendanceSession | null>(null);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterTab>('all');

  useEffect(() => {
    Promise.all([
      api.get<AttendanceSession>(`/api/sessions/${sessionId}`).catch(() => null),
      api.get<{ data: AttendanceRecord[]; pagination: unknown }>(`/api/sessions/${sessionId}/records`).catch(() => ({ data: [] })),
    ]).then(([s, r]) => {
      setSession(s);
      setRecords(r.data ?? []);
    }).finally(() => setLoading(false));
  }, [roomId, sessionId]);

  function handleExport() {
    const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
    window.open(`${BASE}/api/rooms/${roomId}/sessions/${sessionId}/export`, '_blank');
  }

  const filtered = records.filter((rec) => {
    if (filter === 'flagged') return isFlagged(rec);
    if (filter === 'pending') return rec.approval_status === 'pending';
    return true;
  });

  const presentCount = records.filter((r) => r.approval_status === 'approved').length;
  const flaggedCount = records.filter(isFlagged).length;
  const pendingCount = records.filter((r) => r.approval_status === 'pending').length;

  const exportButton = (
    <button
      aria-label="Export CSV"
      onClick={handleExport}
      className="w-9 h-9 flex items-center justify-center rounded-full
                 text-on-surface-variant hover:bg-surface-container transition-colors"
    >
      <span className="material-symbols-outlined text-[20px]">download</span>
    </button>
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const title = session ? formatDate(session.started_at) : 'Session';

  return (
    <div className="flex flex-col min-h-screen bg-surface">
      <PageHeader title={title} back action={exportButton} />

      <div className="flex flex-col px-margin pt-20 pb-10 gap-space-md">
        {/* Summary chips */}
        <div className="flex items-center gap-2 flex-wrap pt-space-xs">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary-fixed text-on-primary-fixed">
            <span className="material-symbols-outlined text-[16px]" style={{ fontVariationSettings: "'FILL' 1" }}>
              check_circle
            </span>
            <span className="font-label-sm text-[11px]">{presentCount} present</span>
          </div>
          {flaggedCount > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-secondary-container/40 text-on-secondary-container">
              <span className="material-symbols-outlined text-[16px]">flag</span>
              <span className="font-label-sm text-[11px]">{flaggedCount} flagged</span>
            </div>
          )}
          {pendingCount > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-tertiary-fixed text-on-tertiary-fixed">
              <span className="material-symbols-outlined text-[16px]">hourglass_empty</span>
              <span className="font-label-sm text-[11px]">{pendingCount} pending</span>
            </div>
          )}
        </div>

        {/* Filter tabs */}
        <div className="grid grid-cols-3 p-1 rounded-full bg-surface-container-high shadow-inner">
          {(['all', 'flagged', 'pending'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setFilter(t)}
              className={[
                'py-2 rounded-full font-label-md text-[12px] capitalize transition-all',
                filter === t
                  ? 'bg-primary-fixed text-on-primary-fixed shadow-sm'
                  : 'text-tertiary hover:text-on-surface',
              ].join(' ')}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Attendance list */}
        {filtered.length === 0 ? (
          <p className="text-center text-on-surface-variant font-body-md py-8">
            {filter === 'all' ? 'No attendance records yet.' : `No ${filter} records.`}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {filtered.map((rec) => {
              const flagged = isFlagged(rec);
              const name = rec.student?.name ?? 'Unknown';
              const initials = name.trim().split(/\s+/).map((p) => p[0]).join('').toUpperCase().slice(0, 2);

              return (
                <div
                  key={rec.id}
                  className={[
                    'flex items-center justify-between p-3.5 rounded-2xl',
                    'bg-surface-container-lowest shadow-sm',
                    flagged ? 'border-l-2 border-secondary-container' : '',
                  ].join(' ')}
                >
                  {/* Avatar + name */}
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-full bg-surface-container text-tertiary
                                    font-headline-sm text-[16px] flex items-center justify-center shrink-0">
                      {initials}
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="font-label-lg text-[14px] text-on-surface truncate">{name}</span>
                      <span className="font-body-sm text-[12px] text-tertiary">
                        {new Date(rec.scanned_at).toLocaleTimeString('en-US', {
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                  </div>

                  {/* Badges */}
                  <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                    <Badge
                      variant={methodVariant(rec.method)}
                      label={methodLabel(rec.method)}
                    />
                    <Badge
                      variant={approvalVariant(rec.approval_status)}
                      label={rec.approval_status.charAt(0).toUpperCase() + rec.approval_status.slice(1)}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default function SessionDetailPage() {
  return (
    <TeacherGuard>
      <SessionDetailContent />
    </TeacherGuard>
  );
}
