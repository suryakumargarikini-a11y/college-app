'use strict';

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

// ── Storage Root Resolution ─────────────────────────────────────────────────
// Priority order:
//   1. ACHIEVEMENTS_STORAGE_PATH env var (explicit Railway Volume mount point)
//   2. /data/uploads/achievements  — recommended Railway Volume mount path
//   3. backend/uploads/achievements — LOCAL DEV ONLY (ephemeral on Railway!)
//
// ACTION REQUIRED FOR RAILWAY:
//   1. Create a Railway Volume in the Railway dashboard.
//   2. Set the Volume mount path to: /data/uploads/achievements
//   3. Set env var: ACHIEVEMENTS_STORAGE_PATH=/data/uploads/achievements
//   Without this, images are LOST on every deploy.
const isProduction = process.env.NODE_ENV === 'production';
const DEFAULT_PROD_PATH = '/data/uploads/achievements';
const DEFAULT_DEV_PATH = path.join(__dirname, '..', 'uploads', 'achievements');

const ROOT = path.resolve(
    process.env.ACHIEVEMENTS_STORAGE_PATH ||
    (isProduction ? DEFAULT_PROD_PATH : DEFAULT_DEV_PATH)
);

if (isProduction && !process.env.ACHIEVEMENTS_STORAGE_PATH) {
    console.error(
        '[ImageStorage] WARNING: ACHIEVEMENTS_STORAGE_PATH is not set in production!\n' +
        '  Images will be stored at ' + ROOT + ' which is EPHEMERAL on Railway.\n' +
        '  ACTION: Create a Railway Volume mounted at /data/uploads/achievements\n' +
        '  and set ACHIEVEMENTS_STORAGE_PATH=/data/uploads/achievements in Railway Variables.'
    );
}


async function ensureRoot() {
    try {
        await fs.mkdir(ROOT, { recursive: true });
    } catch (err) {
        console.warn(`[ImageStorage] Directory creation warning for ${ROOT}: ${err.message}`);
    }
}

function safeName(name) {
    return path.basename(String(name || '')).replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 180);
}

function extension(name) {
    return path.extname(name).toLowerCase();
}

/**
 * Detect image MIME type from magic bytes alone.
 * The file extension is intentionally ignored — Android and other clients
 * frequently upload JPEG images with a .png extension (or vice versa).
 * Validating extension vs. magic bytes causes false 400 errors on valid images.
 *
 * Returns the detected MIME string, or null if the buffer is not a supported image.
 */
function detectImageType(buffer) {
    if (!buffer || buffer.length < 3) return null;
    if (buffer.length >= 8 && buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') return 'image/png';
    if (buffer.subarray(0, 3).toString('hex') === 'ffd8ff') return 'image/jpeg';
    if (buffer.subarray(0, 3).toString() === 'GIF') return 'image/gif';
    if (buffer.length >= 12 && buffer.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
    return null;
}

/**
 * Returns the canonical file extension for a detected MIME type.
 * Used when the original filename extension may not match the actual image format.
 */
function extFromMime(mime) {
    const map = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp' };
    return map[mime] || '.jpg';
}

/**
 * Build the public-facing image URL for a saved achievement image.
 *
 * API_BASE_URL (Railway env var) should be set to:
 *   https://api.sitam.co.in/api
 *
 * The image endpoint is mounted at:
 *   /api/achievements/images/:fileName
 *
 * So the absolute URL is:
 *   https://api.sitam.co.in/api/achievements/images/:fileName
 *
 * We strip the trailing /api from API_BASE_URL only if it ends with /api, to get
 * the bare origin, then append /api/achievements/images/:fileName.
 * If API_BASE_URL is not set, fall back to a relative URL (works when frontend
 * and backend share the same origin — not the case in production).
 */
function buildImageUrl(fileName) {
    const relativePath = `/api/achievements/images/${fileName}`;
    const apiBase = (process.env.API_BASE_URL || '').trim().replace(/\/+$/, '');
    if (!apiBase) return relativePath;
    // Strip /api suffix to get bare origin, then build the full path
    const origin = apiBase.endsWith('/api') ? apiBase.slice(0, -4) : apiBase;
    return `${origin}${relativePath}`;
}

async function saveImage(buffer, originalName) {
    await ensureRoot();
    // Derive the extension from the actual magic bytes, not the original filename.
    // This handles Android files saved as .png that are actually JPEG, etc.
    const detectedMime = detectImageType(buffer);
    const ext = detectedMime ? extFromMime(detectedMime) : (extension(originalName) || '.jpg');
    const fileName = `${crypto.randomUUID()}${ext}`;
    const filePath = path.join(ROOT, fileName);
    await fs.writeFile(filePath, buffer, { flag: 'wx' });
    return {
        fileName,
        imageUrl: buildImageUrl(fileName)
    };
}

function resolve(fileName) {
    const candidate = path.resolve(ROOT, fileName);
    if (!candidate.startsWith(ROOT + path.sep)) {
        throw new Error('Invalid image storage path traversal attempt');
    }
    return candidate;
}

async function remove(fileName) {
    try {
        if (!fileName) return;
        const cleanName = path.basename(fileName);
        await fs.unlink(resolve(cleanName));
    } catch (e) {
        if (e.code !== 'ENOENT') throw e;
    }
}

module.exports = {
    safeName,
    extension,
    detectImageType,
    extFromMime,
    saveImage,
    resolve,
    remove
};
