'use strict';

/**
 * Chromium Executable Finder
 *
 * Searches for a usable Chromium/Chrome binary in the following order:
 *   1. Environment variables (provider-specific then generic)
 *   2. Windows auto-resolve (return undefined — let the provider find its bundled binary)
 *   3. Unix `which` discovery
 *   4. Hardcoded Unix fallback paths
 *
 * Returns undefined on Windows if no env path is set (Puppeteer/Playwright resolve their own cache).
 * Returns null on Linux if nothing is found (caller should warn and disable scraping).
 *
 * ENVIRONMENT VARIABLES (checked in order):
 *   PLAYWRIGHT_EXECUTABLE_PATH  — explicit path for Playwright (recommended for Render)
 *   PUPPETEER_EXECUTABLE_PATH   — explicit path for Puppeteer (legacy support)
 *   CHROME_BIN                  — generic Chrome binary path
 *   CHROMIUM_PATH               — generic Chromium binary path
 */

const fs = require('fs');
const logger = require('../logger');

/**
 * @returns {string|undefined|null}
 *   string    — verified absolute path to Chromium binary
 *   undefined — on Windows, let the provider auto-resolve from its cache
 *   null      — on Linux, no binary found (scraping disabled)
 */
function findChromiumExecutable() {
    // ── 1. Honour explicit environment overrides ────────────────────────────
    // PLAYWRIGHT_EXECUTABLE_PATH is checked first — during Playwright migration this
    // avoids any accidental fallback to a Puppeteer-cached binary.
    const envPaths = [
        process.env.PLAYWRIGHT_EXECUTABLE_PATH,
        process.env.PUPPETEER_EXECUTABLE_PATH,
        process.env.CHROME_BIN,
        process.env.CHROMIUM_PATH,
    ].filter(Boolean);

    for (const envPath of envPaths) {
        if (fs.existsSync(envPath)) {
            logger.info(`[Browser] Environment path verified: ${envPath}`);
            return envPath;
        }
        logger.warn(`[Browser] Environment path ignored (not on disk): ${envPath}`);
    }

    // ── 2. Windows — provider bundles its own Chromium ─────────────────────
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
                logger.info(`[Browser] Discovered via 'which ${cmd}': ${found}`);
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
            logger.info(`[Browser] Discovered via fallback path: ${fb}`);
            return fb;
        }
    }

    logger.error('[Browser] No Chromium executable found on this system.');
    return null;
}

module.exports = { findChromiumExecutable };
