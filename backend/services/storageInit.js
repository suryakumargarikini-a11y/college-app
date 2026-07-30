'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const UPLOADS_BASE = path.resolve(process.env.UPLOADS_STORAGE_PATH || path.join(__dirname, '..', 'uploads'));

const DIRECTORIES = {
    base: UPLOADS_BASE,
    photos: path.join(UPLOADS_BASE, 'photos'),
    achievements: path.join(UPLOADS_BASE, 'achievements'),
    library: path.join(UPLOADS_BASE, 'library')
};

function initUploadDirectories() {
    console.log('[Startup] Initializing upload storage...');
    logger.info('[Startup] Initializing upload storage...', { basePath: UPLOADS_BASE });

    let allReady = true;

    for (const [key, dirPath] of Object.entries(DIRECTORIES)) {
        try {
            if (!fs.existsSync(dirPath)) {
                fs.mkdirSync(dirPath, { recursive: true });
                console.log(`[Startup] Created upload storage directory: ${key} (${dirPath})`);
                logger.info(`[Startup] Created upload storage directory: ${key}`, { dirPath });
            } else {
                console.log(`[Startup] Upload storage directory exists: ${key} (${dirPath})`);
            }

            // Verify write access
            const testFile = path.join(dirPath, `.write_test_${Date.now()}`);
            try {
                fs.writeFileSync(testFile, 'test');
                fs.unlinkSync(testFile);
            } catch (writeErr) {
                console.warn(`[Startup] WARNING: Storage directory ${key} is not writable by node process: ${writeErr.message}`);
                logger.warn(`[Startup] Storage directory ${key} non-writable`, { dirPath, error: writeErr.message });
                allReady = false;
            }
        } catch (err) {
            console.error(`[Startup] ERROR initializing storage directory ${key}: ${err.message}`);
            logger.error(`[Startup] Storage initialization error for ${key}`, { dirPath, error: err.message });
            allReady = false;
        }
    }

    if (allReady) {
        console.log('[Startup] Upload storage ready.');
        logger.info('[Startup] Upload storage ready.');
    } else {
        console.warn('[Startup] Upload storage initialized with warnings. Non-storage features continue operational.');
        logger.warn('[Startup] Upload storage initialized with warnings.');
    }

    return allReady;
}

module.exports = {
    initUploadDirectories,
    DIRECTORIES,
    UPLOADS_BASE
};
