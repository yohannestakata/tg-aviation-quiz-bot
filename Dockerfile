FROM oven/bun:1.3.10-alpine AS base
WORKDIR /app

COPY package.json bun.lock tsconfig.base.json ./
COPY apps/backend/package.json apps/backend/package.json
COPY apps/telegram-bot/package.json apps/telegram-bot/package.json
COPY apps/admin-dashboard/package.json apps/admin-dashboard/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/types/package.json packages/types/package.json

RUN bun install --frozen-lockfile

COPY . .

RUN bun run typecheck

ENV NODE_ENV=production
EXPOSE 3000

CMD ["bun", "--filter", "@aviation/backend", "start"]
