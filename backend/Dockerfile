# ═══════════════════════════════════════════════════════════════════════════════
# SITAM Smart ERP — Production Dockerfile
# Dockerfile path  : /backend/Dockerfile
# Build context    : backend/  ← Railway uses the Dockerfile's directory
#
# All COPY source paths are relative to backend/ — NOT the repo root.
# Using backend/X would look for backend/backend/X and fail.
# ═══════════════════════════════════════════════════════════════════════════════

# ─── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:20-slim AS builder

WORKDIR /build

# Paths relative to backend/ (the build context root)
COPY package.json package-lock.json ./
RUN npm ci

COPY prisma ./prisma
# Use the PostgreSQL schema in production — overwrite the SQLite default
# so that npx prisma generate produces a PostgreSQL client.
RUN cp prisma/schema.postgresql.prisma prisma/schema.prisma
RUN npx prisma generate

# ─── Stage 2: Runtime ─────────────────────────────────────────────────────────
FROM node:20-slim AS runtime

# node:20-slim = debian:bookworm-slim (Debian 12)
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

# Install production deps (path relative to backend/)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy ALL backend source in one atomic COPY.
# Build context = backend/, so "." is the backend/ directory.
# backend/node_modules is gitignored — Railway clones from git so it
# will never be present in the build context.
COPY --chown=node:node . .

# Overlay the generated Prisma client from the builder stage.
# Must come AFTER the source COPY so nothing overwrites it.
COPY --from=builder --chown=node:node /build/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=node:node /build/node_modules/@prisma  ./node_modules/@prisma

# Overwrite the SQLite schema.prisma (brought in by COPY . .) with the
# PostgreSQL schema from the builder stage so that `prisma db push` at
# container startup targets the Railway PostgreSQL plugin, not an ephemeral
# in-container SQLite file that disappears on every redeploy.
COPY --from=builder --chown=node:node /build/prisma/schema.prisma ./prisma/schema.prisma

# Create the logs directory and give the node user full ownership of /usr/src/app
# before dropping privileges. winston-daily-rotate-file needs to mkdir logs/ at startup.
RUN mkdir -p /usr/src/app/logs && chown -R node:node /usr/src/app

USER node

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD wget -qO- http://localhost:${PORT:-8080}/api/health/liveness || exit 1

CMD ["node", "server.js"]
