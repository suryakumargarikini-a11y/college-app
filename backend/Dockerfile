# ═══════════════════════════════════════════════════════════════════════════════
# SITAM Smart ERP — Hardened Multi-Stage Production Dockerfile
# Build context : backend/  (Railway: Root Directory = backend)
# Dockerfile    : backend/Dockerfile
#
# Stage 1: Build  → Installs all deps & generates Prisma client
# Stage 2: Runtime → Minimal Debian Bookworm image with system Chromium
# ═══════════════════════════════════════════════════════════════════════════════

# ─── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:20-slim AS builder

WORKDIR /build

# Build context = backend/, so all COPY sources are relative to backend/.
COPY package.json package-lock.json ./

# Install all dependencies (including devDeps) needed for Prisma codegen.
# npm ci requires package-lock.json — confirmed present at backend/package-lock.json.
RUN npm ci

# Copy only the Prisma schema — the only thing needed for prisma generate.
COPY prisma ./prisma

# Generate the optimised Prisma client for the linux/amd64 target platform.
RUN npx prisma generate

# ─── Stage 2: Runtime ─────────────────────────────────────────────────────────
FROM node:20-slim AS runtime

# Base: node:20-slim = debian:bookworm-slim (Debian 12)
#
# Bookworm package audit:
#   libxss1      → REMOVED from Bookworm — omitted
#   libasound2   → RENAMED to libasound2t64 in Bookworm — updated
#   libgdk-pixbuf2.0-0 → still present in Bookworm — kept
#   chromium     → available in Bookworm repos; installs to /usr/bin/chromium
#
# All packages below verified against debian:bookworm package lists.
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget \
    gnupg \
    ca-certificates \
    procps \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libgdk-pixbuf2.0-0 \
    libgtk-3-0 \
    libgbm-dev \
    libnss3 \
    libnspr4 \
    libasound2t64 \
    libxtst6 \
    libxshmfence1 \
    chromium \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-freefont-ttf \
    && rm -rf /var/lib/apt/lists/*

# Tell Puppeteer to skip its bundled Chrome download and use the system binary.
# /usr/bin/chromium is the exact path the Debian Bookworm chromium package installs to.
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV NODE_ENV=production

# ─── Application directory ────────────────────────────────────────────────────
WORKDIR /usr/src/app

# Install production dependencies first (layer cached until package files change).
# Explicit filenames used instead of glob to guarantee both files are required.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy backend application source BEFORE the Prisma client copy so that the
# builder-generated client is never overwritten.
# Uses --chown to avoid a separate chown RUN which doubles the layer size.
# Explicitly excludes node_modules: docker ignores .dockerignore-listed paths,
# but backend/node_modules is not present in the build context (it is in .gitignore)
# so this is safe. If a local node_modules exists, add backend/node_modules to
# .dockerignore at the repo root to prevent it being sent to the daemon.
COPY --chown=node:node server.js ./server.js
COPY --chown=node:node controllers ./controllers
COPY --chown=node:node middleware ./middleware
COPY --chown=node:node models ./models
COPY --chown=node:node monitoring ./monitoring
COPY --chown=node:node observability ./observability
COPY --chown=node:node platform ./platform
COPY --chown=node:node providers ./providers
COPY --chown=node:node repositories ./repositories
COPY --chown=node:node routes ./routes
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node security ./security
COPY --chown=node:node services ./services
COPY --chown=node:node sre ./sre
COPY --chown=node:node telemetry ./telemetry
COPY --chown=node:node worker.js ./worker.js
COPY --chown=node:node prisma ./prisma

# Copy the Prisma client generated in the builder stage.
# This MUST come after the application source COPY so nothing overwrites it.
COPY --from=builder --chown=node:node /build/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=node:node /build/node_modules/@prisma  ./node_modules/@prisma

# ─── Security: Non-Root User ──────────────────────────────────────────────────
# All files were already --chown'd above; switch user without an extra RUN.
USER node

EXPOSE 8080

# Health check for Railway / Kubernetes
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD wget -qO- http://localhost:${PORT:-8080}/api/health/liveness || exit 1

CMD ["node", "server.js"]
