'use strict';

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(process.env.ACHIEVEMENTS_STORAGE_PATH || path.join(__dirname, '..', 'uploads', 'achievements'));

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

function detectImageType(buffer, ext) {
    if (ext === '.png' && buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') return 'image/png';
    if (['.jpg', '.jpeg'].includes(ext) && buffer.subarray(0, 3).toString('hex') === 'ffd8ff') return 'image/jpeg';
    if (ext === '.gif' && buffer.subarray(0, 3).toString() === 'GIF') return 'image/gif';
    if (ext === '.webp' && buffer.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
    return null;
}

/**
 * Build the public-facing image URL for a saved achievement image.
 *
 * API_BASE_URL (Railway env var) looks like:
 *   https://web-production-259f33.up.railway.app/api
 *
 * The image endpoint is mounted at:
 *   /api/achievements/images/:fileName
 *
 * So the absolute URL is:
 *   https://web-production-259f33.up.railway.app/api/achievements/images/:fileName
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
    const ext = extension(originalName) || '.jpg';
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
    saveImage,
    resolve,
    remove
};
