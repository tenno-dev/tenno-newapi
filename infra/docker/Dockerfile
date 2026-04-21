# syntax=docker/dockerfile:1.4
FROM oven/bun:1.2-alpine AS runner
WORKDIR /app
ENV APP_ENV=production

COPY package.json bun.lockb* ./
RUN bun install --production

COPY src/ ./src/
COPY web/static/ ./web/static/

CMD ["bun", "src/index.ts"]
