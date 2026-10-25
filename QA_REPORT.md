# TangkayScan — QA Engineering Report

> **Reviewer:** QA Engineering (AI-assisted)
> **Date:** 2025-07-09
> **Scope:** Full codebase — `apps/api` (Express + Prisma) and `apps/web` (Next.js 14 App Router)
> **Method:** Static code analysis + documentation cross-check via Context7 (official Prisma, Express, and Next.js docs)

---

## Executive Summary

The codebase is **well-structured and production-aware** for an MVP. Authentication, scan pipeline, risk scoring, and image processing are all thoughtfully implemented. However, there are **several critical and medium-severity issues** that must be addressed before a production release, particularly around database connection management, missing global error handling, a debug-level rate limit, and route guard completeness on the frontend.

| Severity | Count |
|----------|-------|
| 🔴 Critical | 3 |
| 🟠 High | 4 |
| 🟡 Medium | 5 |
| 🔵 Low / Info | 6 |

---

## 🔴 Critical Issues

### C-1 — PrismaClient instantiated multiple times (one per module)

**Files affected:** `apps/api/src/routes/auth.ts`, `rooms.ts`, `sessions.ts`, `scan.ts`, `manual.ts`, `join.ts`, `officers.ts`, `background.ts`, `dashboard.ts`, `studentAuth.ts`, `middleware/officerGuard.ts`, `jobs/retentionCleanup.ts`

**Problem:** Every route file calls `new PrismaClient()` at module level. With 12+ modules, this creates 12+ separate database connection pools, rapidly exhausting PostgreSQL's default `max_connections` limit (typically 100).

**Evidence from Prisma official docs (via Context7):**
> *"To avoid exhausting database connections during development hot reloads, use globalThis to cache the client across module reloads."* — [Prisma docs](https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/databases-connections)

**Fix:** Create a single shared singleton:

```typescript
// apps/api/src/lib/prisma.ts
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };
export const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
export default prisma;
```

Then replace all `new PrismaClient()` calls with `import prisma from '../lib/prisma'`.

---

### C-2 — Debug rate limit left in production path

**File:** `apps/api/src/routes/studentAuth.ts`, line 55

```typescript
const RATE_LIMIT = 500; // ! FOR TESTING
```

**Problem:** A limit of 500 requests per 15-minute window per IP+email makes the rate limiter effectively inoperative. The teacher auth route (`auth.ts`) uses `LOGIN_LIMIT = 5`, which is correct. This leftover debug value means the student login endpoint has no meaningful brute-force protection.

**Fix:** Set to a safe value (`5` or `10`) and remove the comment before any production deployment.

---

### C-3 — No global error-handling middleware in Express

**File:** `apps/api/src/index.ts`

**Problem:** Every async route handler in the codebase wraps Prisma calls without any top-level `try/catch` fallback. An unhandled Prisma error (e.g., a database outage mid-request) will cause Express to return an empty response or crash the process. There is no `(err, req, res, next)` error handler registered anywhere.

**Evidence from Express official docs (via Context7):**
> *"Use async functions and promises to handle errors in Express. Errors thrown in async functions are automatically passed to the error handler via `next(err)`."*

**Fix:** Add at the bottom of `index.ts`, before `app.listen`:

```typescript
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[unhandled]', err);
  res.status(500).json({ error: 'Internal server error' });
});
```

---

## 🟠 High Issues

### H-1 — `require('jsonwebtoken')` used inside route handlers instead of static import

**Files:** `apps/api/src/routes/sessions.ts` (lines 37–41), `apps/api/src/index.ts` (lines 101, 138)

**Problem:** Using `require()` inside a function body bypasses Node module caching benefits, bypasses TypeScript's module resolution, and is explicitly flagged by the ESLint `@typescript-eslint/no-var-requires` rule. `jsonwebtoken` is already a static import in `middleware/auth.ts` — there is no reason to use dynamic require elsewhere.

**Fix:** Replace all inline `require('jsonwebtoken')` calls with a top-level `import jwt from 'jsonwebtoken'`.

---

### H-2 — Auth logic duplicated across route files instead of reusing `requireAuth`

**Files:** `apps/api/src/routes/sessions.ts`, `apps/api/src/routes/rooms.ts` (line 167), `apps/api/src/index.ts` (lines 92–111, 128–148)

**Problem:** A local `resolveUser()` helper in `sessions.ts` and inline JWT-verification blocks in `rooms.ts` and `index.ts` all replicate the same token-read → verify → role-check logic that already exists in the canonical `requireAuth` middleware. Any future change to token handling (e.g., adding token revocation) must be applied in 4+ separate places.

**Fix:** Extend `requireAuth` to accept an array of roles, or create a `requireAnyAuth` variant, and remove all duplicated inline auth code.

---

### H-3 — `OfficerGuard` does not verify officer role — only checks student JWT

**File:** `apps/web/src/lib/auth.tsx`, lines 122–141

**Problem:** `OfficerGuard` is identical to `StudentGuard` — it only checks `user.typ === 'student'`. It does **not** verify that the student has `role = 'officer'` in the specific room. A regular student can access officer-only UI pages by navigating directly to their URLs.

**Note:** The API correctly enforces officer role server-side, so this is a UX/information-disclosure issue, not a security bypass. However, it is misleading to have a named `OfficerGuard` that does not guard the officer role.

**Fix:** Either rename it to `StudentGuard` (since they're identical), or fetch the officer status from the API and enforce it in the guard.

---

### H-4 — Selfie pipeline check is a stub (`checkSelfie` always returns `pass: true`)

**File:** `apps/api/src/lib/scanPipeline.ts`, lines 214–217

```typescript
export async function checkSelfie(_ctx: PipelineContext): Promise<CheckResult> {
  // Replaced in Sub-Task 10
  return { pass: true };
}
```

**Problem:** Selfie policy (`required`) enforcement is done *before* the pipeline in `scan.ts` (line 143), but the actual pipeline check is an acknowledged stub. This creates a divergence: the pre-pipeline check correctly rejects missing required selfies, but the in-pipeline check is a no-op. Any refactoring that removes the pre-pipeline check would silently break selfie enforcement.

**Fix:** Either implement `checkSelfie` fully within the pipeline and remove the pre-pipeline check, or delete the stub entirely and leave a comment noting that enforcement lives outside the pipeline.

---

## 🟡 Medium Issues

### M-1 — Font loaded via `<link>` tag, not `next/font`

**File:** `apps/web/src/app/layout.tsx` (ESLint warning: `@next/next/no-page-custom-font`)

**Problem:** A custom font is loaded via a raw `<link>` tag in the root layout, which triggers the Next.js lint warning. The Next.js App Router's `next/font` module provides automatic font subsetting, zero layout shift prevention, and self-hosting without an external request.

**Evidence from Next.js official docs (via Context7):**
> *"To apply a font to your entire application, add it to the Root Layout using `next/font/google` or `next/font/local`."*

**Fix:** Replace the `<link>` tag with `next/font/google` or `next/font/local` in the root layout.

---

### M-2 — `requireAuth` imported but unused in `auth.ts`

**File:** `apps/api/src/routes/auth.ts`, line 8

**Problem:** `requireAuth` is imported but never used (ESLint warning). This is dead code. The `/api/auth/me` endpoint performs its own inline JWT verification instead of using the middleware.

**Fix:** Either use `requireAuth` in the `/me` endpoint (accepting both teacher and student) or remove the import and keep the inline check with a comment explaining why.

---

### M-3 — `MAGIC_LINK_TTL_MS` declared but never used

**File:** `apps/api/src/routes/studentAuth.ts`, line 53

**Problem:** The constant is computed from `MAGIC_LINK_TTL_SECS` but never referenced in any cookie `maxAge` or expiry calculation. The magic link cookie likely uses a hardcoded value elsewhere or is unset.

**Fix:** Either use this constant where the magic-link cookie expiry is set, or remove it.

---

### M-4 — Multiple unused variables across web pages

**Files (from ESLint output):**
- `(officer)/officer/rooms/page.tsx` — `Spinner` imported but unused
- `(student)/student/rooms/page.tsx` — `DAY_LABELS`, `isSameDay`, `getWeekNumber` all unused
- `(student)/student/scan/.../success/page.tsx` — `roomId` destructured but unused
- `(teacher)/teacher/rooms/[id]/page.tsx` — `Avatar` unused
- `(teacher)/teacher/.../approvals/page.tsx` — `isIdle` unused
- `(teacher)/teacher/.../sessions/[sessionId]/page.tsx` — `router` unused
- `(teacher)/teacher/.../settings/page.tsx` — `PageHeader` unused

**Problem:** Dead imports and variables increase bundle size slightly and signal incomplete refactoring.

**Fix:** Remove all unused imports and declarations.

---

### M-5 — `getDeviceFingerprint()` uses `localStorage` — not available in SSR

**File:** `apps/web/src/lib/fingerprint.ts`

**Problem:** The function reads/writes `localStorage` directly with no `typeof window !== 'undefined'` guard. In a Next.js App Router context where components can render on the server, calling this function outside a `useEffect` or client component boundary will throw `ReferenceError: localStorage is not defined`.

**Fix:** Add a guard:

```typescript
export function getDeviceFingerprint(): string {
  if (typeof window === 'undefined') return '';
  // ... existing logic
}
```

---

## 🔵 Low / Info

### L-1 — `sha256` helper duplicated in `auth.ts` and `rooms.ts`

Both files define an identical `sha256(value: string)` function. Extract to `apps/api/src/lib/crypto.ts`.

---

### L-2 — No `Content-Type` validation on file upload endpoints

**File:** `apps/api/src/routes/scan.ts`

Multer accepts any MIME type; the signature check happens *after* upload. Sending a non-image file will be processed by `processImage` which will then throw. Consider adding a `fileFilter` to Multer to reject non-image MIME types before they hit memory.

---

### L-3 — `static_qr_token` has no expiry — it is a non-expiring JWT

**File:** `apps/api/src/routes/rooms.ts`, line 394

```typescript
jwt.sign({ typ: 'static_qr', roomId: room.id }, process.env.JWT_SECRET as string)
// No expiry
```

This is intentional by design (comment says "valid until regenerated"), but it means if `JWT_SECRET` is ever rotated, all static QR tokens become invalid silently. Document this dependency clearly in the README/runbook.

---

### L-4 — SSE stream does not check student membership for non-officer students

**File:** `apps/api/src/routes/sessions.ts`, lines 225–253

When `user.typ === 'student'`, the stream handler only checks that the session exists and the teacher owns the room — it does **not** verify the student is a member. Any authenticated student can subscribe to any session's SSE stream and receive live token broadcasts.

---

### L-5 — `REFRESH_SECRET` vs `JWT_REFRESH_SECRET` mismatch in env docs

**File:** `apps/api/.env.example`

The env example declares `REFRESH_SECRET=...` (line 13), but the code reads `process.env.JWT_REFRESH_SECRET`. The example key name is wrong and will cause silent failures when developers copy it verbatim.

---

### L-6 — `namespace Express` augmentation triggers ESLint error

**File:** `apps/api/src/middleware/auth.ts`, line 13

```
error  ES2015 module syntax is preferred over namespaces  @typescript-eslint/no-namespace
```

This is a known pattern for augmenting Express's `Request` type. Add an ESLint disable comment with an explanation, or use module augmentation via `declare module 'express'` to suppress it cleanly.

---

## ✅ What's Done Well

- **Auth architecture** — httpOnly cookies, short-lived access tokens (15m), hashed refresh tokens in DB, login rate-limiting via Redis. All correct and following best practices.
- **Scan pipeline** — Clean, composable, testable pipeline design with clearly separated check functions.
- **Risk scoring** — 7 independent signals (constant accuracy, identical coords, impossible jump, clock delta, IP geo mismatch, fingerprint collision, null sensors) with a clean aggregation function. The async signals run in parallel via `Promise.all`.
- **Image processing** — Magic-number signature validation before Sharp processing, EXIF stripping, WebP re-encoding. Correct and defensive.
- **Data retention** — 30-day selfie/GPS cleanup cron job with ENOENT handling. Good privacy practice.
- **Zod validation** — Every route validates its body with a Zod schema before touching the database.
- **Token rotation** — 30s rotating QR tokens with a 35s grace-period prev-token window is well-designed.
- **TypeScript** — Both `typecheck:api` and `typecheck:web` pass clean with zero errors.
- **Prisma schema** — Clean enum usage, proper cascade deletes, unique constraints on `[session_id, student_id]` for idempotency.

---

## Summary Table

| ID | Severity | File(s) | Issue |
|----|----------|---------|-------|
| C-1 | 🔴 Critical | All route files | Multiple `new PrismaClient()` — use singleton |
| C-2 | 🔴 Critical | `studentAuth.ts:55` | Rate limit set to 500 (debug value) |
| C-3 | 🔴 Critical | `index.ts` | No global Express error handler |
| H-1 | 🟠 High | `sessions.ts`, `index.ts` | `require('jsonwebtoken')` inside functions |
| H-2 | 🟠 High | `sessions.ts`, `rooms.ts`, `index.ts` | Auth logic duplicated — should use `requireAuth` |
| H-3 | 🟠 High | `auth.tsx` | `OfficerGuard` doesn't check officer role |
| H-4 | 🟠 High | `scanPipeline.ts` | `checkSelfie` is an unimplemented stub |
| M-1 | 🟡 Medium | `layout.tsx` | Font loaded via `<link>`, not `next/font` |
| M-2 | 🟡 Medium | `auth.ts` | `requireAuth` imported but unused |
| M-3 | 🟡 Medium | `studentAuth.ts` | `MAGIC_LINK_TTL_MS` unused |
| M-4 | 🟡 Medium | Multiple web pages | Unused imports/variables (12 total) |
| M-5 | 🟡 Medium | `fingerprint.ts` | `localStorage` access without SSR guard |
| L-1 | 🔵 Low | `auth.ts`, `rooms.ts` | `sha256` helper duplicated |
| L-2 | 🔵 Low | `scan.ts` | No Multer MIME type filter |
| L-3 | 🔵 Low | `rooms.ts` | Static QR JWT has no expiry — undocumented risk |
| L-4 | 🔵 Low | `sessions.ts` | SSE stream has no student membership check |
| L-5 | 🔵 Low | `.env.example` | `REFRESH_SECRET` key name wrong (should be `JWT_REFRESH_SECRET`) |
| L-6 | 🔵 Low | `auth.ts` | `@typescript-eslint/no-namespace` lint error on Express augmentation |
