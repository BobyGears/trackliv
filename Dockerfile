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
ARG VITE_BASEMAP_URL=
ENV VITE_BASEMAP_URL=${VITE_BASEMAP_URL}
# A failing unit test or type error aborts the build – the running version keeps running.
RUN npm test && npm run typecheck && npm run build

# ---- runtime: production dependencies + server source + built web app ----------------------
# Debian (not Alpine): the FleetGO dashboard connection runs a headless Chromium, which needs glibc.
FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production TZ=Europe/Berlin PORT=8787 TRACKLIV_DATA_DIR=/data PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev --no-audit --no-fund -w @trackliv/server -w @trackliv/core && npm cache clean --force
# Headless Chromium + its system libraries (only started when FleetGO dashboard credentials are set)
RUN npx playwright-core install --with-deps --only-shell chromium && rm -rf /var/lib/apt/lists/* /root/.cache
COPY packages/core/src packages/core/src
COPY apps/server/src apps/server/src
COPY data/geo data/geo
COPY --from=build /app/apps/web/dist apps/web/dist
EXPOSE 8787
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8787/api/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "--import", "tsx", "apps/server/src/index.ts"]
