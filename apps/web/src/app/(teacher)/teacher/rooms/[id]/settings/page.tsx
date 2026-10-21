'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import QRCode from 'react-qr-code';
import { TeacherGuard } from '@/lib/auth';
import { api } from '@/lib/api';
import { Room } from '@/lib/types';
import { PageHeader } from '@/components/ui/PageHeader';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Spinner } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/useToast';

// ─── Types ────────────────────────────────────────────────────────────────────

type GpsPolicy = 'off' | 'warn' | 'reject';
type SelfiePolicy = 'off' | 'optional' | 'required';
type BgType = 'none' | 'preset' | 'custom';

interface FormState {
  name: string;
  geofence_radius_m: number;
  gps_policy: GpsPolicy;
  selfie_policy: SelfiePolicy;
  require_manual_approval: boolean;
  background_type: BgType;
  background_preset_id: string | null;
  background_dim: number;
  background_blur: number;
}

interface Preset {
  id: string;
  name: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

// ─── Segmented selector ───────────────────────────────────────────────────────

interface SegmentedProps<T extends string> {
  options: { label: string; value: T }[];
  value: T;
  onChange: (v: T) => void;
}

function Segmented<T extends string>({ options, value, onChange }: SegmentedProps<T>) {
  return (
    <div className="flex rounded-xl bg-surface-container-high p-0.5 gap-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={[
            'flex-1 py-1.5 rounded-lg font-label-md text-label-md transition-all duration-150',
            value === opt.value
              ? 'bg-surface-container-lowest text-on-surface shadow-sm font-semibold'
              : 'text-on-surface-variant hover:text-on-surface',
          ].join(' ')}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ─── Toggle ───────────────────────────────────────────────────────────────────

interface ToggleProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  id?: string;
}

function Toggle({ checked, onChange, id }: ToggleProps) {
  return (
    <label className="relative inline-flex items-center cursor-pointer select-none" htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only peer"
      />
      <div
        className={[
          'w-11 h-6 rounded-full transition-colors duration-200',
          'after:content-[\'\'] after:absolute after:top-[2px] after:left-[2px]',
          'after:bg-surface-container-lowest after:rounded-full after:h-5 after:w-5',
          'after:transition-all peer-checked:after:translate-x-full after:border-white',
          checked ? 'bg-primary' : 'bg-surface-container-highest',
        ].join(' ')}
      />
    </label>
  );
}

// ─── Main page content ────────────────────────────────────────────────────────

function RoomSettingsContent() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();

  const [room, setRoom] = useState<Room | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Form state
  const [form, setForm] = useState<FormState>({
    name: '',
    geofence_radius_m: 100,
    gps_policy: 'warn',
    selfie_policy: 'optional',
    require_manual_approval: true,
    background_type: 'none',
    background_preset_id: null,
    background_dim: 35,
    background_blur: 0,
  });

  // Background preview
  const [customBgPreview, setCustomBgPreview] = useState<string | null>(null);
  const [customBgFile, setCustomBgFile] = useState<File | null>(null);
  const [uploadingBg, setUploadingBg] = useState(false);

  // Presets
  const [presets, setPresets] = useState<Preset[]>([]);

  // Regenerate invite confirm sheet
  const [showRegenerateSheet, setShowRegenerateSheet] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  // Delete room sheet
  const [showDeleteSheet, setShowDeleteSheet] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState('');
  const [deleting, setDeleting] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ─── Load room ──────────────────────────────────────────────────────────────

  const loadRoom = useCallback(async () => {
    try {
      const data = await api.get<Room>(`/api/rooms/${id}`);
      setRoom(data);
      setForm({
        name: data.name,
        geofence_radius_m: data.geofence_radius_m,
        gps_policy: data.gps_policy as GpsPolicy,
        selfie_policy: data.selfie_policy as SelfiePolicy,
        require_manual_approval: data.require_manual_approval,
        background_type: (data.background_type as BgType) ?? 'none',
        background_preset_id: data.background_preset_id ?? null,
        background_dim: data.background_dim ?? 35,
        background_blur: data.background_blur ?? 0,
      });
    } catch {
      toast('Failed to load room', 'error');
    } finally {
      setLoading(false);
    }
  }, [id, toast]);

  useEffect(() => {
    loadRoom();
  }, [loadRoom]);

  // ─── Load presets ────────────────────────────────────────────────────────────

  useEffect(() => {
    api
      .get<Preset[]>('/api/presets')
      .then(setPresets)
      .catch(() => {});
  }, []);

  // ─── Set existing custom bg preview ─────────────────────────────────────────

  useEffect(() => {
    if (room && room.background_type === 'custom') {
      setCustomBgPreview(`${BASE}/api/rooms/${id}/background-image`);
    }
  }, [room, id]);

  // ─── Handlers ────────────────────────────────────────────────────────────────

  function patchForm<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  // Save all changes
  async function handleSave() {
    setSaving(true);
    try {
      // If there's a pending custom bg file, upload it first
      if (customBgFile && form.background_type === 'custom') {
        setUploadingBg(true);
        const fd = new FormData();
        fd.append('background', customBgFile);
        const bgRes = await fetch(`${BASE}/api/rooms/${id}/background`, {
          method: 'POST',
          credentials: 'include',
          body: fd,
        });
        setUploadingBg(false);
        if (!bgRes.ok) {
          const err = await bgRes.json().catch(() => ({}));
          toast(err.error ?? 'Background upload failed', 'error');
          setSaving(false);
          return;
        }
        setCustomBgFile(null);
      }

      // PATCH room settings
      await api.patch(`/api/rooms/${id}`, {
        name: form.name,
        geofence_radius_m: form.geofence_radius_m,
        gps_policy: form.gps_policy,
        selfie_policy: form.selfie_policy,
        require_manual_approval: form.require_manual_approval,
        background_type: form.background_type,
        background_preset_id: form.background_preset_id,
        background_dim: form.background_dim,
        background_blur: form.background_blur,
      });

      await loadRoom();
      toast('Settings updated successfully!', 'success');
    } catch {
      toast('Failed to save settings', 'error');
    } finally {
      setSaving(false);
    }
  }

  // Regenerate invite code
  async function handleRegenerateInvite() {
    setRegenerating(true);
    try {
      const updated = await api.post<Room>(`/api/rooms/${id}/regenerate-invite`);
      setRoom(updated);
      setShowRegenerateSheet(false);
      toast('Invite code regenerated', 'success');
    } catch {
      toast('Failed to regenerate invite code', 'error');
    } finally {
      setRegenerating(false);
    }
  }

  // Regenerate static QR
  async function handleRegenerateStaticQr() {
    try {
      await api.post(`/api/rooms/${id}/static-qr/regenerate`);
      await loadRoom();
      toast('Static QR regenerated', 'success');
    } catch {
      toast('Failed to regenerate QR', 'error');
    }
  }

  // Set anchor via geolocation
  async function handleSetAnchor() {
    if (!navigator.geolocation) {
      toast('Geolocation not supported', 'error');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          await api.patch(`/api/rooms/${id}`, {
            anchor_lat: pos.coords.latitude,
            anchor_lng: pos.coords.longitude,
          });
          toast('Anchor location updated', 'success');
        } catch {
          toast('Failed to update anchor location', 'error');
        }
      },
      () => toast('Location access denied', 'error'),
    );
  }

  // Delete background
  async function handleDeleteBackground() {
    try {
      await api.delete(`/api/rooms/${id}/background`);
      patchForm('background_type', 'none');
      patchForm('background_preset_id', null);
      setCustomBgPreview(null);
      setCustomBgFile(null);
      toast('Background removed', 'info');
    } catch {
      toast('Failed to remove background', 'error');
    }
  }

  // Delete room
  async function handleDeleteRoom() {
    if (deleteConfirmName !== room?.name) return;
    setDeleting(true);
    try {
      await api.delete(`/api/rooms/${id}`);
      router.replace('/teacher/rooms');
    } catch {
      toast('Failed to delete room', 'error');
      setDeleting(false);
    }
  }

  // File select for custom background
  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast('Image must be under 5 MB', 'error');
      return;
    }
    setCustomBgFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setCustomBgPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
    patchForm('background_type', 'custom');
  }

  // ─── Preview bg style ────────────────────────────────────────────────────────

  const bgStyle: React.CSSProperties = (() => {
    if (form.background_type === 'custom' && customBgPreview) {
      return {
        backgroundImage: `url(${customBgPreview})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        filter: `blur(${form.background_blur}px)`,
      };
    }
    if (form.background_type === 'preset' && form.background_preset_id) {
      const colors: Record<string, string> = {
        paper: '#f5f0e8',
        sprout: '#c8e6c9',
        oat: '#f0e6d3',
      };
      return {
        backgroundColor: colors[form.background_preset_id] ?? '#e0e0e0',
        filter: `blur(${form.background_blur}px)`,
      };
    }
    return { backgroundColor: '#f5f0e8' };
  })();

  // ─── Loading ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface">
        <Spinner />
      </div>
    );
  }

  if (!room) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface">
        <p className="font-body-md text-on-surface-variant">Room not found</p>
      </div>
    );
  }

  const staticQrToken = room.static_qr_token ?? null;

  return (
    <div className="flex flex-col w-full">
      {/* Header */}
      <div className="px-margin pt-space-xs pb-space-sm flex items-center justify-between">
        <div className="flex items-center gap-space-sm">
          <button
            type="button"
            aria-label="Go back"
            onClick={() => router.back()}
            className="w-10 h-10 rounded-full bg-surface-container flex items-center justify-center text-on-surface hover:bg-surface-container-high transition-colors active:scale-95"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
              arrow_back
            </span>
          </button>
          <div className="flex flex-col">
            <span className="font-label-sm text-label-sm text-tertiary uppercase tracking-wider">
              Room Setup
            </span>
            <h1 className="font-headline-sm text-headline-sm text-on-surface font-bold">
              Room Settings
            </h1>
          </div>
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="px-space-md py-space-xs rounded-full bg-surface-container-low text-primary font-label-lg text-label-lg hover:bg-surface-container transition-colors disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      {/* Content */}
      <div className="flex flex-col gap-space-md px-margin pb-36">

        {/* ── Section 1: Room Info ─────────────────────────────────────────── */}
        <section className="bg-surface-container-lowest rounded-[20px] p-space-md shadow-[0_4px_16px_rgba(43,42,38,0.04)] flex flex-col gap-space-md">
          <div className="flex items-center gap-space-xs">
            <span
              className="material-symbols-outlined text-primary text-[20px]"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              edit_note
            </span>
            <h2 className="font-headline-sm text-headline-sm text-on-surface">General Details</h2>
          </div>

          {/* Room name */}
          <label className="flex flex-col gap-space-xs">
            <span className="font-label-md text-label-md text-on-surface-variant">Room Name</span>
            <div className="bg-surface-container-low rounded-xl px-space-md py-space-sm flex items-center focus-within:bg-surface-container-lowest focus-within:shadow-[0_0_0_2px_#338351] transition-all">
              <input
                type="text"
                value={form.name}
                onChange={(e) => patchForm('name', e.target.value)}
                placeholder="Enter classroom name"
                className="w-full bg-transparent font-body-md text-body-md text-on-surface outline-none placeholder:text-outline"
              />
            </div>
          </label>

          {/* Subject + Room number (read-only display) */}
          <div className="grid grid-cols-2 gap-space-sm">
            <div className="flex flex-col gap-space-xs">
              <span className="font-label-md text-label-md text-on-surface-variant">Subject</span>
              <div className="bg-surface-container-low rounded-xl px-space-md py-space-sm">
                <span className="font-body-md text-body-md text-on-surface">
                  {room.subject ?? '—'}
                </span>
              </div>
            </div>
            <div className="flex flex-col gap-space-xs">
              <span className="font-label-md text-label-md text-on-surface-variant">
                Room Number
              </span>
              <div className="bg-surface-container-low rounded-xl px-space-md py-space-sm">
                <span className="font-body-md text-body-md text-on-surface">
                  {room.room_number ?? '—'}
                </span>
              </div>
            </div>
          </div>

          {/* Attendance mode */}
          <div className="flex flex-col gap-space-xs">
            <span className="font-label-md text-label-md text-on-surface-variant">
              Attendance Mode
            </span>
            <div className="bg-surface-container-low rounded-xl px-space-md py-space-sm flex items-center justify-between">
              <span className="font-body-md text-body-md text-on-surface capitalize">
                {room.attendance_mode}
              </span>
              <button
                type="button"
                onClick={() => router.push(`/teacher/rooms/${id}?tab=settings&mode=change`)}
                className="font-label-md text-label-md text-primary hover:underline"
              >
                Change mode
              </button>
            </div>
          </div>

          {/* Invite code */}
          <div className="flex flex-col gap-space-xs">
            <span className="font-label-md text-label-md text-on-surface-variant">
              Invite Code
            </span>
            <div className="bg-surface-container-low rounded-xl px-space-md py-space-sm flex items-center justify-between gap-space-sm">
              <span className="font-body-md text-body-md text-on-surface font-mono tracking-widest">
                {room.invite_code}
              </span>
              <button
                type="button"
                aria-label="Regenerate invite code"
                onClick={() => setShowRegenerateSheet(true)}
                className="w-8 h-8 rounded-full flex items-center justify-center text-secondary hover:bg-surface-container transition-colors"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                  refresh
                </span>
              </button>
            </div>
          </div>
        </section>

        {/* ── Section 2: Attendance Rules ──────────────────────────────────── */}
        <section className="bg-surface-container-lowest rounded-[20px] p-space-md shadow-[0_4px_16px_rgba(43,42,38,0.04)] flex flex-col gap-space-md">
          <div className="flex items-center gap-space-xs">
            <span
              className="material-symbols-outlined text-primary text-[20px]"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              verified_user
            </span>
            <h2 className="font-headline-sm text-headline-sm text-on-surface">
              Attendance Rules
            </h2>
          </div>

          {/* GPS policy */}
          <div className="flex flex-col gap-space-xs">
            <div className="flex items-center justify-between">
              <span className="font-label-lg text-label-lg text-on-surface">GPS Policy</span>
              <span className="font-label-md text-label-md text-on-surface-variant capitalize">
                {form.gps_policy}
              </span>
            </div>
            <Segmented<GpsPolicy>
              options={[
                { label: 'Off', value: 'off' },
                { label: 'Warn', value: 'warn' },
                { label: 'Reject', value: 'reject' },
              ]}
              value={form.gps_policy}
              onChange={(v) => patchForm('gps_policy', v)}
            />
          </div>

          <div className="h-px bg-surface-container w-full" />

          {/* Selfie policy */}
          <div className="flex flex-col gap-space-xs">
            <div className="flex items-center justify-between">
              <span className="font-label-lg text-label-lg text-on-surface">Selfie Policy</span>
              <span className="font-label-md text-label-md text-on-surface-variant capitalize">
                {form.selfie_policy}
              </span>
            </div>
            <Segmented<SelfiePolicy>
              options={[
                { label: 'Off', value: 'off' },
                { label: 'Optional', value: 'optional' },
                { label: 'Required', value: 'required' },
              ]}
              value={form.selfie_policy}
              onChange={(v) => patchForm('selfie_policy', v)}
            />
          </div>

          <div className="h-px bg-surface-container w-full" />

          {/* Geofence radius */}
          <div className="flex flex-col gap-space-md">
            <div className="flex items-center justify-between">
              <span className="font-label-lg text-label-lg text-on-surface">
                Geofence Radius
              </span>
              <span className="px-space-sm py-0.5 rounded-full bg-tertiary-fixed text-on-tertiary-fixed font-label-md text-label-md">
                {form.geofence_radius_m} m
              </span>
            </div>
            <div className="flex flex-col gap-space-xs">
              <div className="flex items-center justify-between font-label-sm text-label-sm text-on-surface-variant">
                <span>Tighter (10 m)</span>
                <span>Wide (2000 m)</span>
              </div>
              <input
                type="range"
                min={10}
                max={2000}
                step={10}
                value={form.geofence_radius_m}
                onChange={(e) => patchForm('geofence_radius_m', Number(e.target.value))}
                className="w-full h-2 bg-surface-container-high rounded-lg cursor-pointer accent-primary"
              />
            </div>
          </div>

          <div className="h-px bg-surface-container w-full" />

          {/* Manual entry approval */}
          <div className="flex items-center justify-between">
            <div className="flex flex-col pr-space-sm">
              <span className="font-headline-sm text-headline-sm text-on-surface">
                Manual Entry Approval
              </span>
              <span className="font-body-sm text-body-sm text-on-surface-variant">
                Require teacher approval before saving manual entries
              </span>
            </div>
            <Toggle
              id="toggle-manual-approval"
              checked={form.require_manual_approval}
              onChange={(v) => patchForm('require_manual_approval', v)}
            />
          </div>
        </section>

        {/* ── Section 3: Appearance ────────────────────────────────────────── */}
        <section className="bg-surface-container-lowest rounded-[20px] p-space-md shadow-[0_4px_16px_rgba(43,42,38,0.04)] flex flex-col gap-space-md">
          <div className="flex items-center gap-space-xs">
            <span
              className="material-symbols-outlined text-primary text-[20px]"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              palette
            </span>
            <h2 className="font-headline-sm text-headline-sm text-on-surface">
              Appearance &amp; Background
            </h2>
          </div>

          {/* Background type tabs */}
          <div className="flex flex-col gap-space-xs">
            <span className="font-label-md text-label-md text-on-surface-variant">
              Background Type
            </span>
            <Segmented<BgType>
              options={[
                { label: 'None', value: 'none' },
                { label: 'Preset', value: 'preset' },
                { label: 'Custom', value: 'custom' },
              ]}
              value={form.background_type}
              onChange={(v) => patchForm('background_type', v)}
            />
          </div>

          {/* None: description */}
          {form.background_type === 'none' && (
            <p className="font-body-sm text-body-sm text-on-surface-variant text-center py-space-sm">
              Default paper background will be used.
            </p>
          )}

          {/* Preset: thumbnail grid */}
          {form.background_type === 'preset' && (
            <div className="flex flex-col gap-space-xs">
              <span className="font-label-md text-label-md text-on-surface-variant">
                Choose Preset
              </span>
              {presets.length === 0 ? (
                <div className="grid grid-cols-3 gap-space-sm">
                  {['paper', 'sprout', 'oat'].map((pid) => {
                    const colors: Record<string, string> = {
                      paper: '#f5f0e8',
                      sprout: '#c8e6c9',
                      oat: '#f0e6d3',
                    };
                    const names: Record<string, string> = {
                      paper: 'Paper',
                      sprout: 'Sprout',
                      oat: 'Oat',
                    };
                    const active = form.background_preset_id === pid;
                    return (
                      <button
                        key={pid}
                        type="button"
                        onClick={() => patchForm('background_preset_id', pid)}
                        className={[
                          'flex flex-col items-center gap-1 p-1 rounded-xl transition-all',
                          active
                            ? 'bg-primary-fixed/30 text-on-surface font-bold'
                            : 'hover:bg-surface-container-low text-on-surface-variant',
                        ].join(' ')}
                      >
                        <div
                          className="w-full aspect-square rounded-lg overflow-hidden border-2 transition-colors"
                          style={{
                            backgroundColor: colors[pid],
                            borderColor: active ? '#338351' : 'transparent',
                          }}
                        />
                        <span className="font-label-sm text-[10px] text-center leading-tight truncate w-full">
                          {names[pid]}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="grid grid-cols-4 gap-space-xs">
                  {presets.map((p) => {
                    const active = form.background_preset_id === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => patchForm('background_preset_id', p.id)}
                        className={[
                          'flex flex-col items-center gap-1 p-1 rounded-xl transition-all',
                          active
                            ? 'bg-primary-fixed/30 text-on-surface font-bold'
                            : 'hover:bg-surface-container-low text-on-surface-variant',
                        ].join(' ')}
                      >
                        <div
                          className="w-full aspect-square rounded-lg overflow-hidden border-2 transition-colors bg-surface-container-high"
                          style={{ borderColor: active ? '#338351' : 'transparent' }}
                        />
                        <span className="font-label-sm text-[10px] text-center leading-tight truncate w-full">
                          {p.name}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Custom: upload area */}
          {form.background_type === 'custom' && (
            <div className="flex flex-col gap-space-sm">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleFileChange}
                className="sr-only"
                aria-label="Upload background image"
              />
              {!customBgPreview ? (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className={[
                    'w-full py-8 rounded-xl border-2 border-dashed border-outline-variant',
                    'flex flex-col items-center justify-center gap-space-sm',
                    'text-on-surface-variant hover:bg-surface-container-low transition-colors',
                  ].join(' ')}
                >
                  <span
                    className="material-symbols-outlined text-primary text-[32px]"
                    style={{ fontVariationSettings: "'FILL' 0" }}
                  >
                    add_photo_alternate
                  </span>
                  <span className="font-label-lg text-label-lg">Tap to upload a photo</span>
                  <span className="font-body-sm text-body-sm text-on-surface-variant">
                    JPEG, PNG, WebP · max 5 MB
                  </span>
                </button>
              ) : (
                <div className="relative rounded-xl overflow-hidden aspect-video">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={customBgPreview}
                    alt="Background preview"
                    className="w-full h-full object-cover"
                  />
                  <button
                    type="button"
                    aria-label="Change image"
                    onClick={() => fileInputRef.current?.click()}
                    className="absolute top-2 right-2 w-8 h-8 rounded-full bg-inverse-surface/70 text-inverse-on-surface flex items-center justify-center"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                      edit
                    </span>
                  </button>
                </div>
              )}
              {uploadingBg && (
                <p className="font-body-sm text-body-sm text-on-surface-variant text-center">
                  Processing image…
                </p>
              )}
            </div>
          )}

          {/* Preview phone mockup (shown when preset or custom) */}
          {form.background_type !== 'none' && (
            <div className="flex flex-col gap-space-xs">
              <span className="font-label-md text-label-md text-on-surface-variant">
                Live Room Preview
              </span>
              <div className="flex justify-center">
                <div className="relative aspect-[9/16] max-w-[140px] w-full rounded-[20px] overflow-hidden border-2 border-outline-variant shadow-md">
                  {/* BG layer */}
                  <div className="absolute inset-0 transition-all duration-200" style={bgStyle} />
                  {/* Scrim */}
                  <div
                    className="absolute inset-0 bg-black transition-all duration-200"
                    style={{ opacity: form.background_dim / 100 }}
                  />
                  {/* Content overlay */}
                  <div className="absolute bottom-0 inset-x-0 p-3 flex flex-col gap-0.5">
                    <span className="font-headline-sm text-[13px] text-white font-bold leading-tight drop-shadow-sm line-clamp-2">
                      {form.name || 'Untitled Classroom'}
                    </span>
                    <span className="font-body-sm text-[10px] text-white/80">
                      {room.attendance_mode}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Dim slider */}
          {form.background_type !== 'none' && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="font-label-md text-label-md text-on-surface">
                  Dim (scrim strength)
                </span>
                <span className="px-space-sm py-0.5 rounded-full bg-surface-container-high font-label-sm text-label-sm text-on-surface">
                  {form.background_dim}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={80}
                step={1}
                value={form.background_dim}
                onChange={(e) => patchForm('background_dim', Number(e.target.value))}
                className="w-full h-2 bg-surface-container-high rounded-lg cursor-pointer accent-primary"
              />
            </div>
          )}

          {/* Blur slider */}
          {form.background_type !== 'none' && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="font-label-md text-label-md text-on-surface">Blur</span>
                <span className="px-space-sm py-0.5 rounded-full bg-surface-container-high font-label-sm text-label-sm text-on-surface">
                  {form.background_blur}px
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={20}
                step={1}
                value={form.background_blur}
                onChange={(e) => patchForm('background_blur', Number(e.target.value))}
                className="w-full h-2 bg-surface-container-high rounded-lg cursor-pointer accent-primary"
              />
            </div>
          )}

          {/* Reset background */}
          {form.background_type !== 'none' && (
            <div className="flex justify-center pt-space-xs">
              <button
                type="button"
                onClick={handleDeleteBackground}
                className="font-label-md text-label-md text-secondary hover:text-on-secondary-fixed-variant transition-colors flex items-center gap-1"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                  restart_alt
                </span>
                <span>Reset to default background</span>
              </button>
            </div>
          )}
        </section>

        {/* ── Section 4: Static QR (only for static rooms) ─────────────────── */}
        {room.qr_type === 'static' && (
          <section className="bg-surface-container-lowest rounded-[20px] p-space-md shadow-[0_4px_16px_rgba(43,42,38,0.04)] flex flex-col gap-space-md">
            <div className="flex items-center gap-space-xs">
              <span
                className="material-symbols-outlined text-primary text-[20px]"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                qr_code_2
              </span>
              <h2 className="font-headline-sm text-headline-sm text-on-surface">Static QR Code</h2>
            </div>

            {staticQrToken ? (
              <div className="flex flex-col items-center gap-space-md">
                {/* QR code display */}
                <div className="p-space-md bg-white rounded-2xl shadow-sm">
                  <QRCode value={staticQrToken} size={160} />
                </div>
                <p className="font-body-sm text-body-sm text-on-surface-variant text-center">
                  Students scan this once to mark attendance
                </p>
                <div className="flex gap-space-sm w-full">
                  <button
                    type="button"
                    onClick={handleRegenerateStaticQr}
                    className="flex-1 py-2.5 rounded-xl border border-outline-variant font-label-lg text-label-lg text-on-surface hover:bg-surface-container-low transition-colors flex items-center justify-center gap-1"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                      refresh
                    </span>
                    Regenerate
                  </button>
                  <button
                    type="button"
                    onClick={() => window.open(`/rooms/${id}/print-qr`, '_blank')}
                    className="flex-1 py-2.5 rounded-xl bg-primary text-on-primary font-label-lg text-label-lg hover:opacity-95 transition-opacity flex items-center justify-center gap-1"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                      print
                    </span>
                    Print QR
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-space-md py-space-md">
                <p className="font-body-sm text-body-sm text-on-surface-variant text-center">
                  No static QR generated yet for this room.
                </p>
                <button
                  type="button"
                  onClick={handleRegenerateStaticQr}
                  className="px-space-lg py-2.5 rounded-xl bg-primary text-on-primary font-label-lg text-label-lg hover:opacity-95 transition-opacity flex items-center gap-1"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                    qr_code_2
                  </span>
                  Generate Static QR
                </button>
              </div>
            )}

            {/* Anchor location */}
            <div className="h-px bg-surface-container w-full" />
            <button
              type="button"
              onClick={handleSetAnchor}
              className="flex items-center justify-between w-full py-space-sm"
            >
              <div className="flex flex-col text-left">
                <span className="font-headline-sm text-headline-sm text-on-surface">
                  Set Room Anchor
                </span>
                <span className="font-body-sm text-body-sm text-on-surface-variant">
                  Uses current device location as the geofence center
                </span>
              </div>
              <span className="material-symbols-outlined text-primary text-[20px]">
                my_location
              </span>
            </button>
          </section>
        )}

        {/* ── Section 5: Danger Zone ───────────────────────────────────────── */}
        <section className="bg-surface-container-lowest rounded-[20px] p-space-md shadow-[0_4px_16px_rgba(43,42,38,0.04)] flex flex-col gap-space-md">
          <div className="flex items-center gap-space-xs">
            <span className="material-symbols-outlined text-error text-[20px]">
              warning
            </span>
            <h2 className="font-headline-sm text-headline-sm text-error">Danger Zone</h2>
          </div>

          <button
            type="button"
            onClick={() => setShowDeleteSheet(true)}
            className="w-full py-3 rounded-xl border border-error text-error font-label-lg text-label-lg hover:bg-error-container/20 transition-colors"
          >
            Delete this room
          </button>

          <p className="font-body-sm text-body-sm text-on-surface-variant text-center">
            This permanently deletes all sessions, records, and members. This cannot be undone.
          </p>
        </section>
      </div>

      {/* ── Bottom sticky save bar ──────────────────────────────────────────── */}
      <div className="fixed bottom-16 left-0 right-0 z-40 px-margin py-space-sm bg-surface/90 backdrop-blur-md flex items-center justify-center">
        <div className="w-full max-w-md">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="w-full py-3.5 px-space-lg rounded-full bg-primary text-on-primary font-headline-sm text-headline-sm font-semibold flex items-center justify-center gap-space-sm shadow-[0_4px_16px_rgba(18,106,58,0.3)] hover:opacity-95 active:scale-[0.99] transition-all disabled:opacity-50"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
              {saving ? 'hourglass_empty' : 'check'}
            </span>
            <span>{saving ? 'Saving…' : 'Save changes'}</span>
          </button>
        </div>
      </div>

      {/* ── Regenerate invite confirm sheet ─────────────────────────────────── */}
      <BottomSheet
        open={showRegenerateSheet}
        onClose={() => setShowRegenerateSheet(false)}
        title="Regenerate Invite Code?"
      >
        <div className="px-5 pb-5 flex flex-col gap-space-md">
          <p className="font-body-md text-body-md text-on-surface-variant">
            This will invalidate the current invite link. Students who have not joined yet will need
            the new code.
          </p>
          <div className="flex gap-space-sm">
            <button
              type="button"
              onClick={() => setShowRegenerateSheet(false)}
              className="flex-1 py-3 rounded-xl border border-outline-variant font-label-lg text-label-lg text-on-surface hover:bg-surface-container-low transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleRegenerateInvite}
              disabled={regenerating}
              className="flex-1 py-3 rounded-xl bg-secondary text-on-secondary font-label-lg text-label-lg hover:opacity-95 transition-opacity disabled:opacity-50"
            >
              {regenerating ? 'Regenerating…' : 'Regenerate'}
            </button>
          </div>
        </div>
      </BottomSheet>

      {/* ── Delete room confirm sheet ────────────────────────────────────────── */}
      <BottomSheet
        open={showDeleteSheet}
        onClose={() => {
          setShowDeleteSheet(false);
          setDeleteConfirmName('');
        }}
        title="Delete Room?"
      >
        <div className="px-5 pb-5 flex flex-col gap-space-md">
          <p className="font-body-md text-body-md text-on-surface-variant">
            Type{' '}
            <span className="font-semibold text-on-surface">&ldquo;{room.name}&rdquo;</span> to
            confirm permanent deletion.
          </p>
          <input
            type="text"
            value={deleteConfirmName}
            onChange={(e) => setDeleteConfirmName(e.target.value)}
            placeholder={room.name}
            className="w-full bg-surface-container-low rounded-xl px-space-md py-space-sm font-body-md text-body-md text-on-surface outline-none focus:shadow-[0_0_0_2px_#ba1a1a] transition-all"
          />
          <div className="flex gap-space-sm">
            <button
              type="button"
              onClick={() => {
                setShowDeleteSheet(false);
                setDeleteConfirmName('');
              }}
              className="flex-1 py-3 rounded-xl border border-outline-variant font-label-lg text-label-lg text-on-surface hover:bg-surface-container-low transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleDeleteRoom}
              disabled={deleteConfirmName !== room.name || deleting}
              className="flex-1 py-3 rounded-xl bg-error text-on-error font-label-lg text-label-lg hover:opacity-95 transition-opacity disabled:opacity-40"
            >
              {deleting ? 'Deleting…' : 'Delete Room'}
            </button>
          </div>
        </div>
      </BottomSheet>
    </div>
  );
}

// ─── Default export with guard ────────────────────────────────────────────────

export default function RoomSettingsPage() {
  return (
    <TeacherGuard>
      <RoomSettingsContent />
    </TeacherGuard>
  );
}
