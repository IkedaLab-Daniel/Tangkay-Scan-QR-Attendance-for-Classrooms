'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { OfficerGuard } from '@/lib/auth';
import { api } from '@/lib/api';
import { ManualRecord } from '@/lib/types';
import { PageHeader } from '@/components/ui/PageHeader';
import { Spinner } from '@/components/ui/Spinner';

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: ManualRecord['approval_status'] }) {
  if (status === 'approved') {
    return (
      <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary-fixed text-on-primary-fixed font-label-sm text-[11px]">
        <span
          className="material-symbols-outlined text-[12px]"
          style={{ fontVariationSettings: "'FILL' 1" }}
        >
          check_circle
        </span>
        Approved
      </span>
    );
  }
  if (status === 'rejected') {
    return (
      <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-error-container text-on-error-container font-label-sm text-[11px]">
        <span className="material-symbols-outlined text-[12px]">cancel</span>
        Rejected
      </span>
    );
  }
  // pending
  return (
    <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-secondary-fixed-dim/40 text-on-secondary-fixed-variant font-label-sm text-[11px]">
      <span className="material-symbols-outlined text-[12px]">pending</span>
      Pending
    </span>
  );
}

// ─── Record row ───────────────────────────────────────────────────────────────

function ManualRecordRow({ record }: { record: ManualRecord }) {
  const name = record.student?.name ?? 'Unknown';
  const initials = getInitials(name);

  return (
    <article className="w-full bg-surface-container-lowest rounded-xl px-4 py-3 shadow-sm flex items-center justify-between gap-3">
      {/* Left: avatar + name + time */}
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-10 h-10 rounded-full bg-surface-container-high flex items-center justify-center text-on-surface-variant font-headline-sm text-[15px] font-semibold shrink-0">
          {initials}
        </div>
        <div className="flex flex-col min-w-0">
          <span className="font-label-lg text-[14px] text-on-surface truncate">{name}</span>
          <span className="font-body-sm text-[12px] text-on-surface-variant">
            {formatTime(record.scanned_at)}
          </span>
        </div>
      </div>

      {/* Right: status badge */}
      <div className="shrink-0">
        <StatusBadge status={record.approval_status} />
      </div>
    </article>
  );
}

// ─── Main content ─────────────────────────────────────────────────────────────

function ManualHistoryContent() {
  const { sessionId } = useParams<{ sessionId: string }>();

  const [records, setRecords] = useState<ManualRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!sessionId) return;
    api
      .get<{ data: ManualRecord[] }>(`/api/sessions/${sessionId}/records/manual`)
      .then((res) => setRecords(res.data ?? []))
      .catch(() => setRecords([]))
      .finally(() => setLoading(false));
  }, [sessionId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-surface">
      <PageHeader back title="Manual Entry History" />

      <div className="flex flex-col px-margin pt-20 pb-8 gap-space-md">
        {/* Summary */}
        <div className="flex items-center gap-space-xs">
          <span className="material-symbols-outlined text-[18px] text-on-surface-variant">
            edit_note
          </span>
          <h2 className="font-label-lg text-[13px] text-on-surface-variant">
            {records.length === 0
              ? 'No manual entries yet'
              : `${records.length} manual entr${records.length === 1 ? 'y' : 'ies'} in this session`}
          </h2>
        </div>

        {records.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <span className="material-symbols-outlined text-[48px] text-outline-variant">
              edit_note
            </span>
            <p className="font-body-md text-[14px] text-on-surface-variant text-center">
              No manual entries have been submitted yet.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-space-xs">
            {records.map((rec) => (
              <ManualRecordRow key={rec.id} record={rec} />
            ))}
          </div>
        )}

        {/* Read-only notice */}
        {records.length > 0 && (
          <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-surface-container-low">
            <span className="material-symbols-outlined text-[16px] text-outline">info</span>
            <p className="font-body-sm text-[12px] text-on-surface-variant">
              This is a read-only record. Approval decisions are made by the teacher.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function OfficerManualHistoryPage() {
  return (
    <OfficerGuard>
      <ManualHistoryContent />
    </OfficerGuard>
  );
}
