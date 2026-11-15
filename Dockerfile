# One container: API under /api + the built web app at /.
# Node 26 runs the TypeScript sources directly (type stripping) and ships node:sqlite.

FROM node:26-slim AS build
WORKDIR /app

COPY backend/package.json backend/package-lock.json backend/
RUN cd backend && npm ci
COPY web/package.json web/package-lock.json web/
RUN cd web && npm ci

COPY backend backend
COPY web web
RUN cd web && npm run build \
 && cd ../backend && npm run build:sdk \
 && npm prune --omit=dev

FROM node:26-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/backend /app/backend
COPY --from=build /app/web/dist /app/web/dist

# SQLite lives on a Railway volume mounted at /data (see DEPLOY.md).
ENV DB_PATH=/data/blockotc.db \
    WEB_DIST=/app/web/dist

WORKDIR /app/backend
# Runs as root on purpose: Railway mounts volumes owned by root, so a non-root user
# couldn't write the SQLite file at /data.
CMD ["node", "src/server.ts"]
