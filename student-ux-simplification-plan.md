# Student UX Simplification Plan

## Confirmed Design Decisions

| Decision | Choice |
|---|---|
| Auth routes | `/auth/teacher` and `/auth/student` |
| Weekly attendance grid | Removed from home; lives inside per-room detail view (accessible on card tap) |
| "Enter Room ID" join | Bottom sheet — preview + confirm slides up from bottom |

---

## Overview

Users reported the current student onboarding (invite link → fill name/email on /join/:code → magic-link email → verify → consent) is confusing. The goal is to simplify the experience to feel more like Microsoft Teams: a clear role-picker at first launch, a student auth page that works independently of a room invite, and a student dashboard that shows joined rooms as cards with a quick "Enter Room ID" join flow.

**Scope:**
1. **Auth pages** — add a role-picker screen before login/signup; teacher and student flows have distinct pages.
2. **Student auth** — dedicated student sign-in/sign-up page (email + name → magic-link), decoupled from the `/join/:inviteCode` flow.
3. **Backend** — make `inviteCode` optional in `POST /api/auth/student/request-link`; update verify to handle the no-room-code case.
4. **Student dashboard** — replace the current single-room-focused page with Teams-style class cards showing all enrolled rooms; empty state shows an "Enter Room ID" input + Join button.

**Non-goals:**
- No changes to teacher auth flow (email + password stays as-is).
- No changes to officer flows, scan flows, or attendance logic.
- No new database migrations required.
- The `/join/:inviteCode` route is kept and still works (for shared invite links).

---

## Sub-Tasks

---

### Sub-Task 1 — Add Role-Picker to Auth Entry Point

**Status:** `[x] done`

**Intent:**
Replace the current `/welcome` page (which immediately shows a teacher-only sign-up/log-in card) with a role-picker screen — "I'm a Teacher" / "I'm a Student". Each choice navigates to its own dedicated auth page. This is the single most visible change that eliminates the confusion of "where do students even go?"

**Expected Outcomes:**
- `/welcome` shows two large role-choice buttons (Teacher / Student) after the TangkayScan brand header.
- Clicking "I'm a Teacher" navigates to `/auth/teacher` (teacher sign-up/log-in — same form content as current `/welcome`, just moved).
- Clicking "I'm a Student" navigates to `/auth/student` (new student magic-link page).
- Existing redirect logic (already-logged-in teacher → `/teacher/rooms`, student → `/student/rooms`) stays on `/welcome`.
- Route guards (`TeacherGuard`, `StudentGuard`) still redirect to `/welcome` when unauthenticated.

**Todo List:**
1. Refactor `apps/web/src/app/(auth)/welcome/page.tsx` — strip the teacher sign-up/login card; add two large CTA buttons ("I'm a Teacher" and "I'm a Student") with icons.
2. Create `apps/web/src/app/(auth)/auth/teacher/page.tsx` — move the existing `SignUpForm` / `LoginForm` components here (cut-paste, add a back-to-welcome link).
3. Create `apps/web/src/app/(auth)/auth/student/page.tsx` — new page (built in Sub-Task 2, but the route file is created here as a placeholder/redirect).
4. Update `TeacherGuard` and `StudentGuard` in `apps/web/src/lib/auth.tsx` — redirect unauthenticated users to `/welcome` (no change needed; confirm it still points there).

**Relevant Context:**
- [`apps/web/src/app/(auth)/welcome/page.tsx`](apps/web/src/app/(auth)/welcome/page.tsx) — current welcome page with all teacher forms.
- [`apps/web/src/lib/auth.tsx`](apps/web/src/lib/auth.tsx) — `TeacherGuard`, `StudentGuard` (redirect targets are `/welcome`).
- The `(auth)` route group uses a centered-card layout defined in its `layout.tsx`.

---

### Sub-Task 2 — Create Dedicated Student Auth Page

**Status:** `[x] done`

**Intent:**
Students now have their own sign-in page at `/auth/student`. It collects name + email, sends a magic-link, and redirects to `/auth/student/check-email`. After email verification, the student lands on the dashboard. Room joining is done separately from the dashboard (not tied to auth). This mirrors the Teams model where you log in first, then join a class.

**Expected Outcomes:**
- `GET /auth/student` shows a form: full name + email → "Send sign-in link" button.
- On submit, calls `POST /api/auth/student/request-link` with `{ name, email }` (no `inviteCode`).
- Redirects to `/auth/student/check-email` (can reuse or redirect to existing `/join/check-email`).
- After clicking the magic-link email, student lands on `/student/rooms` (standard post-auth redirect from `/verify/:token`).
- The page has a "Back" link to `/welcome` and a note explaining what magic-link means.

**Todo List:**
1. Create `apps/web/src/app/(auth)/auth/student/page.tsx` — StudentMagicLinkForm component (name + email fields, same styling as existing auth forms, calls request-link with no `inviteCode`).
2. Create `apps/web/src/app/(auth)/auth/student/check-email/page.tsx` — or reuse/redirect to the existing `(auth)/join/check-email` page (evaluate if it has any invite-specific content that needs generalizing).
3. Update `apps/api/src/routes/studentAuth.ts` — make `inviteCode` optional in `requestLinkSchema` (`z.string().min(1).optional()`); skip the room lookup when `inviteCode` is absent; store `{ email, name, inviteCode: undefined }` in Redis payload.
4. Update `GET /api/auth/student/verify/:token` in `studentAuth.ts` — read `inviteCode` from Redis payload; if absent, skip the room-join step and redirect straight to `/student/rooms` (the verify response already just returns the student; the frontend in `verify/page.tsx` handles the redirect).
5. Update `apps/web/src/app/(auth)/verify/[token]/page.tsx` — after successful verify, check if `ts_pending_invite` exists in sessionStorage; if yes, do auto-join (current behavior); if no, just `router.replace('/student/rooms')`.

**Relevant Context:**
- [`apps/api/src/routes/studentAuth.ts`](apps/api/src/routes/studentAuth.ts:15) — `requestLinkSchema` (line 15–19), `request-link` handler (line 115).
- [`apps/web/src/app/(auth)/join/[inviteCode]/page.tsx`](apps/web/src/app/(auth)/join/[inviteCode]/page.tsx) — existing magic-link form, for copy-reference of the form's styling pattern.
- [`apps/web/src/app/(auth)/verify/[token]/page.tsx`](apps/web/src/app/(auth)/verify) — post-verify redirect logic using `ts_pending_invite`.
- [`apps/api/src/workers/magicLinkWorker.ts`](apps/api/src/workers/magicLinkWorker.ts:148) — `room` fallback line already handles missing `roomName`/`inviteCode` gracefully.

---

### Sub-Task 3 — Redesign Student Dashboard as Teams-Style Room Cards

**Status:** `[x] done`

**Intent:**
The current student home (`/student/rooms`) is single-room focused — it shows one primary room's weekly grid and a single scan button. Students who are in multiple rooms get no clear way to navigate between them. The new design shows all enrolled rooms as cards (like Teams "Teams" tab), with each card showing: room name, teacher name, attendance streak badge, and a Scan button. The empty state shows an "Enter Room ID" input for fast room joining.

**Expected Outcomes:**
- `/student/rooms` shows a scrollable list/grid of enrolled room cards.
- Each card displays: room name, teacher name, an attendance streak/summary badge (e.g., "4/5 this week"), and a "Scan" button that navigates to `/student/scan/:roomId`.
- Empty state (no rooms): shows an illustration + "You haven't joined any classes yet" + an "Enter Room ID" input with a "Join" button.
- Non-empty state: "Enter Room ID" is available as a smaller secondary CTA (e.g., a "+" button or "Join another class" link) so students can join additional rooms without needing a shareable link.
- The weekly grid widget moves to a per-card detail or is removed from the home screen to reduce clutter (design decision: keep it only if room count is 1).
- The join flow: student enters the 8-char `invite_code` → frontend calls `GET /api/rooms/join/:code` to preview the room → shows a small confirmation → calls `POST /api/rooms/:id/join` → redirects to `/student/consent/:roomId`.

**Todo List:**
1. Refactor `apps/web/src/app/(student)/student/rooms/page.tsx`:
   - Replace single-room hero layout with a card list for all enrolled rooms.
   - Each card shows: room name, teacher name, attendance badge (e.g. "4/5 this week"), and a "Scan" button. Card is tappable to expand/navigate to a per-room detail view (where the weekly grid lives).
   - Empty state (no rooms): illustration + "You haven't joined any classes yet" + "Enter Room ID" field + "Join" button (opens bottom sheet).
   - Non-empty state: floating "+" action or "Join another class" chip at the bottom of the list to open the same bottom sheet.
   - Remove the global weekly grid widget from this page entirely.
2. Create `JoinByCodeSheet` component — a `BottomSheet` (uses existing `components/ui/BottomSheet.tsx`) with two steps:
   - Step 1: Room ID text input (8-char invite_code) + "Look up" button. On submit: `GET /api/rooms/join/:code` → shows room preview (name + teacher).
   - Step 2: Room preview card + "Join [Room Name]" confirm button → `POST /api/rooms/:id/join` → close sheet → navigate to `/student/consent/:roomId`.
   - Handle errors: invalid code shows inline error in sheet, stays on step 1.
3. Fetch teacher name per room: verify `GET /api/rooms/my-rooms` returns teacher name; if not, add `teacher: { select: { name: true } }` to the Prisma `findMany` in `rooms.ts` and include it in the response shape.
4. Calculate per-room attendance badge: filter existing `/api/student/my-attendance` records by `session.room_id` to get a per-room this-week count (client-side, no new API needed).
5. Update `apps/web/src/lib/types.ts` if needed — ensure `EnrolledRoom` type includes `teacher_name`.

**Relevant Context:**
- [`apps/web/src/app/(student)/student/rooms/page.tsx`](apps/web/src/app/(student)/student/rooms/page.tsx) — current page to refactor; `EnrolledRoom` type (line 13), `api.get('/api/rooms/my-rooms')` call (line 161).
- [`apps/web/src/components/RoomCard.tsx`](apps/web/src/components/RoomCard.tsx) — existing room card; may be extended or replaced.
- [`apps/api/src/routes/rooms.ts`](apps/api/src/routes/rooms.ts) — `GET /api/rooms/my-rooms` endpoint; check if teacher name is included in the response.
- [`apps/web/src/app/(auth)/join/[inviteCode]/page.tsx`](apps/web/src/app/(auth)/join/[inviteCode]/page.tsx) — existing join-by-code logic for reference (`handleVerifyCode`).

---

## Notes for Implementation

- All three sub-tasks are independent; Sub-Task 1 and 2 can be done together (they share the new `/auth/*` routes), but Sub-Task 3 is fully separate.
- The `/join/:inviteCode` route and flow is **preserved** — shared invite links still work as before.
- The magic-link email template in `magicLinkWorker.ts` currently says "You have been invited to join [room]". When `inviteCode` is absent, update the fallback text to "Sign in to TangkayScan" (the `room` variable fallback on line 148 already handles this: `roomName ?? (inviteCode ? ... : 'TangkayScan')`).
- Sub-Task 2 backend change is a non-breaking additive change — existing callers that send `inviteCode` keep working.
