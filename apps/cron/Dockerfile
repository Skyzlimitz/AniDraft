FROM node:20-alpine AS base

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./
COPY apps/cron/package.json ./apps/cron/
COPY packages/db/package.json ./packages/db/
COPY packages/scoring/package.json ./packages/scoring/
COPY packages/anilist/package.json ./packages/anilist/
COPY packages/shared/package.json ./packages/shared/

RUN pnpm install --frozen-lockfile --filter cron...

COPY packages/ ./packages/
COPY apps/cron ./apps/cron
COPY tsconfig.base.json ./

RUN pnpm --filter cron build

FROM node:20-alpine AS runner
WORKDIR /app

COPY --from=base /app/apps/cron/dist ./dist
COPY --from=base /app/apps/cron/package.json ./
COPY --from=base /app/node_modules ./node_modules

ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
