'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { TeacherGuard } from '@/lib/auth';
import { api } from '@/lib/api';
import { Room, RoomMember, AttendanceSession } from '@/lib/types';
import { PageHeader } from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';

// ─── Officer title options ───────────────────────────────────────────────────
const OFFICER_TITLES = [
  { value: 'President', label: 'Class President', description: 'Can initiate sessions, lock roster, and authorize scans' },
  { value: 'Vice-President', label: 'Vice-President', description: 'Can assist attendance and view class compliance logs' },
  { value: 'Secretary', label: 'Secretary', description: 'Can record and export attendance sheets' },
  { value: 'Treasurer', label: 'Treasurer', description: 'Standard officer role with attendance privileges' },
  { value: 'Monitor', label: 'Attendance Monitor', description: 'Authorized camera scanning badge for physical kiosk mode' },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────
function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

function formatSessionDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function modeVariant(mode: string) {
  if (mode === 'strict') return 'strict' as const;
  if (mode === 'static') return 'static' as const;
  return 'balanced' as const;
}

// ─── Sub-components ──────────────────────────────────────────────────────────

interface MemberRowProps {
  member: RoomMember;
  onAssignOfficer: (member: RoomMember) => void;
  onRemoveOfficer: (member: RoomMember) => void;
  onRemoveMember: (member: RoomMember) => void;
}

function MemberRow({ member, onAssignOfficer, onRemoveOfficer, onRemoveMember }: MemberRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const name = member.student?.name ?? 'Unknown';
  const isOfficer = member.role === 'officer';
  const consentVerified = member.student?.consent_status === 'granted';

  return (
    <>
      <div className="flex items-center justify-between p-3.5 rounded-2xl
                       bg-surface-container-lowest shadow-sm transition-all cursor-pointer
                       active:bg-surface-container-low">
        {/* Avatar + name */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-11 h-11 rounded-full bg-primary-fixed text-on-primary-fixed
                          font-headline-sm text-[18px] flex items-center justify-center shrink-0">
            {getInitials(name)}
          </div>
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-label-lg text-[14px] text-on-surface truncate">{name}</span>
              {consentVerified ? (
                <span
                  className="material-symbols-outlined text-primary text-[17px] shrink-0"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                  title="Guardian Consent Verified"
                >
                  check_circle
                </span>
              ) : (
                <span className="w-2.5 h-2.5 rounded-full bg-secondary shrink-0" title="Consent pending" />
              )}
            </div>
            {isOfficer && member.officer_title ? (
              <span className="font-body-sm text-[12px] text-tertiary truncate">
                {member.officer_title}
              </span>
            ) : !consentVerified ? (
              <span className="font-body-sm text-[12px] text-secondary truncate">Consent pending</span>
            ) : (
              <span className="font-body-sm text-[12px] text-tertiary truncate">Student</span>
            )}
          </div>
        </div>

        {/* Role badge + menu */}
        <div className="flex items-center gap-2 shrink-0">
          {isOfficer ? (
            <span className="px-2.5 py-1 rounded-full bg-primary-fixed text-on-primary-fixed font-label-sm text-[11px]">
              {member.officer_title ?? 'Officer'}
            </span>
          ) : (
            <span className="px-2.5 py-1 rounded-full bg-surface-container-low text-tertiary font-label-sm text-[11px]">
              Student
            </span>
          )}
          <button
            aria-label="Member options"
            onClick={() => setMenuOpen(true)}
            className="w-8 h-8 flex items-center justify-center rounded-full
                       text-on-surface-variant hover:bg-surface-container transition-colors"
          >
            <span className="material-symbols-outlined text-[20px]">more_vert</span>
          </button>
        </div>
      </div>

      <BottomSheet open={menuOpen} onClose={() => setMenuOpen(false)} title={name}>
        <div className="flex flex-col px-5 pb-6 gap-1">
          {!isOfficer ? (
            <button
              onClick={() => { setMenuOpen(false); onAssignOfficer(member); }}
              className="flex items-center gap-3 w-full py-3.5 rounded-xl text-on-surface
                         hover:bg-surface-container transition-colors font-label-lg text-[14px]"
            >
              <span className="material-symbols-outlined text-[20px] text-primary">military_tech</span>
              Make officer
            </button>
          ) : (
            <button
              onClick={() => { setMenuOpen(false); onRemoveOfficer(member); }}
              className="flex items-center gap-3 w-full py-3.5 rounded-xl text-on-surface
                         hover:bg-surface-container transition-colors font-label-lg text-[14px]"
            >
              <span className="material-symbols-outlined text-[20px] text-tertiary">remove_moderator</span>
              Remove officer role
            </button>
          )}
          <button
            onClick={() => { setMenuOpen(false); onRemoveMember(member); }}
            className="flex items-center gap-3 w-full py-3.5 rounded-xl text-error
                       hover:bg-error-container/30 transition-colors font-label-lg text-[14px]"
          >
            <span className="material-symbols-outlined text-[20px]">person_remove</span>
            Remove from room
          </button>
        </div>
      </BottomSheet>
    </>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

function RoomDetailContent() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [room, setRoom] = useState<Room | null>(null);
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [sessions, setSessions] = useState<AttendanceSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'members' | 'sessions' | 'settings'>('members');
  const [search, setSearch] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  // Officer assignment sheet
  const [assignTarget, setAssignTarget] = useState<RoomMember | null>(null);
  const [selectedTitle, setSelectedTitle] = useState('President');
  const [saving, setSaving] = useState(false);

  const loadMembers = useCallback(() => {
    api.get<{ members: RoomMember[] }>(`/api/rooms/${id}/members`)
      .then((d) => setMembers(d.members))
      .catch(() => setMembers([]));
  }, [id]);

  useEffect(() => {
    Promise.all([
      api.get<Room>(`/api/rooms/${id}`).catch(() => null),
      api.get<{ members: RoomMember[] }>(`/api/rooms/${id}/members`).catch(() => ({ members: [] })),
      api.get<{ sessions: AttendanceSession[] }>(`/api/rooms/${id}/sessions`).catch(() => ({ sessions: [] })),
    ]).then(([roomData, memberData, sessionData]) => {
      setRoom(roomData);
      setMembers(memberData.members);
      setSessions(sessionData.sessions);
    }).finally(() => setLoading(false));
  }, [id]);

  function copyInviteCode() {
    if (!room) return;
    navigator.clipboard?.writeText(room.invite_code).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function handleAssignOfficer() {
    if (!assignTarget) return;
    setSaving(true);
    try {
      await api.post(`/api/rooms/${id}/officers`, {
        memberId: assignTarget.id,
        officerTitle: selectedTitle,
      });
      loadMembers();
    } catch {
      // ignore
    } finally {
      setSaving(false);
      setAssignTarget(null);
    }
  }

  async function handleRemoveOfficer(member: RoomMember) {
    try {
      await api.delete(`/api/rooms/${id}/officers/${member.id}`);
      loadMembers();
    } catch {
      // ignore
    }
  }

  async function handleRemoveMember(member: RoomMember) {
    try {
      await api.delete(`/api/rooms/${id}/members/${member.id}`);
      setMembers((prev) => prev.filter((m) => m.id !== member.id));
    } catch {
      // ignore
    }
  }

  const filteredMembers = members.filter((m) =>
    (m.student?.name ?? '').toLowerCase().includes(search.toLowerCase()),
  );

  const modeLabel = room
    ? room.attendance_mode.charAt(0).toUpperCase() + room.attendance_mode.slice(1)
    : '';

  const headerAction = (
    <button
      aria-label="Room options"
      onClick={() => setMenuOpen(true)}
      className="w-9 h-9 flex items-center justify-center rounded-full
                 text-on-surface-variant hover:bg-surface-container transition-colors"
    >
      <span className="material-symbols-outlined text-[20px]">more_vert</span>
    </button>
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (!room) {
    return (
      <div className="min-h-screen bg-surface flex flex-col items-center justify-center gap-4">
        <p className="text-on-surface-variant font-body-md">Room not found.</p>
        <Button variant="ghost" onClick={() => router.back()}>Go back</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-surface">
      <PageHeader title={room.name} back action={headerAction} />

      <div className="flex flex-col px-margin pt-20 pb-32">
        {/* Room info card */}
        <div className="flex flex-col gap-space-sm pt-space-xs mb-space-md">
          {/* Mode badge */}
          <div className="flex items-center justify-between gap-space-sm">
            <h2 className="font-headline-lg text-[24px] font-bold text-on-surface tracking-tight truncate">
              {room.name}
            </h2>
            <Badge variant={modeVariant(room.attendance_mode)} label={`${modeLabel} mode`} />
          </div>

          {/* Invite chip + room info chips */}
          <div className="flex items-center gap-space-sm flex-wrap">
            <button
              onClick={copyInviteCode}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface-container
                         text-tertiary shadow-sm active:scale-95 transition-all text-left"
            >
              <span className="material-symbols-outlined text-[16px] text-primary">key</span>
              <span className="font-label-md text-[12px] text-on-surface font-semibold tracking-wide">
                {room.invite_code}
              </span>
              <span className="font-body-sm text-[12px] text-tertiary">
                · {room.student_count ?? members.length} Students
              </span>
              <span className="material-symbols-outlined text-[14px] text-tertiary ml-0.5">
                {copied ? 'check' : 'content_copy'}
              </span>
            </button>

            {room.room_number && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface-container-low text-tertiary">
                <span className="material-symbols-outlined text-[16px] text-secondary">eco</span>
                <span className="font-label-sm text-[11px]">
                  {room.subject && `${room.subject} · `}Rm {room.room_number}
                </span>
              </div>
            )}

            {room.geofence_radius_m > 0 && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface-container-low text-tertiary">
                <span className="material-symbols-outlined text-[14px]">my_location</span>
                <span className="font-label-sm text-[11px]">{room.geofence_radius_m}m fence</span>
              </div>
            )}
          </div>
        </div>

        {/* Segmented tabs */}
        <div className="grid grid-cols-3 p-1 rounded-full bg-surface-container-high mb-space-md shadow-inner">
          {(['members', 'sessions', 'settings'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={[
                'py-2 rounded-full font-label-md text-[12px] flex items-center justify-center gap-1 transition-all capitalize',
                tab === t
                  ? 'bg-primary-fixed text-on-primary-fixed shadow-sm'
                  : 'text-tertiary hover:text-on-surface',
              ].join(' ')}
            >
              {tab === t && <span className="w-1.5 h-1.5 rounded-full bg-primary" />}
              {t === 'members'
                ? `Students (${members.length})`
                : t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {/* ── Members tab ── */}
        {tab === 'members' && (
          <div className="flex flex-col gap-space-md">
            {/* Search */}
            <div className="relative w-full">
              <div className="absolute inset-y-0 left-3.5 flex items-center pointer-events-none text-outline">
                <span className="material-symbols-outlined text-[20px]">search</span>
              </div>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search students..."
                className="w-full pl-10 pr-4 py-3 rounded-xl bg-surface-container-lowest
                           text-on-surface font-body-md text-[14px] shadow-sm placeholder:text-outline
                           focus:outline-none focus:ring-0"
              />
            </div>

            {/* List */}
            <div className="flex flex-col gap-2.5">
              {filteredMembers.length === 0 ? (
                <p className="text-center text-on-surface-variant font-body-md py-8">
                  {search ? 'No students match your search.' : 'No students in this room yet.'}
                </p>
              ) : (
                filteredMembers.map((m) => (
                  <MemberRow
                    key={m.id}
                    member={m}
                    onAssignOfficer={(member) => {
                      setSelectedTitle(member.officer_title ?? 'President');
                      setAssignTarget(member);
                    }}
                    onRemoveOfficer={handleRemoveOfficer}
                    onRemoveMember={handleRemoveMember}
                  />
                ))
              )}
            </div>
          </div>
        )}

        {/* ── Sessions tab ── */}
        {tab === 'sessions' && (
          <div className="flex flex-col gap-2.5">
            {sessions.length === 0 ? (
              <p className="text-center text-on-surface-variant font-body-md py-8">
                No sessions recorded yet.
              </p>
            ) : (
              sessions.map((s) => (
                <button
                  key={s.id}
                  onClick={() => router.push(`/teacher/rooms/${id}/sessions/${s.id}`)}
                  className="flex items-center justify-between p-3.5 rounded-2xl
                             bg-surface-container-lowest shadow-sm
                             hover:bg-surface-container transition-all text-left w-full"
                >
                  <div className="flex flex-col min-w-0">
                    <span className="font-label-lg text-[14px] text-on-surface">
                      {formatSessionDate(s.started_at)}
                    </span>
                    <span className="font-body-sm text-[12px] text-tertiary mt-0.5">
                      {s.present_count ?? 0} present
                      {(s.flagged_count ?? 0) > 0 && ` · ${s.flagged_count} flagged`}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge
                      variant={s.status === 'active' ? 'active' : 'present'}
                      label={s.status === 'active' ? 'Active' : 'Ended'}
                    />
                    <span className="material-symbols-outlined text-outline-variant text-[20px]">
                      chevron_right
                    </span>
                  </div>
                </button>
              ))
            )}
          </div>
        )}

        {/* ── Settings tab ── */}
        {tab === 'settings' && (
          <div className="flex flex-col gap-space-md">
            <button
              onClick={() => router.push(`/teacher/rooms/${id}/settings`)}
              className="flex items-center justify-between p-4 rounded-2xl
                         bg-surface-container-lowest shadow-sm hover:bg-surface-container transition-all"
            >
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined text-[22px] text-primary">settings</span>
                <span className="font-label-lg text-[14px] text-on-surface">Room Settings</span>
              </div>
              <span className="material-symbols-outlined text-outline-variant text-[20px]">chevron_right</span>
            </button>
          </div>
        )}
      </div>

      {/* Start session button */}
      <div className="fixed bottom-0 inset-x-0 p-margin bg-surface/90 backdrop-blur-md z-40 pb-safe">
        <Button
          variant="primary"
          fullWidth
          size="lg"
          icon={<span className="material-symbols-outlined text-[22px]">qr_code_scanner</span>}
          onClick={() => router.push(`/teacher/rooms/${id}/session/start`)}
        >
          Start session
        </Button>
      </div>

      {/* Room options bottom sheet */}
      <BottomSheet open={menuOpen} onClose={() => setMenuOpen(false)} title={room.name}>
        <div className="flex flex-col px-5 pb-6 gap-1">
          <button
            onClick={() => { setMenuOpen(false); router.push(`/teacher/rooms/${id}/settings`); }}
            className="flex items-center gap-3 w-full py-3.5 rounded-xl text-on-surface
                       hover:bg-surface-container transition-colors font-label-lg text-[14px]"
          >
            <span className="material-symbols-outlined text-[20px] text-tertiary">edit</span>
            Edit room
          </button>
          <button
            onClick={() => { setMenuOpen(false); router.push(`/teacher/rooms/${id}/session/start`); }}
            className="flex items-center gap-3 w-full py-3.5 rounded-xl text-on-surface
                       hover:bg-surface-container transition-colors font-label-lg text-[14px]"
          >
            <span className="material-symbols-outlined text-[20px] text-primary">qr_code_scanner</span>
            Start session
          </button>
        </div>
      </BottomSheet>

      {/* Officer assignment bottom sheet */}
      <BottomSheet
        open={assignTarget !== null}
        onClose={() => setAssignTarget(null)}
        title="Officer Permissions"
      >
        <div className="flex flex-col px-5 pb-6 gap-space-md">
          <div>
            <p className="font-label-sm text-[11px] text-tertiary uppercase tracking-wider">
              Assign Role for
            </p>
            <h3 className="font-headline-md text-[20px] text-on-surface">
              {assignTarget?.student?.name ?? 'Student'}
            </h3>
          </div>

          <div className="flex flex-col gap-2">
            {OFFICER_TITLES.map((opt) => (
              <label
                key={opt.value}
                className="flex items-start gap-3 p-3 rounded-xl bg-surface-container-low
                           cursor-pointer hover:bg-surface-container transition-colors"
              >
                <input
                  type="radio"
                  name="officerRole"
                  value={opt.value}
                  checked={selectedTitle === opt.value}
                  onChange={() => setSelectedTitle(opt.value)}
                  className="mt-1 accent-primary"
                />
                <div className="flex flex-col">
                  <span className="font-label-md text-[12px] text-on-surface">{opt.label}</span>
                  <span className="font-body-sm text-[12px] text-tertiary">{opt.description}</span>
                </div>
              </label>
            ))}
          </div>

          <div className="flex items-center gap-space-sm pt-space-xs">
            <Button variant="ghost" onClick={() => setAssignTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              fullWidth
              loading={saving}
              onClick={handleAssignOfficer}
            >
              Save changes
            </Button>
          </div>
        </div>
      </BottomSheet>
    </div>
  );
}

export default function RoomDetailPage() {
  return (
    <TeacherGuard>
      <RoomDetailContent />
    </TeacherGuard>
  );
}
