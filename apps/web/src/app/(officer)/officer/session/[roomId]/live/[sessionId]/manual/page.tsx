'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { OfficerGuard } from '@/lib/auth';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Spinner } from '@/components/ui/Spinner';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AbsentStudent {
  id: string;
  name: string;
}

type MarkStatus = 'idle' | 'marked' | 'error';

interface StudentRowState {
  status: MarkStatus;
  errorMsg?: string;
}

// ─── Camera sheet ─────────────────────────────────────────────────────────────

interface CameraSheetProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (photoDataUrl?: string) => Promise<void>;
  studentName: string;
}

function CameraSheet({ open, onClose, onSubmit, studentName }: CameraSheetProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);

  // Start camera when sheet opens
  useEffect(() => {
    if (!open) return;
    setPhoto(null);
    setCamError(null);

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then((stream) => {
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      })
      .catch((err: Error) => setCamError(err.message));

    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [open]);

  function capture() {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    setPhoto(canvas.toDataURL('image/jpeg', 0.8));
  }

  async function handleSubmit() {
    setSubmitting(true);
    await onSubmit(photo ?? undefined);
    setSubmitting(false);
  }

  function handleClose() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setPhoto(null);
    onClose();
  }

  return (
    <BottomSheet open={open} onClose={handleClose} title={`Mark present — ${studentName}`}>
      <div className="flex flex-col px-5 pb-6 gap-space-md">
        {camError ? (
          <div className="rounded-lg bg-error-container p-space-sm">
            <p className="font-body-sm text-[12px] text-on-error-container">
              Camera unavailable: {camError}
            </p>
          </div>
        ) : photo ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={photo} alt="Captured photo" className="w-full rounded-xl object-cover max-h-64" />
        ) : (
          <div className="relative w-full rounded-xl overflow-hidden bg-surface-container aspect-video">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />
          </div>
        )}

        {/* Hidden canvas for capture */}
        <canvas ref={canvasRef} className="hidden" />

        <div className="flex gap-space-sm">
          {!photo ? (
            <button
              onClick={capture}
              className="flex-1 h-11 rounded-full bg-primary text-on-primary font-label-lg text-[14px]
                         flex items-center justify-center gap-2 active:scale-[0.98] transition-all"
            >
              <span className="material-symbols-outlined text-[20px]">photo_camera</span>
              Take photo
            </button>
          ) : (
            <>
              <button
                onClick={() => setPhoto(null)}
                className="flex-1 h-11 rounded-full border border-outline-variant text-on-surface font-label-lg text-[14px]
                           flex items-center justify-center gap-2 active:scale-[0.98] transition-all"
              >
                Retake
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="flex-1 h-11 rounded-full bg-primary text-on-primary font-label-lg text-[14px]
                           flex items-center justify-center gap-2 active:scale-[0.98] transition-all
                           disabled:opacity-50"
              >
                {submitting ? <Spinner className="h-5 w-5" /> : 'Confirm'}
              </button>
            </>
          )}
        </div>

        {/* Skip photo option */}
        <button
          onClick={() => onSubmit(undefined).finally(() => {})}
          className="font-label-md text-[12px] text-outline hover:text-on-surface transition-colors text-center"
        >
          Mark present without photo
        </button>
      </div>
    </BottomSheet>
  );
}

// ─── Main content ─────────────────────────────────────────────────────────────

function ManualCheckinContent() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const router = useRouter();

  const [students, setStudents] = useState<AbsentStudent[]>([]);
  const [rowState, setRowState] = useState<Record<string, StudentRowState>>({});
  const [loading, setLoading] = useState(true);
  const [selectedStudent, setSelectedStudent] = useState<AbsentStudent | null>(null);

  const loadRoster = useCallback(() => {
    if (!sessionId) return;
    api
      .get<AbsentStudent[]>(`/api/sessions/${sessionId}/absent-roster`)
      .then((data) => setStudents(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [sessionId]);

  useEffect(() => {
    loadRoster();
  }, [loadRoster]);

  async function markPresent(student: AbsentStudent, photoDataUrl?: string) {
    try {
      await api.post(`/api/sessions/${sessionId}/manual`, {
        studentId: student.id,
        ...(photoDataUrl ? { photoDataUrl } : {}),
      });
      setRowState((prev) => ({ ...prev, [student.id]: { status: 'marked' } }));
      // Remove from list after short delay
      setTimeout(() => {
        setStudents((prev) => prev.filter((s) => s.id !== student.id));
      }, 800);
    } catch (err: unknown) {
      const e = err as { body?: { error?: string }; message?: string };
      setRowState((prev) => ({
        ...prev,
        [student.id]: { status: 'error', errorMsg: e?.body?.error ?? e?.message ?? 'Failed' },
      }));
    } finally {
      setSelectedStudent(null);
    }
  }

  return (
    <div className="flex flex-col w-full min-h-screen bg-surface">
      <PageHeader back title="Manual Check-in" />

      <div className="flex flex-col px-margin pt-20 pb-8 gap-space-md">
        {loading ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : students.length === 0 ? (
          <div className="flex flex-col items-center gap-space-sm py-16">
            <span
              className="material-symbols-outlined text-[48px] text-primary"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              how_to_reg
            </span>
            <p className="font-headline-sm text-on-surface">All students present!</p>
            <p className="font-body-sm text-[12px] text-on-surface-variant text-center">
              No remaining absent students
            </p>
            <button
              onClick={() => router.back()}
              className="mt-space-md font-label-md text-[12px] text-primary hover:text-primary-container transition-colors"
            >
              Back to live session
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-space-xs">
              <span className="material-symbols-outlined text-[20px] text-on-surface-variant">
                person_off
              </span>
              <h2 className="font-label-lg text-[14px] text-on-surface-variant">
                {students.length} student{students.length !== 1 ? 's' : ''} not yet present
              </h2>
            </div>

            <div className="flex flex-col gap-space-xs">
              {students.map((student) => {
                const state = rowState[student.id];
                const isMarked = state?.status === 'marked';
                const hasError = state?.status === 'error';

                return (
                  <div
                    key={student.id}
                    className={[
                      'flex items-center gap-space-sm px-space-sm py-3 rounded-xl transition-all',
                      isMarked
                        ? 'bg-primary-fixed/40'
                        : 'bg-surface-container-lowest shadow-sm',
                    ].join(' ')}
                  >
                    {/* Avatar */}
                    <div className="w-10 h-10 rounded-full bg-surface-container-high flex items-center justify-center text-on-surface-variant shrink-0">
                      <span className="font-headline-sm text-[16px]">
                        {student.name.charAt(0).toUpperCase()}
                      </span>
                    </div>

                    {/* Name */}
                    <div className="flex-grow min-w-0">
                      <span className="font-label-lg text-[14px] text-on-surface truncate block">
                        {student.name}
                      </span>
                      {hasError && (
                        <span className="font-body-sm text-[12px] text-error">
                          {state.errorMsg}
                        </span>
                      )}
                    </div>

                    {/* Action */}
                    {isMarked ? (
                      <span className="flex items-center gap-1 font-label-sm text-[11px] text-primary shrink-0">
                        <span
                          className="material-symbols-outlined text-[18px]"
                          style={{ fontVariationSettings: "'FILL' 1" }}
                        >
                          check_circle
                        </span>
                        Marked
                      </span>
                    ) : (
                      <button
                        onClick={() => setSelectedStudent(student)}
                        className="shrink-0 h-9 px-4 rounded-full bg-primary text-on-primary
                                   font-label-md text-[12px] active:scale-[0.98] transition-all"
                      >
                        Mark present
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Camera bottom sheet */}
      {selectedStudent && (
        <CameraSheet
          open={selectedStudent !== null}
          onClose={() => setSelectedStudent(null)}
          onSubmit={(photo) => markPresent(selectedStudent, photo)}
          studentName={selectedStudent.name}
        />
      )}
    </div>
  );
}

export default function OfficerManualCheckinPage() {
  return (
    <OfficerGuard>
      <ManualCheckinContent />
    </OfficerGuard>
  );
}
