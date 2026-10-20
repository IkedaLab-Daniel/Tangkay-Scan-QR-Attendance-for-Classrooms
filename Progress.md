# TangkayScan — Implementation Progress

> Last updated against the MVP spec in `TangkayScan.md`.
> Status key: ✅ Done · ⚠️ Partial · ❌ Not yet

---

## MVP Build Order (from spec)

| # | Feature | Status | Notes |
|---|---|---|---|
| 1 | Teacher signup / login + create room | ✅ Done | Signup, login, refresh, logout, JWT httpOnly cookies, bcrypt passwords, Redis rate-limit |
| 2 | Invite link → student joins room + consent capture | ✅ Done | Magic-link email flow, 6-digit teacher-generated join code fallback, consent granted/denied |
| 3 | Officer assignment | ✅ Done | Teacher assigns officer + title, instant revoke, officer role looked up live (never in JWT) |
| 4 | Rotating QR: Redis rotation + SSE push | ✅ Done | Server-owned 30 s token rotation, prev-token grace period, SSE broadcast to all officer screens |
| 5 | Student scan → validation pipeline → record attendance | ✅ Done | Full ordered pipeline: auth+consent → session open → token → duplicate → geofence → risk → selfie → persist → email stub |
| 6 | Static QR mode | ✅ Done | Signed JWT room token, manual open/close session, regenerate token, printable QR page |
| 7 | Officer manual override + camera + audit log | ✅ Done | Manual mark with optional photo, approval routing, audit trail visible to teacher |
| 8 | Parent email via Nodemailer + BullMQ | ✅ Done | Gmail SMTP, throttled (10/min), idempotency guard, plain text + HTML template |
| 9 | Selfie capture (per-mode policy) | ✅ Done | `getUserMedia` front camera, WebP re-encode, EXIF strip, off/optional/required enforcement |
| 10 | Geofencing (warn/reject per policy) | ✅ Done | Haversine distance, dynamic threshold (`radius + origin_accuracy + student_accuracy`), gps_policy off/warn/reject |
| 11 | Risk signal scoring | ✅ Done | 7 signals: constant accuracy, null sensors, identical coords, impossible jump, clock delta, IP geo mismatch, fingerprint collision; low/medium/high aggregation |
| 12 | Teacher dashboard (attendance list, flags, approvals) | ✅ Done | Session list + summary counts, paginated records, flagged/pending filters, record detail, CSV export, pending approval review + approve/reject |
| 13 | Retention cleanup + backup cron jobs | ✅ Done | Daily node-cron at 02:00 nullifies selfie_url + GPS fields older than 30 days, rsync backup script, PM2 ecosystem config, Nginx config example |

---

## Backend (Express API — `apps/api`)

### Auth
| Feature | Status | Notes |
|---|---|---|
| Teacher signup / login / refresh / logout | ✅ Done | |
| Student magic-link request + verify | ✅ Done | Redis TTL 15 min, one-time use |
| Student join-code (teacher-generated PIN) | ✅ Done | SHA-256 hashed, 24 h expiry |
| Unified `GET /api/auth/me` (teacher + student) | ✅ Done | Reads `typ` claim, returns correct entity |
| httpOnly SameSite cookies | ✅ Done | `lax` in dev, `none; Secure` in production |
| Redis login rate-limit | ✅ Done | 5 attempts / 15 min per ip:email |
| Refresh token DB storage + rotation | ✅ Done | SHA-256 hashed, 7-day expiry |

### Rooms
| Feature | Status | Notes |
|---|---|---|
| CRUD (create, list, get, update, delete) | ✅ Done | |
| Mode preset mapper (Strict/Balanced/Static/Manual → policies) | ✅ Done | |
| Invite code (nanoid 8 chars) + regenerate | ✅ Done | |
| Officer assignment + revoke | ✅ Done | |
| Static QR token generate + regenerate | ✅ Done | |
| Room anchor GPS set via PATCH | ✅ Done | |
| Custom background upload + processing | ✅ Done | Resize 1600px, WebP 80%, EXIF strip, luminance scrim, placeholder data URI |
| Background delete + report + admin remove | ✅ Done | |
| Built-in preset backgrounds | ✅ Done | 3 solid-color WebP presets (paper, sprout, oat) |

### Sessions
| Feature | Status | Notes |
|---|---|---|
| Start rotating session (with officer GPS origin) | ✅ Done | |
| End session | ✅ Done | |
| SSE stream endpoint for officer QR display | ✅ Done | `X-Accel-Buffering: no` for Nginx |
| Token rotation (Redis, 30 s, prev-token grace) | ✅ Done | |
| Static session open / close (manual) | ✅ Done | |
| Scheduled static session windows | ❌ Not yet | Deferred to v2 per spec |
| `GET /api/sessions/recent` (teacher dashboard) | ✅ Done | |
| `GET /api/sessions/active?roomId` (student) | ✅ Done | |
| `GET /api/sessions/absent-roster` (officer manual) | ✅ Done | |

### Scan Pipeline
| Feature | Status | Notes |
|---|---|---|
| GPS array payload contract (`readings[0..10]` + `client_time`) | ✅ Done | Locked; Zod-validated |
| Auth + membership + consent check | ✅ Done | |
| Session open check | ✅ Done | |
| Token check (rotating Redis + static JWT) | ✅ Done | |
| Duplicate check (idempotent) | ✅ Done | |
| Geofence (Haversine + dynamic threshold) | ✅ Done | |
| Risk signal scoring | ✅ Done | All 7 signals |
| Selfie policy enforcement | ✅ Done | |
| Persist attendance record | ✅ Done | Stores full GPS readings JSON |
| Enqueue parent email | ✅ Done | |
| Scan-rate Redis guard (5 s per student/session) | ✅ Done | |

### Manual Override
| Feature | Status | Notes |
|---|---|---|
| Officer manual mark (with optional photo) | ✅ Done | |
| Teacher approval / rejection of pending entries | ✅ Done | |
| List manual entries for session | ✅ Done | |
| Absent-roster for officer manual screen | ✅ Done | |

### Email Workers
| Feature | Status | Notes |
|---|---|---|
| Parent notification email | ✅ Done | BullMQ, concurrency 2, rate-limited 10/min |
| Magic-link email | ✅ Done | |
| Teacher approval-needed notification | ✅ Done | |
| Idempotency guard (`parent_notified_at`) | ✅ Done | |
| Gmail SMTP + App Password | ✅ Done | Config via env |
| Swap to Resend/SES at scale | ❌ Not yet | Noted for future; Gmail 500/day limit applies |

### Data Privacy + Retention
| Feature | Status | Notes |
|---|---|---|
| Consent captured at enrollment | ✅ Done | `consent_status` per student, checked in scan pipeline |
| 30-day selfie + GPS retention cleanup (cron) | ✅ Done | Daily node-cron, nullifies fields, deletes files |
| Selfies served via auth-gated route only | ✅ Done | Never public/listable |
| Background images: EXIF strip on upload | ✅ Done | |
| NPC registration / COPPA / FERPA | ❌ Not yet | Legal process, not code |

### Ops / Deployment
| Feature | Status | Notes |
|---|---|---|
| PM2 ecosystem config (api + worker processes) | ✅ Done | `ecosystem.config.js` |
| Nginx config with SSE settings | ✅ Done | `nginx.conf.example` |
| Nightly rsync backup script | ✅ Done | `scripts/backup.sh` |
| SSL (Let's Encrypt/Certbot) | ❌ Not yet | EC2 setup step, not code |
| EC2 provisioning | ❌ Not yet | Infrastructure, not code |

---

## Frontend (Next.js — `apps/web`)

### Design System
| Feature | Status | Notes |
|---|---|---|
| Full design token set (colors, typography, spacing, radius, shadow) | ✅ Done | All tokens from `TangkayScanDesign.md` + `DESIGN.md` in Tailwind config |
| Bricolage Grotesque headings + DM Sans body | ✅ Done | Google Fonts, self-load via CSS import |
| Material Symbols Outlined icons | ✅ Done | |
| Safe-area padding utilities (`pt-safe`, `pb-safe`) | ✅ Done | |
| Sprout-pop success animation | ✅ Done | CSS keyframe `sprout-pop` |
| PWA manifest | ✅ Done | Basic; icons are placeholder |

### Shared UI Components
| Component | Status | Notes |
|---|---|---|
| `Button` (primary / secondary / ghost / danger) | ✅ Done | |
| `Input` (label, error, hint, icon) | ✅ Done | |
| `Card` (tints: green / oat / peach / none) | ✅ Done | |
| `Badge` (10 variants) | ✅ Done | |
| `Avatar` (image or initials fallback) | ✅ Done | |
| `StatusPill` | ✅ Done | |
| `BottomSheet` (animated slide-up, overlay) | ✅ Done | |
| `Spinner` | ✅ Done | |
| `SproutIcon` (SVG, sm/lg) | ✅ Done | |
| `PageHeader` (fixed, with back + action slots) | ✅ Done | |
| `BottomNav` (teacher / student / officer, badge counts) | ✅ Done | |
| `EmptyState` | ✅ Done | |
| `Toast` / `useToast` | ✅ Done | |
| `RoomCard` (tint cycling, menu, QR button) | ✅ Done | |
| `TeacherGuard` / `StudentGuard` / `OfficerGuard` | ✅ Done | Redirects unauthenticated users |

### Teacher Screens
| Screen | Status | Notes |
|---|---|---|
| Welcome / Sign-up / Login | ✅ Done | Segmented tab switcher, inline errors |
| Rooms dashboard | ✅ Done | Greeting, active room count, room cards, skeleton loading, empty state |
| Room detail (Members / Sessions / Settings tabs) | ✅ Done | |
| Officer assign / revoke (bottom sheet) | ✅ Done | |
| Create room (3-step flow) | ✅ Done | Room details → attendance mode → confirm |
| Session detail (records list, filter tabs, CSV export) | ✅ Done | |
| Session review (flagged entries, risk signals, approve/reject) | ✅ Done | |
| Pending approvals (selfie thumbnail, approve/reject with reason) | ✅ Done | |
| Reports (session list, stat chips, room filter tabs, pending banner) | ✅ Done | |
| Room settings (rules, appearance, static QR, danger zone) | ✅ Done | |
| Background appearance (preset thumbnails, custom upload, dim/blur sliders, live preview) | ✅ Done | |
| Print QR page (print-optimized, window.print) | ✅ Done | |
| Notification badge on Reports tab when approvals pending | ✅ Done | |

### Student Screens
| Screen | Status | Notes |
|---|---|---|
| Join room landing (magic-link form + join-code fallback) | ✅ Done | |
| Check-email confirmation | ✅ Done | |
| Magic-link verify (auto-join + redirect) | ✅ Done | |
| Consent screen (DPA notice, grant/deny) | ✅ Done | |
| Student home (greeting, check-in card, streak, weekly growth grid) | ✅ Done | |
| QR scanner (full-screen, jsQR, GPS watchPosition, selfie capture) | ✅ Done | |
| Scan success (sprout-pop animation, auto-redirect) | ✅ Done | |
| Student reports (attendance history, stat cards, grouped by room) | ✅ Done | |

### Officer Screens
| Screen | Status | Notes |
|---|---|---|
| Officer home (assigned rooms list) | ✅ Done | |
| Session setup / pre-flight (GPS anchor, launch checklist) | ✅ Done | |
| Live QR display (SSE, react-qr-code, countdown arc, present count) | ✅ Done | |
| Manual check-in (absent roster, camera capture, submit) | ✅ Done | |
| Manual entry history (read-only, approval status) | ✅ Done | |

---

## Not Yet Implemented (Post-MVP / v2)

| Item | Reason deferred |
|---|---|
| Scheduled static session windows (Mon/Wed 8:00–8:20) | MVP uses manual open/close only |
| Push notifications | iOS PWA limitations; email is the reliable channel |
| Capacitor native wrapper + Android `isFromMockProvider` | v2 native GPS detection |
| Payment integration / subscription plans | No payment gate in MVP; `plan` field reserved |
| S3 / R2 file storage migration | EC2 local disk for MVP; migrate later |
| Resend / Amazon SES for email at scale | Gmail SMTP for MVP; swap when volume demands |
| Admin panel (multi-teacher, school-level management) | Single teacher per account in MVP |
| Student Settings screen | Not in any design reference for MVP |
| Teacher Settings screen | Not in any design reference for MVP |
| Dark mode | Post-MVP per `TangkayScanDesign.md` |
| PWA service worker + offline background sync | `manifest.json` exists; service worker not registered |
| Installable PWA icons | Placeholder only; real icons not designed yet |
| IP geolocation (production) | ip-api.com free tier integrated; may need paid tier at volume |
| Legal / NPC registration (Philippines Data Privacy Act) | Process, not code |
| EC2 provisioning + SSL (Let's Encrypt) | Infrastructure, not code |
| `next-pwa` integration | Spec lists it; not wired in `next.config.js` yet |
| Automated tests for the frontend | No frontend test suite exists yet |

---

## Known Bugs Fixed During Development

| Bug | Fix |
|---|---|
| Route group URL conflict (all roles resolved to same `/rooms` path) | Added real `teacher/`, `student/`, `officer/` path segments inside each group |
| Auth redirect loop after login (`SameSite=strict` dropped cross-origin in dev) | Changed to `SameSite=lax` in dev, `none; Secure` in prod |
| `AuthContext` stale `user=null` caused `TeacherGuard` to redirect immediately after login | `refresh()` now sets `loading=true`; `handleAuthSuccess` awaits `refresh()` before navigating |
| `GET /api/auth/me` only accepted teacher tokens (students stuck in loop) | Endpoint now reads `typ` claim and handles both `teacher` and `student` |
| API response shape mismatches (frontend expected `{ rooms: [] }`, API returns `[]`) | Fixed all fetch calls to match actual shapes (`data` for paginated, plain array for lists) |
