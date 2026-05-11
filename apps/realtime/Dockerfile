FROM node:20-alpine AS base

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app

# Copy workspace config
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./
COPY apps/realtime/package.json ./apps/realtime/
COPY packages/db/package.json ./packages/db/
COPY packages/shared/package.json ./packages/shared/

# Install dependencies
RUN pnpm install --frozen-lockfile --filter realtime...

# Copy source
COPY packages/db ./packages/db
COPY packages/shared ./packages/shared
COPY apps/realtime ./apps/realtime
COPY tsconfig.base.json ./

# Build
RUN pnpm --filter realtime build

# Production stage
FROM node:20-alpine AS runner
WORKDIR /app

COPY --from=base /app/apps/realtime/dist ./dist
COPY --from=base /app/apps/realtime/package.json ./
COPY --from=base /app/node_modules ./node_modules

ENV NODE_ENV=production
ENV PORT=4000

EXPOSE 4000

CMD ["node", "dist/index.js"]
