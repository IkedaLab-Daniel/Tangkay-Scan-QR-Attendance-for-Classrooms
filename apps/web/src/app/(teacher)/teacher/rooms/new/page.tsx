'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { TeacherGuard } from '@/lib/auth';
import { api } from '@/lib/api';
import { Input, Button, Badge, Card } from '@/components/ui';
import { useToast } from '@/components/ui/useToast';

// ── Types ─────────────────────────────────────────────────────────────────────

type AttendanceMode = 'balanced' | 'strict' | 'static' | 'manual';
type Step = 1 | 2 | 3;

interface FormState {
  roomName: string;
  subject: string;
  roomNumber: string;
  mode: AttendanceMode;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STEP_LABELS: Record<Step, string> = {
  1: 'Room Details',
  2: 'Attendance Rules',
  3: 'Confirm',
};

interface ModeConfig {
  icon: string;
  label: string;
  description: string;
  recommended?: boolean;
  tip?: string;
  gpsBadge: string;
  selfieBadge: string;
}

const MODES: Record<AttendanceMode, ModeConfig> = {
  balanced: {
    icon: 'verified_user',
    label: 'Balanced',
    description:
      'Rotating dynamic QR, gentle GPS perimeter warning, selfie check-in optional.',
    recommended: true,
    tip: 'Fastest check-in for daily classes',
    gpsBadge: 'Gentle GPS warning',
    selfieBadge: 'Selfie optional',
  },
  strict: {
    icon: 'shield',
    label: 'Strict',
    description:
      'Rotating QR code with strict geofencing lock, instant selfie validation. Best for unit exams.',
    gpsBadge: 'Strict geofence lock',
    selfieBadge: 'Selfie required',
  },
  static: {
    icon: 'print',
    label: 'Static',
    description:
      'Printed placard QR on wall, GPS lock required. Ideal for rooms without a student officer tablet.',
    gpsBadge: 'GPS lock required',
    selfieBadge: 'Selfie optional',
  },
  manual: {
    icon: 'checklist_rtl',
    label: 'Manual only',
    description:
      'Attendance officers or teachers mark each student directly on paper-style digital roster.',
    gpsBadge: 'No GPS check',
    selfieBadge: 'No selfie',
  },
};

// ── Step progress indicator ───────────────────────────────────────────────────

function StepIndicator({ step }: { step: Step }) {
  return (
    <div className="flex items-center justify-between px-margin py-2 bg-surface-container-low rounded-full shadow-sm mx-margin mt-2 mb-4">
      <div className="flex items-center gap-space-xs">
        <span className="font-label-sm text-label-sm uppercase tracking-wider text-primary">
          Step {step} of 3
        </span>
        <span className="text-tertiary font-body-sm">•</span>
        <span className="font-body-sm text-body-sm text-tertiary">{STEP_LABELS[step]}</span>
      </div>
      <div aria-label={`Progress: Step ${step} of 3`} className="flex items-center gap-1.5">
        {([1, 2, 3] as Step[]).map((s) => {
          const isActive = s === step;
          const isDone = s < step;
          return (
            <span
              key={s}
              className={[
                'rounded-full transition-all duration-300',
                isActive
                  ? 'w-6 h-2 bg-primary'
                  : isDone
                  ? 'w-2 h-2 bg-primary-fixed-dim'
                  : 'w-2 h-2 bg-surface-container-highest',
              ].join(' ')}
            />
          );
        })}
      </div>
    </div>
  );
}

// ── Sticky bottom dock ────────────────────────────────────────────────────────

interface BottomDockProps {
  step: Step;
  loading: boolean;
  onBack: () => void;
  onNext: () => void;
}

function BottomDock({ step, loading, onBack, onNext }: BottomDockProps) {
  return (
    <div className="fixed bottom-0 left-0 right-0 p-space-md bg-surface/95 backdrop-blur-md shadow-[0_-8px_24px_rgba(43,42,38,0.06)] z-40">
      <div className="max-w-md mx-auto flex items-center gap-space-sm">
        {step > 1 && (
          <button
            aria-label="Previous step"
            onClick={onBack}
            type="button"
            className="h-12 w-12 rounded-full bg-surface-container-high text-on-surface flex items-center justify-center shrink-0 active:scale-95 transition-transform"
          >
            <span className="material-symbols-outlined text-[20px]">arrow_back</span>
          </button>
        )}
        <Button
          fullWidth
          size="lg"
          loading={loading}
          onClick={onNext}
          className="flex-1 shadow-primary"
          icon={
            step === 3 ? (
              <span
                className="material-symbols-outlined text-[20px]"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                check_circle
              </span>
            ) : undefined
          }
        >
          {step === 3 ? 'Save & Open room' : 'Next →'}
        </Button>
      </div>
    </div>
  );
}

// ── Step 1 — Room Details ─────────────────────────────────────────────────────

interface Step1Props {
  form: FormState;
  nameError: string;
  onChange: (field: keyof FormState, value: string) => void;
}

function Step1({ form, nameError, onChange }: Step1Props) {
  const hasPreview = form.roomName.trim().length > 0;

  return (
    <div className="flex flex-col gap-space-lg">
      {/* Section title */}
      <div>
        <div className="flex items-center gap-space-xs mb-1">
          <span className="w-2 h-2 rounded-full bg-primary shrink-0" />
          <h2 className="font-headline-lg text-headline-lg text-on-surface">Room Details</h2>
        </div>
        <p className="font-body-md text-body-md text-tertiary ml-3.5">
          Give your classroom a name so students can find it.
        </p>
      </div>

      {/* Form fields */}
      <div className="flex flex-col gap-space-md">
        <Input
          label="Room name"
          placeholder="Grade 10 — Sampaguita"
          value={form.roomName}
          onChange={(e) => onChange('roomName', e.target.value)}
          error={nameError}
          autoFocus
        />
        <Input
          label="Subject"
          placeholder="Science & Technology"
          value={form.subject}
          onChange={(e) => onChange('subject', e.target.value)}
        />
        <Input
          label="Room number (optional)"
          placeholder="Rm 204"
          value={form.roomNumber}
          onChange={(e) => onChange('roomNumber', e.target.value)}
        />
      </div>

      {/* Live preview card */}
      {hasPreview && (
        <div>
          <p className="font-label-sm text-label-sm text-tertiary uppercase tracking-wider mb-2">
            Preview
          </p>
          <Card tint="none" className="border border-outline-variant/50">
            <div className="flex items-center gap-space-md">
              <div className="w-10 h-10 rounded-xl bg-tertiary-fixed flex items-center justify-center text-on-tertiary-fixed shrink-0">
                <span
                  className="material-symbols-outlined text-[20px]"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                >
                  science
                </span>
              </div>
              <div className="flex flex-col min-w-0">
                <p className="font-headline-sm text-headline-sm text-on-surface truncate">
                  {form.roomName}
                </p>
                {(form.subject || form.roomNumber) && (
                  <p className="font-body-sm text-body-sm text-tertiary truncate">
                    {[form.subject, form.roomNumber].filter(Boolean).join(' • ')}
                  </p>
                )}
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

// ── Step 2 — Attendance Mode ──────────────────────────────────────────────────

interface ModeCardProps {
  id: AttendanceMode;
  config: ModeConfig;
  selected: boolean;
  onSelect: (id: AttendanceMode) => void;
}

function ModeCard({ id, config, selected, onSelect }: ModeCardProps) {
  return (
    <div
      role="radio"
      aria-checked={selected}
      tabIndex={0}
      onClick={() => onSelect(id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(id);
        }
      }}
      className={[
        'relative rounded-xl p-space-md cursor-pointer transition-all active:scale-[0.99] overflow-hidden shadow-card',
        selected
          ? 'bg-primary-fixed/20 border border-primary/30'
          : 'bg-surface-container-lowest border border-transparent',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-space-sm">
        <div className="flex items-start gap-space-md min-w-0">
          {/* Icon */}
          <div
            className={[
              'w-11 h-11 rounded-xl flex items-center justify-center shrink-0 mt-0.5',
              selected
                ? 'bg-primary-fixed text-on-primary-fixed'
                : 'bg-surface-container text-tertiary',
            ].join(' ')}
          >
            <span
              className="material-symbols-outlined text-[24px]"
              style={selected ? { fontVariationSettings: "'FILL' 1" } : undefined}
            >
              {config.icon}
            </span>
          </div>

          {/* Text */}
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-space-xs flex-wrap mb-1">
              <span className="font-headline-sm text-headline-sm text-on-surface">
                {config.label}
              </span>
              {config.recommended && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-primary text-on-primary font-label-sm text-label-sm">
                  Recommended
                </span>
              )}
            </div>
            <p className="font-body-sm text-body-sm text-on-surface-variant">
              {config.description}
            </p>
            {selected && config.tip && (
              <div className="flex items-center gap-space-xs mt-space-sm text-primary font-label-sm text-label-sm">
                <span className="material-symbols-outlined text-[16px]">bolt</span>
                <span>{config.tip}</span>
              </div>
            )}
          </div>
        </div>

        {/* Radio indicator */}
        <div
          className={[
            'w-6 h-6 rounded-full flex items-center justify-center shrink-0 transition-colors',
            selected
              ? 'bg-primary text-on-primary'
              : 'bg-surface-container-high text-tertiary',
          ].join(' ')}
        >
          <span
            className={[
              'material-symbols-outlined text-[16px]',
              selected ? '' : 'opacity-0',
            ].join(' ')}
          >
            check
          </span>
        </div>
      </div>
    </div>
  );
}

interface Step2Props {
  form: FormState;
  onModeChange: (mode: AttendanceMode) => void;
  onEditDetails: () => void;
}

function Step2({ form, onModeChange, onEditDetails }: Step2Props) {
  return (
    <div className="flex flex-col gap-space-lg">
      {/* Collapsed step 1 summary */}
      <div className="bg-surface-container-lowest rounded-xl p-space-md shadow-card flex items-center justify-between group transition-all active:scale-[0.99]">
        <div className="flex items-center gap-space-md min-w-0">
          <div className="w-10 h-10 rounded-xl bg-tertiary-fixed flex items-center justify-center text-on-tertiary-fixed shrink-0">
            <span
              className="material-symbols-outlined text-[20px]"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              science
            </span>
          </div>
          <div className="flex flex-col min-w-0">
            <span className="font-label-sm text-label-sm text-tertiary uppercase">Room Details</span>
            <p className="font-headline-sm text-headline-sm text-on-surface truncate">
              {form.roomName}
            </p>
            {(form.subject || form.roomNumber) && (
              <p className="font-body-sm text-body-sm text-tertiary truncate">
                {[form.subject, form.roomNumber].filter(Boolean).join(' • ')}
              </p>
            )}
          </div>
        </div>
        <button
          aria-label="Edit room details"
          onClick={onEditDetails}
          type="button"
          className="w-9 h-9 rounded-full bg-surface-container-low text-on-surface hover:bg-surface-container-high flex items-center justify-center shrink-0 transition-colors"
        >
          <span className="material-symbols-outlined text-[18px]">edit</span>
        </button>
      </div>

      {/* Section title */}
      <div>
        <div className="flex items-center gap-space-xs mb-1">
          <span className="w-2 h-2 rounded-full bg-primary shrink-0" />
          <h2 className="font-headline-lg text-headline-lg text-on-surface">
            Choose attendance mode
          </h2>
        </div>
        <p className="font-body-md text-body-md text-tertiary ml-3.5">
          Select how students check in each period. You can adjust this anytime in room settings.
        </p>
      </div>

      {/* Mode cards */}
      <div
        role="radiogroup"
        aria-label="Attendance modes"
        className="flex flex-col gap-space-sm"
      >
        {(Object.entries(MODES) as [AttendanceMode, ModeConfig][]).map(([id, config]) => (
          <ModeCard
            key={id}
            id={id}
            config={config}
            selected={form.mode === id}
            onSelect={onModeChange}
          />
        ))}
      </div>

      {/* Student Roster Invite preview */}
      <div className="bg-surface-container-lowest rounded-xl p-space-lg shadow-card flex flex-col gap-space-md">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-space-xs">
            <span className="material-symbols-outlined text-primary text-[20px]">share</span>
            <h3 className="font-headline-sm text-headline-sm text-on-surface">
              Student Roster Invite
            </h3>
          </div>
          <span className="font-label-sm text-label-sm px-2 py-0.5 rounded-full bg-secondary-fixed text-on-secondary-fixed">
            After Save
          </span>
        </div>

        {/* Invite visual strip */}
        <div className="flex items-center gap-space-md bg-surface-container-low p-space-md rounded-xl opacity-60">
          <div className="w-14 h-14 rounded-lg bg-surface-container-lowest p-1.5 shrink-0 flex items-center justify-center shadow-card">
            <svg className="w-full h-full text-on-surface fill-current" viewBox="0 0 40 40">
              <rect fill="none" height="14" rx="2" stroke="currentColor" strokeWidth="3" width="14" x="2" y="2" />
              <rect fill="currentColor" height="6" width="6" x="6" y="6" />
              <rect fill="none" height="14" rx="2" stroke="currentColor" strokeWidth="3" width="14" x="24" y="2" />
              <rect fill="currentColor" height="6" width="6" x="28" y="6" />
              <rect fill="none" height="14" rx="2" stroke="currentColor" strokeWidth="3" width="14" x="2" y="24" />
              <rect fill="currentColor" height="6" width="6" x="6" y="28" />
              <rect height="5" width="5" x="22" y="22" />
              <rect height="5" width="6" x="31" y="22" />
              <rect height="6" width="7" x="22" y="31" />
              <rect height="6" width="5" x="33" y="31" />
            </svg>
          </div>
          <div className="flex flex-col min-w-0">
            <span className="font-label-sm text-label-sm text-tertiary uppercase">
              Room Access Link
            </span>
            <p className="font-label-lg text-label-lg text-on-surface truncate font-mono">
              tangkay.link/join/&#8203;{'{INVITE_CODE}'}
            </p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="font-body-sm text-body-sm text-tertiary">Passcode:</span>
              <span className="font-label-md text-label-md text-secondary tracking-widest bg-secondary-fixed/50 px-1.5 rounded font-mono">
                ----
              </span>
            </div>
          </div>
        </div>

        {/* Disabled action buttons */}
        <div className="grid grid-cols-2 gap-space-sm">
          <button
            disabled
            type="button"
            className="h-11 px-3 rounded-full bg-surface-container-high text-on-surface/40 flex items-center justify-center gap-space-xs cursor-not-allowed"
          >
            <span className="material-symbols-outlined text-[18px]">content_copy</span>
            <span className="font-label-lg text-label-lg">Copy link</span>
          </button>
          <button
            disabled
            type="button"
            className="h-11 px-3 rounded-full bg-primary-fixed/50 text-on-primary-fixed/50 flex items-center justify-center gap-space-xs cursor-not-allowed"
          >
            <span className="material-symbols-outlined text-[18px]">qr_code_2</span>
            <span className="font-label-lg text-label-lg">Print sheet</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Step 3 — Review & Confirm ─────────────────────────────────────────────────

interface Step3Props {
  form: FormState;
}

function Step3({ form }: Step3Props) {
  const modeConfig = MODES[form.mode];

  const modeToBadgeVariant = (mode: AttendanceMode) => {
    const map: Record<AttendanceMode, 'balanced' | 'strict' | 'static' | 'manual'> = {
      balanced: 'balanced',
      strict: 'strict',
      static: 'static',
      manual: 'manual',
    };
    return map[mode];
  };

  return (
    <div className="flex flex-col gap-space-lg">
      {/* Section title */}
      <div>
        <div className="flex items-center gap-space-xs mb-1">
          <span className="w-2 h-2 rounded-full bg-primary shrink-0" />
          <h2 className="font-headline-lg text-headline-lg text-on-surface">Review & Confirm</h2>
        </div>
        <p className="font-body-md text-body-md text-tertiary ml-3.5">
          Check your room configuration before saving.
        </p>
      </div>

      {/* Room details summary card */}
      <Card tint="none" className="border border-outline-variant/50">
        <div className="flex flex-col gap-space-sm">
          <p className="font-label-sm text-label-sm text-tertiary uppercase tracking-wider">
            Room Details
          </p>
          <div className="flex items-center gap-space-md">
            <div className="w-10 h-10 rounded-xl bg-tertiary-fixed flex items-center justify-center text-on-tertiary-fixed shrink-0">
              <span
                className="material-symbols-outlined text-[20px]"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                science
              </span>
            </div>
            <div className="flex flex-col min-w-0">
              <p className="font-headline-sm text-headline-sm text-on-surface">
                {form.roomName}
              </p>
              {(form.subject || form.roomNumber) && (
                <p className="font-body-sm text-body-sm text-tertiary">
                  {[form.subject, form.roomNumber].filter(Boolean).join(' • ')}
                </p>
              )}
            </div>
          </div>
        </div>
      </Card>

      {/* Attendance mode summary card */}
      <Card tint="none" className="border border-outline-variant/50">
        <div className="flex flex-col gap-space-md">
          <div className="flex items-center justify-between">
            <p className="font-label-sm text-label-sm text-tertiary uppercase tracking-wider">
              Attendance Mode
            </p>
            <Badge variant={modeToBadgeVariant(form.mode)} />
          </div>
          <p className="font-body-md text-body-md text-on-surface-variant">
            {modeConfig.description}
          </p>

          {/* Policy chips */}
          <div className="flex flex-wrap gap-space-sm pt-space-xs">
            <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 bg-surface-container font-label-sm text-label-sm text-on-surface-variant">
              <span className="material-symbols-outlined text-[14px] text-primary">location_on</span>
              {modeConfig.gpsBadge}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 bg-surface-container font-label-sm text-label-sm text-on-surface-variant">
              <span className="material-symbols-outlined text-[14px] text-primary">face</span>
              {modeConfig.selfieBadge}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 bg-surface-container font-label-sm text-label-sm text-on-surface-variant">
              <span className="material-symbols-outlined text-[14px] text-primary">radar</span>
              Geofence: 100 m
            </span>
          </div>

          <p className="font-body-sm text-body-sm text-outline">
            Geofence radius defaults to 100 m — configurable in settings after saving.
          </p>
        </div>
      </Card>
    </div>
  );
}

// ── Page component ────────────────────────────────────────────────────────────

function NewRoomContent() {
  const router = useRouter();
  const { toast } = useToast();

  const [step, setStep] = useState<Step>(1);
  const [loading, setLoading] = useState(false);
  const [nameError, setNameError] = useState('');

  const [form, setForm] = useState<FormState>({
    roomName: '',
    subject: '',
    roomNumber: '',
    mode: 'balanced',
  });

  function handleFieldChange(field: keyof FormState, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (field === 'roomName' && nameError) setNameError('');
  }

  function handleModeChange(mode: AttendanceMode) {
    setForm((prev) => ({ ...prev, mode }));
  }

  function handleBack() {
    setStep((s) => (s > 1 ? ((s - 1) as Step) : s));
  }

  async function handleNext() {
    if (step === 1) {
      if (form.roomName.trim().length < 2) {
        setNameError('Room name must be at least 2 characters.');
        return;
      }
      setStep(2);
      return;
    }

    if (step === 2) {
      setStep(3);
      return;
    }

    // Step 3: submit
    setLoading(true);
    try {
      const combinedName = form.subject
        ? `${form.roomName} — ${form.subject}`
        : form.roomName;

      const data = await api.post<{ room: { id: string } }>('/api/rooms', {
        name: combinedName,
        attendance_mode: form.mode,
      });

      toast('Room created!', 'success');
      router.push(`/teacher/rooms/${data.room.id}`);
    } catch {
      toast('Failed to create room. Please try again.', 'error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col w-full min-h-screen bg-surface">
      {/* Custom header — replaces the layout header for this page */}
      <header className="fixed top-0 w-full z-50 bg-surface/85 backdrop-blur-xl h-16 pt-safe px-margin shadow-[0_1px_8px_rgba(43,42,38,0.03)]">
        <div className="flex items-center h-16">
          <button
            aria-label="Go back"
            onClick={step > 1 ? handleBack : () => router.back()}
            className="flex items-center justify-center w-9 h-9 -ml-2 rounded-full
                       text-on-surface hover:bg-surface-container active:bg-surface-container-high
                       transition-colors duration-150"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 22 }}>
              arrow_back
            </span>
          </button>
          <div className="ml-2 min-w-0">
            <p className="font-label-sm text-label-sm text-tertiary uppercase tracking-wider leading-tight">
              Step {step} of 3
            </p>
            <h1 className="font-headline-sm text-on-surface leading-tight truncate">
              {STEP_LABELS[step]}
            </h1>
          </div>
        </div>
      </header>

      {/* Main content */}
      <div className="flex flex-col pt-16 pb-32">
        {/* Step indicator strip */}
        <StepIndicator step={step} />

        {/* Step content */}
        <div className="px-margin flex flex-col gap-space-lg">
          {step === 1 && (
            <Step1
              form={form}
              nameError={nameError}
              onChange={handleFieldChange}
            />
          )}
          {step === 2 && (
            <Step2
              form={form}
              onModeChange={handleModeChange}
              onEditDetails={() => setStep(1)}
            />
          )}
          {step === 3 && <Step3 form={form} />}
        </div>
      </div>

      {/* Sticky bottom action dock */}
      <BottomDock
        step={step}
        loading={loading}
        onBack={handleBack}
        onNext={handleNext}
      />
    </div>
  );
}

export default function NewRoomPage() {
  return (
    <TeacherGuard>
      <NewRoomContent />
    </TeacherGuard>
  );
}
