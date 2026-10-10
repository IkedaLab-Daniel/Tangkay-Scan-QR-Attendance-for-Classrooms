'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { TeacherGuard } from '@/lib/auth';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { EmptyState } from '@/components/ui/EmptyState';
import { Spinner } from '@/components/ui/Spinner';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PendingRecord {
  id: string;
  student_id: string;
  approval_status: string;
  method: 'qr_scan' | 'manual';
  location_flag: string | null;
  risk_score: string | null;
  distance_m: number | null;
  selfie_url: string | null;
  officer_note: string | null;
  scanned_at: string;
  student?: { id: string; name: string };
  markedBy?: { name: string; officerTitle: string | null };
}

type DecisionState =
  | { type: 'idle' }
  | { type: 'approved' }
  | { type: 'rejected' }
  | { type: 'submitting' };

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

// ─── Location flag chip ───────────────────────────────────────────────────────

function LocationChip({
  flag,
  distanceM,
}: {
  flag: string | null;
  distanceM: number | null;
}) {
  const dist = distanceM != null ? ` (${distanceM}m)` : '';

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
        {`Mismatch${dist}`}
      </span>
    );
  }
  if (flag === 'unverified') {
    return (
      <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-secondary-fixed text-on-secondary-fixed-variant font-label-sm text-[11px]">
        <span className="material-symbols-outlined text-[12px]">near_me</span>
        {`Unverified${dist}`}
      </span>
    );
  }
  return null;
}

// ─── Risk chip (only for medium/high) ────────────────────────────────────────

function RiskChip({ score }: { score: string | null }) {
  if (!score || score === 'low') return null;
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

// ─── Selfie bottom sheet ──────────────────────────────────────────────────────

function SelfieSheet({
  open,
  onClose,
  selfieUrl,
  studentName,
}: {
  open: boolean;
  onClose: () => void;
  selfieUrl: string;
  studentName: string;
}) {
  return (
    <BottomSheet open={open} onClose={onClose} title={`${studentName} — Selfie`}>
      <div className="px-5 pb-8 flex flex-col items-center gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={selfieUrl}
          alt={`Selfie of ${studentName}`}
          className="w-full max-h-[70vh] object-contain rounded-2xl bg-surface-container"
        />
        <p className="font-body-sm text-[12px] text-on-surface-variant text-center">
          Photo captured at time of manual check-in
        </p>
      </div>
    </BottomSheet>
  );
}

// ─── Reject reason bottom sheet ───────────────────────────────────────────────

function RejectSheet({
  open,
  onClose,
  onSubmit,
  studentName,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => void;
  studentName: string;
}) {
  const [reason, setReason] = useState('');
  return (
    <BottomSheet open={open} onClose={onClose} title={`Reject — ${studentName}`}>
      <div className="px-5 pb-8 flex flex-col gap-4">
        <p className="font-body-sm text-[13px] text-on-surface-variant">
          Optionally add a reason for rejection (max 200 characters).
        </p>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value.slice(0, 200))}
          placeholder="Reason (optional)"
          rows={3}
          className="w-full rounded-xl border border-outline-variant/50 bg-surface-container-low
                     px-3 py-2.5 font-body-md text-[14px] text-on-surface placeholder:text-outline
                     focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
        />
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 h-11 rounded-full bg-surface-container text-on-surface-variant
                       font-label-lg text-[14px] active:scale-[0.98] transition-all"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              onSubmit(reason);
              setReason('');
            }}
            className="flex-1 h-11 rounded-full bg-error-container text-on-error-container
                       font-label-lg text-[14px] active:scale-[0.98] transition-all"
          >
            Confirm reject
          </button>
        </div>
      </div>
    </BottomSheet>
  );
}

// ─── Approval card ────────────────────────────────────────────────────────────

function ApprovalCard({
  record,
  sessionId,
  onDecision,
}: {
  record: PendingRecord;
  sessionId: string;
  onDecision: (id: string, decision: 'approved' | 'rejected') => void;
}) {
  const [decisionState, setDecisionState] = useState<DecisionState>({ type: 'idle' });
  const [selfieOpen, setSelfieOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);

  const name = record.student?.name ?? 'Unknown';
  const initials = getInitials(name);
  const officerName = record.markedBy?.name ?? 'Unknown Officer';
  const officerTitle = record.markedBy?.officerTitle ?? 'Officer';
  const isIdle = decisionState.type === 'idle';

  async function submitDecision(decision: 'approved' | 'rejected', reason?: string) {
    setDecisionState({ type: 'submitting' });
    try {
      await api.patch(`/api/sessions/${sessionId}/records/${record.id}/approve`, {
        decision,
        ...(reason ? { reason } : {}),
      });
      setDecisionState({ type: decision });
      // Brief pause then remove card
      setTimeout(() => onDecision(record.id, decision), 700);
    } catch {
      setDecisionState({ type: 'idle' });
    }
  }

  if (decisionState.type === 'approved') {
    return (
      <article className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-primary-fixed/30 transition-all duration-300">
        <span
          className="material-symbols-outlined text-[20px] text-primary"
          style={{ fontVariationSettings: "'FILL' 1" }}
        >
          check_circle
        </span>
        <span className="font-label-lg text-[14px] text-primary">{name} — Approved ✓</span>
      </article>
    );
  }

  if (decisionState.type === 'rejected') {
    return (
      <article className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-error-container/30 transition-all duration-300">
        <span className="material-symbols-outlined text-[20px] text-error">cancel</span>
        <span className="font-label-lg text-[14px] text-error">{name} — Rejected</span>
      </article>
    );
  }

  return (
    <>
      <article className="flex flex-col rounded-[20px] bg-surface-container-lowest p-4 shadow-[0_4px_16px_rgba(43,42,38,0.05),0_1px_2px_rgba(43,42,38,0.03)] transition-all duration-300">
        {/* Student row */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-full bg-surface-container-high flex items-center justify-center text-primary font-headline-sm text-[16px] font-semibold shrink-0">
              {initials}
            </div>
            <div className="flex flex-col">
              <span className="font-label-lg text-[14px] text-on-surface leading-tight font-semibold">
                {name}
              </span>
              <span className="font-body-sm text-[12px] text-on-surface-variant">
                {record.student?.id ?? ''}
              </span>
            </div>
          </div>
          <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-surface-container text-on-surface-variant font-label-sm text-[11px] shrink-0">
            {formatTime(record.scanned_at)}
          </span>
        </div>

        {/* Officer metadata */}
        <div className="flex items-center gap-1.5 py-1.5 px-2.5 rounded-lg bg-surface-container-low mb-3">
          <span className="material-symbols-outlined text-[16px] text-tertiary">schedule</span>
          <p className="font-body-sm text-[12px] text-on-surface-variant">
            Marked by{' '}
            <span className="font-semibold text-on-surface">{officerName}</span>{' '}
            <span className="text-tertiary">({officerTitle})</span>
          </p>
        </div>

        {/* Selfie + note split layout */}
        {(record.selfie_url || record.officer_note) && (
          <div className="grid grid-cols-3 gap-3 mb-4">
            {record.selfie_url ? (
              <button
                onClick={() => setSelfieOpen(true)}
                className="col-span-1 relative rounded-xl overflow-hidden aspect-square bg-surface-container active:scale-[0.98] transition-all"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={record.selfie_url}
                  alt={`Selfie of ${name}`}
                  className="w-full h-full object-cover"
                />
                <span className="absolute bottom-1 right-1 bg-inverse-surface/75 text-inverse-on-surface px-1.5 py-0.5 rounded text-[9px] font-label-sm">
                  Photo
                </span>
              </button>
            ) : (
              <div className="col-span-1 rounded-xl aspect-square bg-surface-container flex items-center justify-center">
                <span className="material-symbols-outlined text-[24px] text-outline-variant">
                  hide_image
                </span>
              </div>
            )}
            {record.officer_note && (
              <div className="col-span-2 flex flex-col justify-between bg-surface-container-low p-2.5 rounded-xl">
                <div className="flex flex-col gap-1">
                  <span className="font-label-sm text-[10px] text-tertiary font-semibold uppercase tracking-wider">
                    Officer Note
                  </span>
                  <p className="font-body-sm text-[12px] text-on-surface italic leading-snug">
                    &ldquo;{record.officer_note}&rdquo;
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Location + risk chips */}
        {(record.location_flag || (record.risk_score && record.risk_score !== 'low')) && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            <LocationChip flag={record.location_flag} distanceM={record.distance_m} />
            <RiskChip score={record.risk_score} />
          </div>
        )}

        {/* Action buttons */}
        <div className="grid grid-cols-2 gap-2 pt-1">
          <button
            onClick={() => setRejectOpen(true)}
            disabled={decisionState.type === 'submitting'}
            className="w-full py-2.5 px-4 rounded-full bg-error-container text-on-error-container
                       font-label-lg text-[14px] font-semibold text-center
                       hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50
                       flex items-center justify-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[16px]">close</span>
            Reject
          </button>
          <button
            onClick={() => submitDecision('approved')}
            disabled={decisionState.type === 'submitting'}
            className="w-full py-2.5 px-4 rounded-full bg-primary text-on-primary
                       font-label-lg text-[14px] font-semibold text-center
                       shadow-[0_4px_12px_rgba(18,106,58,0.22)] hover:opacity-95
                       active:scale-[0.98] transition-all disabled:opacity-50
                       flex items-center justify-center gap-1.5"
          >
            {decisionState.type === 'submitting' ? (
              <Spinner className="h-4 w-4" />
            ) : (
              <>
                <span className="material-symbols-outlined text-[16px]">check</span>
                Approve
              </>
            )}
          </button>
        </div>
      </article>

      {/* Selfie lightbox */}
      {record.selfie_url && (
        <SelfieSheet
          open={selfieOpen}
          onClose={() => setSelfieOpen(false)}
          selfieUrl={record.selfie_url}
          studentName={name}
        />
      )}

      {/* Reject reason sheet */}
      <RejectSheet
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        onSubmit={(reason) => {
          setRejectOpen(false);
          submitDecision('rejected', reason);
        }}
        studentName={name}
      />
    </>
  );
}

// ─── Main content ─────────────────────────────────────────────────────────────

function ApprovalsContent() {
  const params = useParams();
  const roomId = params.id as string;
  const sessionId = params.sessionId as string;

  const [records, setRecords] = useState<PendingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [roomName, setRoomName] = useState<string>('');

  const load = useCallback(() => {
    Promise.all([
      api
        .get<{ data: PendingRecord[] }>(
          `/api/sessions/${sessionId}/records?filter=pending_approval`,
        )
        .catch(() => ({ data: [] })),
      api
        .get<{ name: string }>(`/api/rooms/${roomId}`)
        .catch(() => ({ name: '' })),
    ]).then(([recs, room]) => {
      setRecords(recs.data ?? []);
      setRoomName(room.name ?? '');
      setLoading(false);
    });
  }, [roomId, sessionId]);

  useEffect(() => {
    load();
  }, [load]);

  function handleDecision(id: string) {
    // Remove the card from state after decision animation completes
    setRecords((prev) => prev.filter((r) => r.id !== id));
  }

  const pendingCount = records.length;

  if (loading) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-surface">
      <PageHeader title="Pending Approvals" subtitle={roomName || undefined} back />

      <div className="flex flex-col px-margin pt-20 pb-10 gap-space-md">
        {/* Summary bar */}
        <div className="flex flex-col gap-space-xs pt-space-xs">
          <p className="font-body-md text-[13px] text-on-surface-variant">
            Manual attendance marked by student officers requiring your confirmation.
          </p>
          <div className="flex items-center justify-between">
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-tertiary-fixed text-on-tertiary-fixed font-label-md text-[13px] shadow-sm">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              <span>
                {pendingCount === 0
                  ? 'All records verified'
                  : `${pendingCount} entr${pendingCount === 1 ? 'y' : 'ies'} awaiting review`}
              </span>
            </div>
          </div>
        </div>

        {/* Cards list or empty state */}
        {pendingCount === 0 ? (
          <EmptyState
            title="All caught up!"
            description="All officer manual entries have been reviewed and logged."
          />
        ) : (
          <div className="flex flex-col gap-space-md">
            {records.map((rec) => (
              <ApprovalCard
                key={rec.id}
                record={rec}
                sessionId={sessionId}
                onDecision={handleDecision}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function PendingApprovalsPage() {
  return (
    <TeacherGuard>
      <ApprovalsContent />
    </TeacherGuard>
  );
}
