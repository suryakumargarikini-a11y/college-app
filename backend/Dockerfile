# ═══════════════════════════════════════════════════════════════════════════════
# SITAM Smart ERP — Hardened Multi-Stage Production Dockerfile
# Build context : repository root  (Railway: Root Directory = /)
# Dockerfile    : backend/Dockerfile
#
# Stage 1: Build  → Installs all deps & generates Prisma client
# Stage 2: Runtime → Minimal Debian Bookworm image with system Chromium
# ═══════════════════════════════════════════════════════════════════════════════

# Cache-busting build argument — increment to force all layers to rebuild.
# Current value: 5
ARG CACHEBUST=5

# ─── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:20-slim AS builder

ARG CACHEBUST
RUN echo "CACHEBUST=$CACHEBUST"

WORKDIR /build

COPY backend/package.json backend/package-lock.json ./
RUN npm ci

COPY backend/prisma ./prisma
RUN npx prisma generate

# ─── Stage 2: Runtime ─────────────────────────────────────────────────────────
FROM node:20-slim AS runtime

ARG CACHEBUST
RUN echo "CACHEBUST=$CACHEBUST"

# node:20-slim = debian:bookworm-slim (Debian 12)
# All packages verified against Debian Bookworm repos.
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget \
    ca-certificates \
    chromium \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnss3 \
    libnspr4 \
    libasound2 \
    libxtst6 \
    libxshmfence1 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    fonts-liberation \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst-one \
    fonts-freefont-ttf \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV NODE_ENV=production

WORKDIR /usr/src/app

# Install production dependencies first
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ONE single COPY for all backend source — no parallelism, no race conditions.
# backend/node_modules is gitignored so it is never in the build context.
# This replaces 17 individual COPY instructions that were failing
# non-deterministically due to Railway BuildKit parallel execution.
COPY --chown=node:node backend/ .

# Copy the generated Prisma client from the builder stage.
# Comes AFTER the source COPY so it is never overwritten.
COPY --from=builder --chown=node:node /build/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=node:node /build/node_modules/@prisma  ./node_modules/@prisma

USER node

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD wget -qO- http://localhost:${PORT:-8080}/api/health/liveness || exit 1

CMD ["node", "server.js"]
