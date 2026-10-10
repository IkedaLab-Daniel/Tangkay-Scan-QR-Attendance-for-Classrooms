# TangkayScan

> Mobile-first QR attendance for classrooms. Teachers create rooms, assign officers, and pick an attendance mode. Students scan a rotating or static QR to mark presence. Parents get email notifications.

## Tech Stack

| Layer | Technology |
|---|---|
| API | Express 4 + TypeScript |
| Web | Next.js 14 (App Router) + Tailwind CSS |
| Database | PostgreSQL + Prisma |
| Cache / Queues | Redis + BullMQ |
| Monorepo | npm workspaces |

---

## Prerequisites

- **Node.js** ≥ 20
- **npm** ≥ 10
- **PostgreSQL** (local or Docker)
- **Redis** (local or Docker)

---

## Quick Start

### 1 — Clone and install

```bash
git clone <repo-url>
cd tangkayscan
npm install          # installs all workspace dependencies
```

### 2 — Environment files

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
```

Edit `apps/api/.env`:
- Set `DATABASE_URL` to your PostgreSQL connection string
- Set `REDIS_URL` to your Redis connection string
- Generate a strong `JWT_SECRET` (≥ 32 chars)

### 3 — Database setup

```bash
# Generate Prisma client
npm run prisma:generate --workspace=apps/api

# Run migrations (creates all tables)
npm run prisma:migrate --workspace=apps/api
```

### 4 — Run in development

```bash
# API on http://localhost:4000
npm run dev:api

# Web on http://localhost:3000  (separate terminal)
npm run dev:web
```

Health check: `curl http://localhost:4000/health`

---

## Project Structure

```
tangkayscan/
├── apps/
│   ├── api/                   Express + TypeScript API
│   │   ├── prisma/
│   │   │   └── schema.prisma  Full data model
│   │   └── src/
│   │       ├── index.ts       Server entry, health route
│   │       ├── lib/
│   │       │   ├── redis.ts   ioredis client
│   │       │   └── queue.ts   BullMQ emailQueue
│   │       ├── routes/        (added per sub-task)
│   │       ├── middleware/    (added per sub-task)
│   │       └── workers/       (added per sub-task)
│   └── web/                   Next.js 14 App Router
│       └── src/app/           Root layout + page shell
├── tsconfig.base.json         Shared TypeScript config
├── .eslintrc.json             ESLint (root)
├── .prettierrc.json           Prettier (root)
└── package.json               npm workspaces root
```

---

## Available Scripts (root)

| Script | Description |
|---|---|
| `npm run dev:api` | Start API in watch mode (ts-node-dev) |
| `npm run dev:web` | Start Next.js dev server |
| `npm run build:api` | Compile API to `apps/api/dist/` |
| `npm run build:web` | Build Next.js production bundle |
| `npm run build` | Build both apps |
| `npm run typecheck:api` | `tsc --noEmit` in `apps/api` |
| `npm run typecheck:web` | `tsc --noEmit` in `apps/web` |
| `npm run lint` | ESLint all `apps/*/src` |
| `npm run format` | Prettier format all source files |

---

## Data Model (Summary)

| Table | Purpose |
|---|---|
| `teachers` | Teacher accounts |
| `rooms` | Classroom rooms with attendance config |
| `students` | Student accounts (magic-link auth) |
| `room_members` | Student ↔ Room membership + officer role |
| `attendance_sessions` | Active/ended attendance sessions |
| `attendance_records` | Individual scan / manual records |
| `refresh_tokens` | Long-lived tokens (teachers + students) |
| `background_reports` | Student background-abuse reports (Sub-Task 14) |

See [`apps/api/prisma/schema.prisma`](apps/api/prisma/schema.prisma) for the full schema.

---

## Docker (optional convenience)

```bash
# Start PostgreSQL + Redis
docker compose up -d
```

`docker-compose.yml` (create this if needed):

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: tangkayscan
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: password
    ports:
      - "5432:5432"

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
```

---

## Build Plan

See [`tangkayscan-plan.md`](tangkayscan-plan.md) for the full 15-sub-task MVP build plan.
