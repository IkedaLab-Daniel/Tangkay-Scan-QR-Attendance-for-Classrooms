# TangkayScan — Quality Refactor Plan

> **Goal:** Resolve all issues identified in `QA_REPORT.md` — Critical, High, Medium, and Low.
> **Approach:** One focused sub-task per theme. Each sub-task is independently reviewable.
> **New shared abstractions:** `lib/prisma.ts` (singleton), `lib/crypto.ts` (sha256), expanded `requireAuth`/`requireAnyAuth`.
> **Non-goals:** No new features, no schema changes, no test rewrites.

---

## Sub-Task 1 — Create `lib/prisma.ts` singleton and replace all `new PrismaClient()` calls

**Status:** `[x] done`

### Intent
The codebase currently instantiates `new PrismaClient()` in 14+ source files, creating a separate connection pool per module. Official Prisma docs require a singleton to avoid exhausting PostgreSQL's connection limit. This sub-task creates the canonical instance and migrates every source file to use it.

### Expected Outcomes
- `apps/api/src/lib/prisma.ts` exists and exports a single PrismaClient instance via a `globalThis` singleton pattern.
- All source files (non-test) in `apps/api/src` import `prisma` from `'../lib/prisma'` (or `'../../lib/prisma'` depending on depth) instead of calling `new PrismaClient()`.
- No `new PrismaClient()` call remains in any source file outside of `lib/prisma.ts`.
- Test files keep their own `new PrismaClient()` instances (test isolation must be preserved).

### Todo List
- [x] Create `apps/api/src/lib/prisma.ts` using the `globalThis` singleton pattern from Prisma docs.
- [x] Replace `new PrismaClient()` in `routes/auth.ts`.
- [x] Replace `new PrismaClient()` in `routes/studentAuth.ts`.
- [x] Replace `new PrismaClient()` in `routes/rooms.ts`.
- [x] Replace `new PrismaClient()` in `routes/sessions.ts`.
- [x] Replace `new PrismaClient()` in `routes/scan.ts`.
- [x] Replace `new PrismaClient()` in `routes/manual.ts`.
- [x] Replace `new PrismaClient()` in `routes/join.ts`.
- [x] Replace `new PrismaClient()` in `routes/officers.ts`.
- [x] Replace `new PrismaClient()` in `routes/dashboard.ts`.
- [x] Replace `new PrismaClient()` in `routes/background.ts`.
- [x] Replace `new PrismaClient()` in `routes/studentAttendance.ts`.
- [x] Replace `new PrismaClient()` in `middleware/officerGuard.ts`.
- [x] Replace `new PrismaClient()` in `jobs/retentionCleanup.ts`.
- [x] Replace `new PrismaClient()` in `workers/emailWorker.ts`.
- [x] Replace `new PrismaClient()` in `workers/magicLinkWorker.ts`.

### Relevant Context
- Prisma singleton pattern: `const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }; export const prisma = globalForPrisma.prisma ?? new PrismaClient(); if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;`
- All source files above were confirmed to call `new PrismaClient()` by the code search.
- Test files (`*.test.ts`) are intentionally excluded — they manage their own instances for isolation.

---

## Sub-Task 2 — Create `lib/crypto.ts` and remove duplicated `sha256` helpers

**Status:** `[x] done`

### Intent
`sha256(value: string)` is identically defined in `routes/auth.ts`, `routes/rooms.ts`, `routes/studentAuth.ts`, and its test. A shared utility in `lib/crypto.ts` eliminates the duplication and ensures any future change (e.g., algorithm swap) is made in one place.

### Expected Outcomes
- `apps/api/src/lib/crypto.ts` exists and exports `sha256(value: string): string`.
- All three route files import `sha256` from `'../lib/crypto'` and their local definitions are removed.
- `studentAuth.test.ts` imports `sha256` from the same shared module.

### Todo List
- [ ] Create `apps/api/src/lib/crypto.ts` that exports `sha256`.
- [ ] Update `routes/auth.ts` — remove local `sha256`, import from `lib/crypto`.
- [ ] Update `routes/rooms.ts` — remove local `sha256`, import from `lib/crypto`.
- [ ] Update `routes/studentAuth.ts` — remove local `sha256`, import from `lib/crypto`.
- [ ] Update `routes/studentAuth.test.ts` — remove local `sha256`, import from `lib/crypto`.

### Relevant Context
- Local `sha256` definition confirmed at: `auth.ts:34`, `rooms.ts:18`, `studentAuth.ts:60`, `studentAuth.test.ts:23`.
- All four are identical: `crypto.createHash('sha256').update(value).digest('hex')`.

---

## Sub-Task 3 — Fix rate limit and clean up `studentAuth.ts` dead code

**Status:** `[x] done`

### Intent
The student login rate limiter is set to `500` — a debug value that provides no brute-force protection. Additionally, `MAGIC_LINK_TTL_MS` is declared but never used. Both are simple, low-risk fixes in a single file.

### Expected Outcomes
- `RATE_LIMIT` is set to `5` (matching the teacher auth limit in `auth.ts`).
- The `// ! FOR TESTING` comment is removed.
- `MAGIC_LINK_TTL_MS` is either used in the magic-link cookie `maxAge` (if applicable) or removed entirely.

### Todo List
- [x] Change `RATE_LIMIT` from `500` to `5` and remove the test comment (`studentAuth.ts:55`).
- [x] Audit all uses of `MAGIC_LINK_TTL_SECS` and `MAGIC_LINK_TTL_MS` — if `MAGIC_LINK_TTL_MS` is not referenced in any cookie or expiry, remove it; otherwise wire it in.

### Relevant Context
- `RATE_LIMIT = 500; // ! FOR TESTING` — `apps/api/src/routes/studentAuth.ts:55`
- `MAGIC_LINK_TTL_MS` — `apps/api/src/routes/studentAuth.ts:53`
- Teacher equivalent for comparison: `LOGIN_LIMIT = 5` in `routes/auth.ts:90`

---

## Sub-Task 4 — Add global Express error handler and fix inline `require('jsonwebtoken')`

**Status:** `[x] done`

### Intent
Two issues are coupled here: (1) no global error-handling middleware means unhandled Prisma/runtime errors return empty responses, and (2) several files use `require('jsonwebtoken')` inside function bodies — a dynamic import anti-pattern that ESLint flags. Both are fixed in `index.ts` and the affected route files.

### Expected Outcomes
- `apps/api/src/index.ts` has a 4-argument `(err, req, res, next)` Express error handler registered as the last middleware, before `app.listen`.
- All `require('jsonwebtoken')` calls in source files are replaced with top-level `import jwt from 'jsonwebtoken'`.
- No `@typescript-eslint/no-var-requires` suppression comments added for `jsonwebtoken`.

### Todo List
- [x] Add the global error handler to `apps/api/src/index.ts` (after all route registrations, before `app.listen`).
- [x] Replace `require('jsonwebtoken')` with a static import in `routes/sessions.ts` (line 37).
- [x] Replace `require('jsonwebtoken')` with a static import in `index.ts` selfie-serve and manual-serve handlers (lines 101, 138).
- [x] Replace `require('jsonwebtoken')` with a static import in `routes/background.ts` (lines 209, 280).

### Relevant Context
- Express error handler signature: `(err: Error, req: Request, res: Response, next: NextFunction) => void` — must be registered after all other `app.use()` calls.
- Inline `require` confirmed at: `sessions.ts:37`, `index.ts:101+138`, `background.ts:209+280`.
- `jwt` is already a top-level static import in `middleware/auth.ts` — use the same pattern.

---

## Sub-Task 5 — Consolidate duplicated inline auth into `requireAuth` / `requireAnyAuth`

**Status:** `[x] done`

### Intent
JWT verification logic is duplicated across `sessions.ts` (`resolveUser`), `rooms.ts` (inline in `GET /:id`), `index.ts` (inline in selfie and manual file-serving handlers), and `background.ts`. This creates a maintenance hazard. Extending the canonical `requireAuth` middleware to support multi-role checking eliminates all duplication.

### Expected Outcomes
- `middleware/auth.ts` exports a new `requireAnyAuth(...roles: string[])` function that accepts any matching role (e.g. `requireAnyAuth('teacher', 'student')`).
- `routes/sessions.ts` removes `resolveUser()` and uses `requireAnyAuth('teacher', 'student')` on routes that previously called it.
- `routes/rooms.ts` `GET /:id` removes its inline JWT block and uses `requireAnyAuth('teacher', 'student')`.
- `index.ts` file-serving routes use `requireAnyAuth('teacher', 'student')` instead of inline JWT blocks.
- `routes/background.ts` uses `requireAnyAuth` where appropriate.
- Existing `requireAuth('teacher')` and `requireAuth('student')` usages are unchanged.

### Todo List
- [x] Add `requireAnyAuth(...roles: string[])` to `middleware/auth.ts`.
- [x] Refactor `routes/sessions.ts` — remove `resolveUser`, replace with `requireAnyAuth`.
- [x] Refactor `routes/rooms.ts` `GET /:id` — remove inline JWT block, apply `requireAnyAuth`.
- [x] Refactor `index.ts` selfie-serving handler — replace inline JWT block with `requireAnyAuth`.
- [x] Refactor `index.ts` manual-serving handler — replace inline JWT block with `requireAnyAuth`.
- [x] Refactor `routes/background.ts` — replace inline JWT blocks with `requireAnyAuth`.

### Relevant Context
- Canonical middleware: `apps/api/src/middleware/auth.ts`
- Inline JWT locations confirmed: `sessions.ts:23-54`, `rooms.ts:167-184`, `index.ts:92-111` and `128-148`, `background.ts:209-210` and `280-281`
- `resolveUser` in `sessions.ts` is a local helper that replicates `requireAuth` exactly — it can be deleted entirely once `requireAnyAuth` exists.

---

## Sub-Task 6 — Fix `.env.example` key name and remove `checkSelfie` stub

**Status:** `[x] done`

### Intent
Two small but impactful fixes: (1) the `.env.example` uses `REFRESH_SECRET` but the code reads `JWT_REFRESH_SECRET`, which silently breaks any environment set up from the example; (2) the `checkSelfie` stub in `scanPipeline.ts` always returns `pass: true` but is called in the pipeline, creating false confidence that selfie enforcement is part of the pipeline.

### Expected Outcomes
- `apps/api/.env.example` uses `JWT_REFRESH_SECRET` (matching the code).
- The `checkSelfie` stub and its call in `runPipeline` are removed. A comment documents that selfie enforcement is handled before the pipeline in `routes/scan.ts`.

### Todo List
- [x] Rename `REFRESH_SECRET` to `JWT_REFRESH_SECRET` in `apps/api/.env.example`.
- [x] Remove the `checkSelfie` function from `apps/api/src/lib/scanPipeline.ts`.
- [x] Remove the `await checkSelfie(ctx)` call from `runPipeline` in `scanPipeline.ts`.
- [x] Add a brief comment in `runPipeline` noting that selfie policy is enforced in `routes/scan.ts` before the pipeline runs.

### Relevant Context
- `.env.example:12` — `REFRESH_SECRET=change-me-in-production` (wrong key name)
- `studentAuth.ts` reads: `process.env.JWT_REFRESH_SECRET` (correct key)
- `scanPipeline.ts:214-217` — `checkSelfie` stub
- `scanPipeline.ts:285` — `await checkSelfie(ctx)` call in `runPipeline`
- Selfie enforcement lives at `routes/scan.ts:143-146` (pre-pipeline)

---

## Sub-Task 7 — Fix Next.js ESLint issues: fonts, unused variables, SSR guard, OfficerGuard rename

**Status:** `[x] done`

### Intent
Cleans up all remaining frontend issues found by the linter and QA review:
1. Replace the raw Google Fonts `<link>` tags in `layout.tsx` with `next/font/google`.
2. Remove all unused imports and variables across web pages (12 instances).
3. Add an SSR guard to `fingerprint.ts` so `localStorage` is not accessed during server render.
4. Rename `OfficerGuard` to `StudentGuard` (it is identical to `StudentGuard` — the misleading name implies officer-role enforcement that does not exist on the frontend).

### Expected Outcomes
- `apps/web/src/app/layout.tsx` uses `next/font/google` for Bricolage Grotesque and DM Sans; raw `<link>` tags removed. Material Symbols (icon font) may stay as a `<link>` if it is not available through `next/font`.
- `apps/web/src/lib/fingerprint.ts` returns `''` when `typeof window === 'undefined'`.
- `OfficerGuard` is renamed to `StudentGuard` in `auth.tsx`; all import sites updated.
- All unused imports/variables removed from the 7 affected web page files.
- ESLint runs with 0 errors and ≤ 1 warning (only the namespace warning in `auth.ts` remains, fixed below).

### Todo List
- [x] Migrate Google Fonts to `next/font/google` in `layout.tsx` (Bricolage Grotesque + DM Sans).
- [x] Add `typeof window === 'undefined'` guard to `fingerprint.ts`.
- [x] Rename `OfficerGuard` → `StudentGuard` in `apps/web/src/lib/auth.tsx` and update the JSDoc.
- [x] Update all files that import `OfficerGuard` from `auth.tsx` to use `StudentGuard`.
- [x] Remove unused imports/variables in `(officer)/officer/rooms/page.tsx` (`Spinner`).
- [x] Remove unused imports/variables in `(student)/student/rooms/page.tsx` (`DAY_LABELS`, `isSameDay`, `getWeekNumber`).
- [x] Remove unused variable in `(student)/student/scan/.../success/page.tsx` (`roomId`).
- [x] Remove unused import in `(teacher)/teacher/rooms/[id]/page.tsx` (`Avatar`).
- [x] Remove unused variable in `(teacher)/teacher/.../approvals/page.tsx` (`isIdle`).
- [x] Remove unused variable in `(teacher)/teacher/.../sessions/[sessionId]/page.tsx` (`router`).
- [x] Remove unused import in `(teacher)/teacher/.../settings/page.tsx` (`PageHeader`).

### Relevant Context
- Font `<link>` tags confirmed in `layout.tsx:26-33` — Bricolage Grotesque, DM Sans, Material Symbols.
- `fingerprint.ts` full content confirmed — no SSR guard present.
- `OfficerGuard` defined at `auth.tsx:122` — identical body to `StudentGuard` at `auth.tsx:97`.
- Unused variable locations confirmed from ESLint output in QA report.

---

## Sub-Task 8 — Fix API `auth.ts` namespace lint error and remaining low-severity items

**Status:** `[x] done`

### Intent
Cleans up the remaining Low issues: the ESLint `@typescript-eslint/no-namespace` error on the Express type augmentation in `middleware/auth.ts`, the unused `requireAuth` import in `routes/auth.ts`, the missing Multer file-type filter in `routes/scan.ts`, and the SSE stream student-membership gap in `routes/sessions.ts`.

### Expected Outcomes
- `middleware/auth.ts` uses `declare module 'express'` augmentation syntax instead of `namespace Express`, eliminating the lint error.
- `routes/auth.ts` no longer imports unused `requireAuth`.
- `routes/scan.ts` Multer config includes a `fileFilter` that rejects non-image MIME types before they reach memory.
- `routes/sessions.ts` `GET /:id/stream` verifies that a student subscriber is a member of the room's session before subscribing.
- `npm run lint` exits with 0 errors.

### Todo List
- [ ] Replace `namespace Express` with `declare module 'express'` in `middleware/auth.ts` for the `Request` augmentation.
- [ ] Remove the unused `requireAuth` import from `routes/auth.ts` (the `/me` endpoint handles auth inline by design — leave a comment explaining it).
- [ ] Add a `fileFilter` to the `multer` config in `routes/scan.ts` that only allows `image/jpeg`, `image/png`, and `image/webp`.
- [ ] Add a student membership check to `GET /:id/stream` in `routes/sessions.ts` (verify `RoomMember` exists for the student before calling `sseManager.subscribe`).

### Relevant Context
- Lint error: `middleware/auth.ts:13` — `ES2015 module syntax is preferred over namespaces`
- Correct pattern: `declare module 'express' { interface Request { user?: ...; member?: ... } }`
- Unused import: `routes/auth.ts:8` — `requireAuth`
- Multer config: `routes/scan.ts:29-32` — add `fileFilter` callback
- SSE gap: `routes/sessions.ts:225-253` — student path has no membership check
