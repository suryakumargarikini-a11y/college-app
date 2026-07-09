'use strict';

/**
 * Chromium Executable Finder
 *
 * Searches for a usable Chromium/Chrome binary in the following order:
 *   1. Environment variables (PUPPETEER_EXECUTABLE_PATH, CHROME_BIN, CHROMIUM_PATH)
 *   2. Windows auto-resolve (return undefined — Puppeteer finds its bundled binary)
 *   3. Unix `which` discovery
 *   4. Hardcoded Unix fallback paths
 *
 * Returns undefined on Windows if no env path is set (Puppeteer resolves its own cache).
 * Returns null on Linux if nothing is found (caller should warn and disable scraping).
 */

const fs = require('fs');
const logger = require('../logger');

/**
 * @returns {string|undefined|null}
 *   string  — verified absolute path to Chromium binary
 *   undefined — on Windows, let Puppeteer auto-resolve from its cache
 *   null    — on Linux, no binary found (scraping disabled)
 */
function findChromiumExecutable() {
    // ── 1. Honour explicit environment overrides ────────────────────────────
    const envPaths = [
        process.env.PUPPETEER_EXECUTABLE_PATH,
        process.env.CHROME_BIN,
        process.env.CHROMIUM_PATH,
    ].filter(Boolean);

    for (const envPath of envPaths) {
        if (fs.existsSync(envPath)) {
            logger.info(`[Puppeteer] Environment path verified: ${envPath}`);
            return envPath;
        }
        logger.warn(`[Puppeteer] Environment path ignored (not on disk): ${envPath}`);
    }

    // ── 2. Windows — Puppeteer bundles its own Chromium ─────────────────────
    if (process.platform === 'win32') {
        return undefined;
    }

    // ── 3. Unix shell discovery ──────────────────────────────────────────────
    const { execSync } = require('child_process');
    const candidates = ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable'];

    for (const cmd of candidates) {
        try {
            const found = execSync(`which ${cmd} 2>/dev/null`, { stdio: 'pipe' })
                .toString()
                .trim();
            if (found && fs.existsSync(found)) {
                logger.info(`[Puppeteer] Discovered via 'which ${cmd}': ${found}`);
                return found;
            }
        } catch (_) {
            // not in PATH — try next
        }
    }

    // ── 4. Hardcoded Unix fallback paths ─────────────────────────────────────
    const fallbacks = [
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/local/bin/chromium',
    ];

    for (const fb of fallbacks) {
        if (fs.existsSync(fb)) {
            logger.info(`[Puppeteer] Discovered via fallback path: ${fb}`);
            return fb;
        }
    }

    logger.error('[Puppeteer] No Chromium executable found on this system.');
    return null;
}

module.exports = { findChromiumExecutable };
