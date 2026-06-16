# ═══════════════════════════════════════════════════════════════════════════════
# SITAM Smart ERP — Hardened Multi-Stage Production Dockerfile
# Build context : repository root  (Railway: Root Directory = /)
# Dockerfile    : backend/Dockerfile
#
# Stage 1: Build  → Installs all deps & generates Prisma client
# Stage 2: Runtime → Minimal Debian Bookworm image with system Chromium
# ═══════════════════════════════════════════════════════════════════════════════

# ─── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:20-slim AS builder

WORKDIR /build

# Build context = repo root — all COPY sources must be prefixed with backend/
COPY backend/package.json backend/package-lock.json ./

# Install all dependencies (including devDeps) needed for Prisma codegen
RUN npm ci

# Copy only the Prisma schema — the only file needed for prisma generate
COPY backend/prisma ./prisma

# Generate the Prisma client for the linux/amd64 target platform
RUN npx prisma generate

# ─── Stage 2: Runtime ─────────────────────────────────────────────────────────
FROM node:20-slim AS runtime

# Base: node:20-slim = debian:bookworm-slim (Debian 12)
#
# Package audit for Debian Bookworm:
#   libasound2t64  → DOES NOT EXIST in Bookworm (t64 transition is Trixie/13+)
#                    correct Bookworm name: libasound2
#   libgbm-dev     → dev/headers package; runtime needs libgbm1 not libgbm-dev
#   libxss1        → removed from Bookworm; omitted
#   libgtk-3-0     → correct in Bookworm (t64 suffix is Trixie only)
#   fonts-kacst    → replaced by fonts-kacst-one in Bookworm
#   chromium       → available in Bookworm; installs binary to /usr/bin/chromium
#
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

# Tell Puppeteer to use the system Chromium — never download a bundled one.
# The Debian Bookworm chromium package places the binary at /usr/bin/chromium.
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV NODE_ENV=production

# ─── Application directory ────────────────────────────────────────────────────
WORKDIR /usr/src/app

# Install production dependencies (layer is cached until package files change)
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy backend application source files (explicit dirs — never copies node_modules)
COPY --chown=node:node backend/server.js          ./server.js
COPY --chown=node:node backend/worker.js          ./worker.js
COPY --chown=node:node backend/controllers        ./controllers
COPY --chown=node:node backend/middleware         ./middleware
COPY --chown=node:node backend/models             ./models
COPY --chown=node:node backend/monitoring         ./monitoring
COPY --chown=node:node backend/observability      ./observability
COPY --chown=node:node backend/platform           ./platform
COPY --chown=node:node backend/providers          ./providers
COPY --chown=node:node backend/repositories       ./repositories
COPY --chown=node:node backend/routes             ./routes
COPY --chown=node:node backend/scripts            ./scripts
COPY --chown=node:node backend/security           ./security
COPY --chown=node:node backend/services           ./services
COPY --chown=node:node backend/sre                ./sre
COPY --chown=node:node backend/telemetry          ./telemetry
# Copy the Prisma schema and generated client from the builder stage.
# Using --from=builder avoids any build-context path resolution issues
# that occur when Dockerfile is at a non-root path (backend/Dockerfile).
COPY --from=builder --chown=node:node /build/prisma             ./prisma
COPY --from=builder --chown=node:node /build/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=node:node /build/node_modules/@prisma  ./node_modules/@prisma

# ─── Security: Non-Root User ──────────────────────────────────────────────────
USER node

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD wget -qO- http://localhost:${PORT:-8080}/api/health/liveness || exit 1

CMD ["node", "server.js"]
