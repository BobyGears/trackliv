# TrackLiv — one container: API + built web app.
# Built on the server by ./deploy.sh (docker compose -f deploy/docker-compose.yml up -d --build).

# ---- build: install everything, run the checks, build the web app -------------------------
FROM node:24-alpine AS build
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 CI=1
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund
COPY . .
ARG VITE_STREET_TILES=
ENV VITE_STREET_TILES=${VITE_STREET_TILES}
# A failing unit test or type error aborts the build – the running version keeps running.
RUN npm test && npm run typecheck && npm run build

# ---- runtime: production dependencies + server source + built web app ----------------------
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production TZ=Europe/Berlin PORT=8787 TRACKLIV_DATA_DIR=/data
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev --no-audit --no-fund -w @trackliv/server -w @trackliv/core && npm cache clean --force
COPY packages/core/src packages/core/src
COPY apps/server/src apps/server/src
COPY data/geo data/geo
COPY --from=build /app/apps/web/dist apps/web/dist
EXPOSE 8787
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8787/api/health >/dev/null || exit 1
CMD ["node", "--import", "tsx", "apps/server/src/index.ts"]
