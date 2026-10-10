# Tangkay Scan | QR Attendance for Classrooms

## Overview

A mobile-first web app (PWA) for teachers/schools. Teachers create rooms/classes, assign class officers, and choose an **attendance mode** (a preset bundle of security controls). Students mark attendance by scanning a QR code. Optional selfie and GPS checks provide fraud signals. A manual fallback covers students without data/phone. Parents receive email notifications.

**Timeline:** MVP in 1 month.
**Constraints:** Solo/small-team build. Express (not NestJS), no payment integration yet, Gmail SMTP for email, EC2 for hosting and storage.

---

## Core User Roles

1. **Teacher** — registers, creates rooms, picks attendance mode, assigns officers, reviews attendance and flags.
2. **Class Officer** (President, VP, Monitor, etc.) — assigned by teacher; displays the rotating QR, can manually mark students present with a photo.
3. **Student** — joins room via invite link (authenticated membership), scans QR.
4. **Parent** — receives email notification (no login for MVP).

---

## Attendance Modes

Each mode is a preset bundle of controls. Teachers pick a preset when creating a room (individual toggles can be exposed later).

| Mode | QR type | GPS policy | Selfie | Best for |
|---|---|---|---|---|
| **Strict** | Rotating (30s) | `reject` | On | Exams, high-stakes classes |
| **Balanced** (default) | Rotating (30s) | `warn` | Optional | Regular classes |
| **Static** | Printed, fixed | `reject` or `warn` | Recommended | No officer available, low-tech rooms |
| **Manual only** | None | n/a | Optional | Officer/teacher marks everyone |

Implementation note: the mode is just a config object. Scan validation is a **pipeline of check functions** that each mode enables/disables (see "Scan Validation Pipeline").

---

## Core Workflows

### A. Rotating QR modes (Strict / Balanced)
1. Teacher creates room, shares invite link; students join; teacher assigns officers.
2. Officer opens "Generate QR" page and taps Start. Officer device captures GPS once, which becomes the **session origin**.
3. Server creates one `attendance_session`. Server owns token rotation (Redis key with TTL, regenerated every 30s or immediately after a successful scan).
4. All officer devices subscribe via **SSE** and display the same token (mirrors, not independent generators). Multiple officers may show the same QR in different corners of the room.
5. Student opens the app, scans the QR; device captures GPS; optional selfie; submit.
6. Server validates, records attendance, queues parent email.

### B. Static QR mode
1. Teacher sets the **room anchor coordinates** once (map pin or "use my current location") and defines a **session window** (e.g., Mon/Wed 8:00–8:20, or manual open/close).
2. Teacher generates one static QR (encodes a signed room token), prints it, posts it in the room.
3. Any **authenticated, enrolled** student can scan during the open session window. Identity comes from login, not the QR.
4. Teacher can **regenerate the token** at any time (old printouts become invalid).
5. Same GPS, selfie, and duplicate checks apply. Selfie recommended since static QR can be photographed and shared.
6. Allow feature: Class Officer to manually log another student - for those who got no devices

### C. Manual fallback (all modes)
1. Officer (or teacher) marks a student present manually and captures the student's photo (optional) in-app.
2. Record saved with `method: manual`, `marked_by_officer_id`, device info (audit trail visible to teacher).
3. Parent email queued.
4. Optional per-room toggle: manual entries require teacher approval.

---

## Scan Validation Pipeline

Implement as ordered, composable checks. Each mode config decides which run and whether failures reject or flag.

1. **Auth + membership** — student is logged in and enrolled in the room.
2. **Session open** — an active session exists (or static-mode window is open).
3. **Token check**
   - Rotating: matches `session:{id}:current_token`, or the immediately previous token within a short grace period.
   - Static: signature valid and matches room's current `static_qr_token`.
4. **Duplicate check** — already marked present in this session? Return idempotent "already recorded" (not an error).
5. **Geofence** — Haversine distance from reference point (session origin for rotating, room anchor for static). Effective threshold = `base_threshold_m + origin_accuracy + student_accuracy`.
6. **Risk signals** — compute risk score (see below).
7. **Selfie** — required/optional per mode.
8. **Persist + enqueue parent email.**

Failure handling is governed by `gps_policy`:
- `off`: skip geofence.
- `warn`: record `location_flag: mismatch/unverified`, let through, surface to teacher for review.
- `reject`: block the scan with a clear message (Strict mode, and optionally Static).

---

## GPS Spoofing / Mock Location

**Important limitation:** a web app/PWA **cannot reliably detect mock GPS**. The browser Geolocation API provides no "is mocked" flag (that exists only in native Android via `isFromMockProvider`). So the PWA approach is **heuristic risk scoring**, not true detection.

### Heuristic signals (combine into `risk_score`: low / medium / high)
- Suspiciously constant/perfect accuracy values across readings
- Altitude/speed/heading always null or 0 where real devices usually vary
- Identical coordinates across multiple readings (real GPS jitters)
- Impossible jumps between readings taken seconds apart (use `watchPosition` for ~3–5s instead of a single `getCurrentPosition`)
- **IP geolocation mismatch** (GPS says classroom, IP resolves to another city/country)
- Same device fingerprint marking multiple students present
- Device clock vs server time anomalies

No single signal is proof. Store which signals fired in `risk_signals` (JSON array) so flags are explainable to teachers and parents.

### Policy
- Balanced mode: flag and let through.
- Strict mode: reject on high risk score, flag on medium.
- **Future (v2):** wrap PWA in Capacitor and use a native plugin to read the Android mock-location flag for real detection.

---

## Key Design Decisions

### Rotating QR: server is the single source of truth
- Avoids multiple concurrent valid tokens, unsynced timers, race conditions, and a larger screenshot/share fraud surface.
- One `attendance_session` per room session; backend owns rotation (Redis TTL); officer screens are SSE subscribers that mirror the same token.
- SSE chosen over WebSockets: one-directional server→client is all that's needed; native `EventSource`, simpler to run behind Nginx.

### Geofencing
- Rotating modes: officer GPS captured once at session start = origin. Static mode: teacher-set room anchor.
- Student GPS captured once per scan (use short `watchPosition` for risk signals).
- Account for GPS accuracy indoors (don't use a flat threshold).
- Threshold configurable per room.
- Default is **soft-flag for review**, not hard reject (except Strict mode). Full auto-reject on noisy GPS creates support complaints.

### Selfie capture
- Toggleable per room (preset-driven by mode).
- `getUserMedia` with `facingMode: "user"`; requires HTTPS and a user gesture (iOS Safari is strict).
- Test in **plain mobile Safari**, not only "added to home screen" mode.

### Officer manual override (trust risk)
- Every manual entry logged with officer id, timestamp, device info.
- Optional teacher-approval toggle.

### PWA / offline handling
- Cache static shell so scan page loads on flaky wifi.
- Queue attendance submission (background sync / retry with local fallback); show "recorded, syncing..." instead of hard failure.
- Installable (manifest + service worker) but never required — students mostly arrive via link.
- Don't rely on push notifications (limited on iOS PWAs); email is the reliable channel.

### Privacy & compliance (design in from day one)
- Data involves minors' photos, GPS coordinates, parent contact info.
- Philippines: Data Privacy Act of 2012 (NPC registration may apply past thresholds). US expansion: COPPA/FERPA.
- `consent_status` per student from day one; consent captured during enrollment.
- Retention policy: auto-delete selfies and GPS logs after N days (cron job in MVP).
- GPS coordinates count as sensitive data; include them in consent + retention scope.
- Selfies served only via auth-gated route or short-lived signed URL, never a public/listable folder.

---

## Tech Stack (MVP)

| Layer | Choice | Notes |
|---|---|---|
| Frontend | Next.js + TypeScript + Tailwind | PWA via `next-pwa`; route groups `/teacher`, `/officer`, `/student` |
| Backend | **Express + TypeScript** | SSE is just a streamed response |
| Realtime | **SSE** | Officer QR display + optional live attendance count |
| Database | PostgreSQL + Prisma | |
| Cache / tokens | Redis | Current token with TTL, scan rate limiting |
| Queue | BullMQ | Throttled parent email sends |
| QR generation | `qrcode` (npm) | |
| QR scanning | `html5-qrcode` | Test on low-end Android + mobile Safari |
| File storage | **EC2 local disk** | Nightly backup (rsync/EBS snapshot); migrate to S3/R2 later |
| Payments | **None for MVP** | Keep `plan` field on teacher account (default `'free'`) |
| Email | **Gmail SMTP via Nodemailer** | App password required |
| Hosting | **EC2** | |

### EC2 ops checklist
- **PM2** to keep Express alive.
- **Nginx** reverse proxy; for SSE set `proxy_buffering off` and generous read timeouts.
- **SSL (Let's Encrypt/Certbot)** — mandatory for camera and geolocation.
- Redis on same box for MVP.
- Cron: retention cleanup + nightly backup.

### Gmail SMTP limits
- ~500/day (regular), ~2000/day (Workspace). Plan to swap to Resend/SES with real usage.
- Throttle via BullMQ; don't blast all parent emails at once.

---

## Data Model (draft)

```
teachers
  id, name, email, password_hash, plan (default 'free'), created_at

rooms
  id, teacher_id, name, invite_code,
  attendance_mode ('strict' | 'balanced' | 'static' | 'manual'),
  qr_type ('rotating' | 'static'),
  static_qr_token (nullable, regenerable),
  anchor_lat, anchor_lng (nullable; used by static mode),
  geofence_radius_m,
  gps_policy ('off' | 'warn' | 'reject'),
  selfie_policy ('off' | 'optional' | 'required'),
  require_manual_approval (bool),
  session_window (nullable; schedule for static mode),
  created_at

students
  id, name, email, parent_email,
  consent_status ('pending' | 'granted' | 'denied'), created_at

room_members
  id, room_id, student_id, role ('student' | 'officer'),
  officer_title (nullable), joined_at

attendance_sessions
  id, room_id, started_by_officer_id (nullable for static),
  origin_lat, origin_lng, origin_accuracy,
  status ('active' | 'ended'), started_at, ended_at

attendance_records
  id, session_id, student_id,
  method ('qr_scan' | 'manual'),
  marked_by_officer_id (nullable),
  approval_status ('approved' | 'pending' | 'rejected'),
  selfie_url (nullable),
  student_lat, student_lng, student_accuracy,
  distance_from_origin_m,
  location_flag ('verified' | 'unverified' | 'mismatch'),
  risk_score ('low' | 'medium' | 'high'),
  risk_signals (JSON),
  device_fingerprint, ip_address,
  scanned_at, parent_notified_at (nullable)
```

---

## MVP Build Order

1. Teacher signup/login + create room (mode presets, no payment gate)
2. Invite link → student joins room (with consent capture)
3. Officer assignment
4. **Rotating QR:** Redis rotation + SSE push to officer screens
5. Student scan → validation pipeline (token, session, duplicate) → record attendance
6. **Static QR mode:** signed room token, session window, regenerate token, printable QR page (cheaper than rotating; can ship early)
7. Officer manual override + in-app camera capture + audit log
8. Parent email via Nodemailer + BullMQ (throttled)
9. Selfie capture (per-mode policy)
10. Geofencing (warn/reject per policy)
11. Risk signal scoring (IP mismatch, static coords, jitter, device fingerprint)
12. Teacher dashboard (attendance list, flags/risk review, manual approvals)
13. Retention cleanup + backup cron jobs

Validate the core scan loop with real teachers before tuning geofence/risk thresholds.

---

