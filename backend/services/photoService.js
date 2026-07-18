'use strict';

/**
 * SITAM Smart ERP — Student Photo Service
 *
 * Downloads the student photo from the live ERP URL (requires ERP cookies from an
 * active session), caches it locally in backend/uploads/photos/<userId>.jpg,
 * and exposes it through the backend's /api/profile/photo endpoint.
 *
 * The frontend NEVER references ERP image URLs directly.
 *
 * Re-download logic:
 *  - On first sync: always download if a photoUrl is present.
 *  - On subsequent syncs: skip download if the cached file exists AND the ERP URL
 *    has not changed (comparing against the stored photoUrl value).
 *  - Placeholder / empty photoUrl: leave existing cached file untouched.
 */

const fs      = require('fs');
const path    = require('path');
const https   = require('https');
const http    = require('http');
const logger  = require('./logger');

const PHOTO_DIR = path.join(__dirname, '..', 'uploads', 'photos');

// Ensure the uploads directory exists on startup
if (!fs.existsSync(PHOTO_DIR)) {
    fs.mkdirSync(PHOTO_DIR, { recursive: true });
    logger.info('[PhotoService] Created photo cache directory:', PHOTO_DIR);
}

/**
 * Returns the local disk path for a student's cached photo.
 * @param {string} userId
 * @returns {string}
 */
function localPhotoPath(userId) {
    // Sanitize userId — strip any characters that aren't safe in filenames
    const safe = userId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(PHOTO_DIR, `${safe}.jpg`);
}

/**
 * Returns the public URL path for a student's photo served through the backend.
 * @param {string} userId
 * @returns {string}
 */
function photoApiPath(userId) {
    return `/api/profile/photo/${encodeURIComponent(userId)}`;
}

/**
 * Download a file from url using the provided cookie string.
 * Follows up to 3 redirects.
 * @param {string} url
 * @param {string} cookieHeader  — value of the Cookie header from the ERP session
 * @param {string} destPath
 * @returns {Promise<void>}
 */
function downloadFile(url, cookieHeader, destPath, redirectsLeft = 3) {
    return new Promise((resolve, reject) => {
        const proto = url.startsWith('https') ? https : http;
        const req = proto.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                'Cookie': cookieHeader || '',
                'Referer': process.env.ERP_BASE_URL || 'https://sitamecap.co.in/SATYA/'
            }
        }, (res) => {
            // Follow redirects
            if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirectsLeft > 0) {
                const redirectUrl = res.headers.location.startsWith('http')
                    ? res.headers.location
                    : new URL(res.headers.location, url).href;
                res.resume();
                return downloadFile(redirectUrl, cookieHeader, destPath, redirectsLeft - 1)
                    .then(resolve).catch(reject);
            }

            if (res.statusCode !== 200) {
                res.resume();
                return reject(new Error(`HTTP ${res.statusCode} fetching photo from ${url}`));
            }

            const contentType = res.headers['content-type'] || '';
            if (!contentType.startsWith('image/')) {
                res.resume();
                return reject(new Error(`Non-image content-type "${contentType}" — likely a login redirect`));
            }

            const tmp = destPath + '.tmp';
            const out = fs.createWriteStream(tmp);
            res.pipe(out);
            out.on('finish', () => {
                out.close(() => {
                    fs.rename(tmp, destPath, (err) => {
                        if (err) reject(err); else resolve();
                    });
                });
            });
            out.on('error', (err) => {
                fs.unlink(tmp, () => {});
                reject(err);
            });
        });

        req.on('error', reject);
        req.setTimeout(15000, () => { req.destroy(new Error('Photo download timed out')); });
    });
}

/**
 * Attempt to download and cache the student's photo.
 *
 * @param {object} opts
 * @param {string} opts.userId         — student userId (used as filename)
 * @param {string} opts.erpPhotoUrl    — raw ERP photo URL (may require cookies)
 * @param {string} opts.cookieHeader   — ERP session cookies
 * @param {string} [opts.existingUrl]  — previously stored photoUrl (skip re-download if unchanged)
 * @returns {Promise<string|null>}     — local API path if cached, null otherwise
 */
async function cacheStudentPhoto({ userId, erpPhotoUrl, cookieHeader, existingUrl }) {
    if (!erpPhotoUrl || erpPhotoUrl.trim() === '') {
        logger.info(`[PhotoService] ${userId}: No ERP photo URL — skipping download`);
        // Return existing cached path if the file is still on disk
        const diskPath = localPhotoPath(userId);
        return fs.existsSync(diskPath) ? photoApiPath(userId) : null;
    }

    const diskPath = localPhotoPath(userId);
    const urlUnchanged = existingUrl && existingUrl === erpPhotoUrl;
    const fileExists   = fs.existsSync(diskPath);

    if (urlUnchanged && fileExists) {
        logger.info(`[PhotoService] ${userId}: Photo unchanged — using cached file`);
        return photoApiPath(userId);
    }

    try {
        logger.info(`[PhotoService] ${userId}: Downloading photo from ERP…`);
        await downloadFile(erpPhotoUrl, cookieHeader, diskPath);
        logger.info(`[PhotoService] ${userId}: Photo cached at ${diskPath}`);
        return photoApiPath(userId);
    } catch (err) {
        logger.warn(`[PhotoService] ${userId}: Photo download failed: ${err.message}`);
        // If an older cached version exists, keep using it
        if (fileExists) {
            logger.info(`[PhotoService] ${userId}: Serving stale cached photo`);
            return photoApiPath(userId);
        }
        return null;
    }
}

/**
 * Express middleware — serve a cached student photo.
 * Route: GET /api/profile/photo/:userId
 */
function servePhoto(req, res) {
    const { userId } = req.params;
    if (!userId) return res.status(400).json({ error: 'userId required' });

    const diskPath = localPhotoPath(userId);
    if (!fs.existsSync(diskPath)) {
        // Return 404 so the frontend can fall back to an initials avatar
        return res.status(404).json({ error: 'Photo not available' });
    }

    res.setHeader('Cache-Control', 'public, max-age=86400'); // 24 h browser cache
    res.setHeader('Content-Type', 'image/jpeg');
    fs.createReadStream(diskPath).pipe(res);
}

module.exports = { cacheStudentPhoto, servePhoto, localPhotoPath, photoApiPath };
