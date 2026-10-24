# Veneer in a container. See deploy/README.md ("Docker").
#
#   docker build -t veneer .
#   docker run -p 8080:8080 -e VENEER_HOST=myibmi.example.com -v veneer-screens:/data/screens veneer

# ---- build: compile everything, then stage the release with production dependencies only
FROM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
COPY packages/tn5250/package.json packages/tn5250/
COPY packages/screens/package.json packages/screens/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN npm ci --no-audit --no-fund
COPY . .
RUN node scripts/package.mjs --no-archive \
 && mv "$(find release -mindepth 1 -maxdepth 1 -type d)" /app

# ---- runtime: Node.js and the staged release; no compiler, no dev dependencies
FROM node:22-alpine
ENV NODE_ENV=production \
    VENEER_LISTEN_HOST=0.0.0.0 \
    VENEER_LISTEN_PORT=8080 \
    VENEER_SCREENS_DIR=/data/screens \
    VENEER_DATA_DIR=/data/state
WORKDIR /app
# The program stays owned by root, so the service user can't change it.
COPY --from=build /app /app
RUN mkdir -p /data/screens /data/state && chown node:node /data/screens /data/state
USER node
VOLUME ["/data/screens", "/data/state"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD ["node", "deploy/docker/healthcheck.mjs"]
# Veneer ends its 5250 sessions on SIGTERM (releasing their devices) within 10 seconds.
STOPSIGNAL SIGTERM
CMD ["node", "packages/server/dist/main.js"]
