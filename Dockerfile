# syntax=docker/dockerfile:1
ARG NODE_IMAGE=node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20
FROM ${NODE_IMAGE} AS package-manager
WORKDIR /app
RUN npm install --global pnpm@10.30.3

FROM package-manager AS workspace
COPY . .
RUN pnpm install --frozen-lockfile

FROM package-manager AS worker-bundle
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY apps/worker ./apps/worker
COPY packages ./packages
RUN pnpm install --prod --frozen-lockfile

FROM ${NODE_IMAGE} AS worker
RUN apt-get update && apt-get install --no-install-recommends -y ffmpeg ca-certificates fonts-dejavu-core && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production FFMPEG_PATH=/usr/bin/ffmpeg FFPROBE_PATH=/usr/bin/ffprobe WORKER_HEALTH_PORT=3190
WORKDIR /app
COPY --from=worker-bundle --chown=node:node /app ./
WORKDIR /app/apps/worker
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:3190/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--import", "tsx", "src/index.ts"]

FROM workspace AS web-build
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @contentos/web build

FROM ${NODE_IMAGE} AS web
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=web-build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=web-build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
