# ═══════════════════════════════════════════════════════════════════════════════
# SITAM Smart ERP — Hardened Multi-Stage Production Dockerfile
# Stage 1: Build  → Compiles dependencies & Prisma client in isolated environment
# Stage 2: Runtime → Minimal execution layer running as non-root 'node' user
# ═══════════════════════════════════════════════════════════════════════════════

# ─── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:20-slim AS builder

WORKDIR /build

# Copy package manifests and install ALL dependencies (including devDeps for Prisma)
COPY package*.json ./
RUN npm ci

# Copy Prisma schema and generate optimized client adapters
COPY prisma ./prisma
RUN npx prisma generate

# ─── Stage 2: Runtime ─────────────────────────────────────────────────────────
FROM node:20-slim AS runtime

# Install system-level Puppeteer/Chromium dependencies and hardened font packages
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
    libxss1 \
    libasound2 \
    libxtst6 \
    libxshmfence1 \
    chromium \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-freefont-ttf \
    && rm -rf /var/lib/apt/lists/*

# Configure Puppeteer to use system Chromium (skip bundled download)
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
# ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV NODE_ENV=production

# Create application directory with strict ownership
WORKDIR /usr/src/app

# Copy package manifests and install ONLY production dependencies
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy the compiled Prisma client from the builder stage
COPY --from=builder /build/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /build/node_modules/@prisma ./node_modules/@prisma

# Copy application source code
COPY . .

# ─── Security: Non-Root User Sandboxing ───────────────────────────────────────
# Switch ownership of the app directory to the built-in low-privilege 'node' user
RUN chown -R node:node /usr/src/app

# Drop to non-root 'node' user (UID 1000) to prevent host OS privilege escalation
USER node

# Expose API port
EXPOSE 8080

# Health check for container orchestration systems (Kubernetes, Railway, Fly.io)
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD wget -qO- http://localhost:${PORT:-8080}/api/health/liveness || exit 1

# Start the production API server
CMD ["node", "server.js"]
