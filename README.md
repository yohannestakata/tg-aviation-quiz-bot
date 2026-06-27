# Aviation Quiz Monorepo

Bun workspace for an aviation quiz platform:

- `apps/backend` - Express API, Telegram webhook, admin endpoints, Cloudinary upload endpoint.
- `apps/telegram-bot` - grammY bot implementation and quiz flow.
- `apps/admin-dashboard` - placeholder package for the future admin dashboard.
- `packages/db` - Drizzle schema, database client, repositories, and seed script.

## Quick Start

```bash
bun install
cp .env.example .env
bun db:push
bun db:seed
bun dev
```

For local polling without Telegram webhooks:

```bash
bun dev:bot
```

The backend serves:

- `GET /health`
- `POST /telegram/webhook/:secret`
- `POST /api/admin/auth/login`
- `GET /api/admin/auth/me`
- `GET/POST/PATCH/DELETE /api/admin/categories`
- `GET/POST/PATCH/DELETE /api/admin/questions`
- `POST /api/admin/uploads/question-image`
- `GET /api/admin/analytics/overview`

## Deployment Path

The backend and bot run together. In production, Telegram sends updates to the backend webhook endpoint, and the backend passes those updates to the grammY bot.

Recommended free path:

- Backend/webhook: Render Free Web Service.
- Database: Neon Free Postgres.
- CI/CD: GitHub Actions validates every push; Render deploy is triggered by a deploy hook after `main` passes.
- Images: Cloudinary free tier when you start using question images.

Render free web services spin down after idle time, so the first Telegram message after inactivity can be delayed while the service wakes up. That is fine for an early/free launch, but upgrade the backend service once real users depend on fast responses.

### 1. Configure Environment

Create `.env` from `.env.example` and fill these values:

```bash
DATABASE_URL=postgres://...
TELEGRAM_BOT_TOKEN=...
TELEGRAM_WEBHOOK_SECRET=long-random-path-secret
TELEGRAM_WEBHOOK_SECRET_TOKEN=optional-long-random-header-secret
JWT_SECRET=long-random-jwt-secret
PUBLIC_BACKEND_URL=https://your-backend.example.com
ADMIN_FRONTEND_URL=https://your-future-admin.example.com
SEED_ADMIN_EMAIL=you@example.com
SEED_ADMIN_PASSWORD=temporary-strong-password
```

For local Docker Compose, this repo includes Postgres and the backend:

```bash
docker compose up -d postgres
bun install
bun db:push
bun db:seed
docker compose up -d backend
```

For hosted deployment, provision Postgres first, set the environment variables on the backend service, then run:

```bash
bun db:migrate
bun db:seed
bun --filter @aviation/backend start
```

### Free Hosted Setup: Neon + Render

1. Create a Neon project and copy the pooled Postgres connection string.
2. Create a Render Web Service from this repo.
3. Pick Docker runtime or use the included `render.yaml` blueprint.
4. Set these Render environment variables:

```bash
DATABASE_URL=your-neon-pooled-connection-string
TELEGRAM_BOT_TOKEN=from-botfather
TELEGRAM_WEBHOOK_SECRET=long-random-url-secret
TELEGRAM_WEBHOOK_SECRET_TOKEN=optional-long-random-header-secret
JWT_SECRET=long-random-jwt-secret-at-least-16-chars
PUBLIC_BACKEND_URL=https://your-render-service.onrender.com
ADMIN_FRONTEND_URL=http://localhost:5173
SEED_ADMIN_EMAIL=you@example.com
SEED_ADMIN_PASSWORD=temporary-strong-password
```

5. In Render, create a Deploy Hook URL.
6. In GitHub repo settings, add secret `RENDER_DEPLOY_HOOK_URL` with that URL.
7. Push to `main`; GitHub Actions validates and triggers Render.
8. Run migrations from your machine against Neon:

```bash
bun db:migrate
bun db:seed
```

9. Set Telegram webhook:

```bash
bun telegram:set-webhook
```

The workflows live in `.github/workflows`: `ci.yml` runs typecheck/build/migration drift checks, and `deploy-render.yml` triggers Render through the deploy hook.

### 2. Connect Telegram

After the backend is reachable over HTTPS:

```bash
bun telegram:set-webhook
```

Telegram will call:

```txt
POST /telegram/webhook/:TELEGRAM_WEBHOOK_SECRET
```

### 3. Add Questions with Bruno

Open the collection at:

```txt
bruno/aviation-quiz-api
```

Recommended flow:

1. Select `Local` or `Production` environment.
2. Run `Health`.
3. Set `adminEmail` and `adminPassword`.
4. Run `Auth/Login`; it stores `token` in the active Bruno environment.
5. Run `Categories/Create Category`; it stores `categoryId`.
6. Run `Questions/Create Multiple Choice Question` or `Questions/Create Short Answer Question`.

Every question can include an image or omit it. Leave `imageUrl` and `cloudinaryPublicId` as `null` for text-only questions. For image questions, upload the image through `Uploads/Upload Question Image`, then paste the returned `imageUrl` and `publicId` into any create/update question request.
# tg-aviation-quiz-bot
