# Upstash Redis TLS Compatibility Plan

## Overview

The API uses `ioredis` and BullMQ, both of which require a native Redis protocol connection.
Upstash provides a TLS-secured endpoint via the `rediss://` scheme. A single conditional option
needs to be added to `apps/api/src/lib/redis.ts` so the connection works with Upstash in production
while remaining compatible with a plain `redis://` URL for local dev.

The `.env.example` also needs updating to document the correct `rediss://` format for Upstash.

## Sub-Tasks

---

### Sub-Task 1 — Add conditional TLS to redis.ts

**Intent**  
`ioredis` does not automatically enable TLS for `rediss://` URLs in all Node versions. Adding
`tls: {}` when the URL starts with `rediss://` ensures the TLS handshake succeeds for Upstash
without affecting local dev (`redis://`).

**Expected Outcomes**  
- `apps/api/src/lib/redis.ts` reads `REDIS_URL` into a variable first  
- `tls: {}` is spread into the ioredis options only when the URL starts with `rediss://`  
- Local dev (`redis://localhost:6379`) is unaffected  
- BullMQ `maxRetriesPerRequest: null` is preserved

**Todo List**  
- [ ] Extract `REDIS_URL` into a `redisUrl` variable before passing to `new Redis()`  
- [ ] Add `...(redisUrl.startsWith('rediss://') ? { tls: {} } : {})` to the options object  
- [ ] Add a comment explaining this is required for Upstash / TLS connections

**Relevant Context**  
- File: `apps/api/src/lib/redis.ts`  
- `ioredis` version: `^5.4.2` (see `apps/api/package.json`)  
- BullMQ requires `maxRetriesPerRequest: null` — must not be removed  
- All other files import the default export from this file; no other files need changes

**Status** — [ ] pending

---

### Sub-Task 2 — Update .env.example with Upstash format

**Intent**  
Document the correct `REDIS_URL` format for Upstash so any developer setting up the project
knows to use `rediss://` (double-s, TLS) rather than `redis://`.

**Expected Outcomes**  
- `apps/api/.env.example` shows the `rediss://` URL format in the Redis section  
- A comment above it explains this is the Upstash TLS format  
- The local dev `redis://localhost:6379` fallback is shown as an alternative comment

**Todo List**  
- [ ] Replace the existing `REDIS_URL=redis://localhost:6379` line in `apps/api/.env.example`  
  with a comment block and `REDIS_URL=rediss://default:<token>@<host>.upstash.io:6379`  
- [ ] Add a comment showing the local dev alternative: `# Local: redis://localhost:6379`

**Relevant Context**  
- File: `apps/api/.env.example`  
- The `rediss://` URL format comes from the Upstash dashboard under "ioredis" connection details

**Status** — [ ] pending
