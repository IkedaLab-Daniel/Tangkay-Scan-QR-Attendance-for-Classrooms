'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { StudentGuard } from '@/lib/auth';
import { api } from '@/lib/api';
import { AttendanceSummary, StudentRecord } from '@/lib/types';
import { PageHeader } from '@/components/ui/PageHeader';
import { Spinner } from '@/components/ui/Spinner';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatRecordDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function formatRecordTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({
  value,
  label,
  icon,
}: {
  value: string | number;
  label: string;
  icon: string;
}) {
  return (
    <div className="flex-1 bg-surface-container-lowest rounded-2xl px-3 py-3 shadow-sm flex flex-col items-start gap-1 min-w-[90px]">
      <span className="material-symbols-outlined text-primary text-[18px]">{icon}</span>
      <span className="font-headline-sm text-on-surface font-bold">{value}</span>
      <span className="font-label-sm text-on-surface-variant text-[11px] leading-tight">{label}</span>
    </div>
  );
}

// ─── Record row ───────────────────────────────────────────────────────────────

function RecordRow({ record }: { record: StudentRecord }) {
  const isFlagged =
    record.location_flag === 'mismatch' ||
    record.risk_score === 'high' ||
    record.risk_score === 'medium';

  return (
    <div
      className={[
        'w-full bg-surface-container-lowest rounded-2xl p-4 shadow-sm',
        'flex items-start justify-between gap-3',
        isFlagged ? 'ring-1 ring-secondary/30' : '',
      ].join(' ')}
    >
      {/* Left: date, time, room */}
      <div className="flex flex-col min-w-0 gap-0.5">
        <div className="flex items-center gap-2">
          <span className="font-label-lg text-on-surface">
            {formatRecordDate(record.scanned_at)}
          </span>
          {isFlagged && (
            <span className="material-symbols-outlined text-secondary text-[16px]">warning</span>
          )}
        </div>
        <span className="font-body-sm text-outline">{formatRecordTime(record.scanned_at)}</span>
        <span className="font-body-md text-on-surface-variant truncate">{record.room.name}</span>
      </div>

      {/* Right: method + status badges */}
      <div className="flex flex-col items-end shrink-0 gap-1">
        {/* Method */}
        <span className="px-2 py-0.5 rounded-full bg-surface-container text-outline font-label-sm text-[11px]">
          {record.method === 'qr_scan' ? 'QR' : 'Manual'}
        </span>

        {/* Approval status */}
        {record.approval_status === 'approved' ? (
          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary-fixed text-on-primary-fixed-variant font-label-sm text-[11px]">
            <span
              className="material-symbols-outlined text-[12px] text-primary"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              check_circle
            </span>
            Present
          </span>
        ) : record.approval_status === 'pending' ? (
          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-tertiary-fixed text-on-tertiary-fixed font-label-sm text-[11px]">
            <span className="material-symbols-outlined text-[12px]">hourglass_empty</span>
            Pending
          </span>
        ) : (
          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-error-container text-on-error-container font-label-sm text-[11px]">
            <span className="material-symbols-outlined text-[12px]">cancel</span>
            Rejected
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Grouped section ──────────────────────────────────────────────────────────

function RoomGroup({ roomName, records }: { roomName: string; records: StudentRecord[] }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="font-label-md text-on-surface-variant px-1 uppercase tracking-wider text-[11px]">
        {roomName}
      </h3>
      {records.map((rec) => (
        <RecordRow key={rec.id} record={rec} />
      ))}
    </div>
  );
}

// ─── Main content ─────────────────────────────────────────────────────────────

function StudentReportsContent() {
  const [summary, setSummary] = useState<AttendanceSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<AttendanceSummary>('/api/student/my-attendance-summary')
      .then(setSummary)
      .catch(() => setSummary(null))
      .finally(() => setLoading(false));
  }, []);

  // Group records by room name
  const grouped = useMemo(() => {
    if (!summary) return [];
    const map = new Map<string, StudentRecord[]>();
    summary.recentRecords.forEach((rec) => {
      const key = rec.room.name;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(rec);
    });
    return Array.from(map.entries()).map(([name, records]) => ({ name, records }));
  }, [summary]);

  // Compute this-month percentage text
  const monthPctLabel = useMemo(() => {
    if (!summary) return '—';
    if (summary.total === 0) return '—';
    // rough: thisMonth / expected sessions per month (use total / 5 as rough months, min 1)
    const pct = Math.round((summary.thisMonth / Math.max(summary.total, 1)) * 100);
    return `${pct}%`;
  }, [summary]);

  const filterAction = (
    <button
      aria-label="Filter"
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

      <div className="flex flex-col pt-20 pb-10 gap-space-md px-margin">
        {/* My Attendance header */}
        <div className="flex flex-col gap-space-sm pt-space-xs">
          <h2 className="font-headline-md text-on-surface">My Attendance</h2>

          {/* Stat cards */}
          <div className="flex items-stretch gap-3">
            <StatCard
              value={summary?.total ?? 0}
              label="Total Present"
              icon="check_circle"
            />
            <StatCard
              value={summary?.streak ?? 0}
              label="On-time streak"
              icon="local_fire_department"
            />
            <StatCard
              value={monthPctLabel}
              label="This Month"
              icon="calendar_month"
            />
          </div>
        </div>

        {/* History */}
        {grouped.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <span className="material-symbols-outlined text-[48px] text-outline-variant">
              assignment
            </span>
            <p className="font-body-md text-on-surface-variant text-center">
              No attendance records yet.
              <br />
              Scan in to a session to see your history here.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-space-md">
            {grouped.map(({ name, records }) => (
              <RoomGroup key={name} roomName={name} records={records} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function StudentReportsPage() {
  return (
    <StudentGuard>
      <StudentReportsContent />
    </StudentGuard>
  );
}
