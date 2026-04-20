# syntax=docker/dockerfile:1.4
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate

# ---- deps ----
FROM base AS deps
WORKDIR /app
COPY package.json ./
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --no-frozen-lockfile --prod

# ---- build ----
FROM base AS build
WORKDIR /app
COPY package.json tsconfig.json ./
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --no-frozen-lockfile
COPY src/ ./src/
COPY web/static/ ./web/static/
RUN pnpm tsc

# ---- runner ----
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/web/static ./web/static

CMD ["node", "dist/index.js"]
