'use strict';

/**
 * SITAM Smart ERP — PhotoPage
 *
 * Retrieves the student photo from the ERP and streams it directly to storage.
 * Returns only the saved photoUrl string — never keeps Base64 in memory.
 *
 * MEMORY RATIONALE:
 *   5000 students × ~50KB photo = ~250MB RAM if stored as Base64.
 *   PhotoPage avoids this entirely by piping the image response to disk/cloud
 *   and returning only the URL string.
 *
 * Returns:
 *   {
 *     photoUrl: string,     // local path or cloud URL of the saved photo
 *     mimeType: string,     // "image/jpeg" | "image/png"
 *     sizeBytes: number,
 *   }
 *
 * Throws on:
 *   - Photo URL not found on the profile page
 *   - HTTP fetch of photo fails
 *   - Storage write fails
 */

const { BasePage, PAGE_STATE } = require('./BasePage');
const path = require('path');
const fs   = require('fs');
const { Readable } = require('stream');

const PHOTO_DIR = process.env.STUDENT_PHOTO_DIR
    || path.resolve(process.cwd(), 'data', 'photos');

class PhotoPage extends BasePage {
    /**
     * @param {import('../../../services/browserPool/providers/adapters/IPageAdapter')} page
     * @param {string} requestId
     * @param {string} profileUrl  - URL of the profile page that contains the photo src
     * @param {string} userId      - Student userId (used as filename)
     * @param {string} siteBase    - ERP base URL for resolving relative photo src
     */
    constructor(page, requestId, profileUrl, userId, siteBase) {
        super(page, requestId);
        this._profileUrl = profileUrl;
        this._userId     = userId;
        this._siteBase   = siteBase;
    }

    async extract() {
        this._setState(PAGE_STATE.LOADING);

        // Navigate to profile page to locate the photo <img> src
        await this._page.goto(this._profileUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

        this._setState(PAGE_STATE.READY);
        this._setState(PAGE_STATE.SCRAPING);

        // Extract the photo src attribute
        const photoSrc = await this._page.evaluate(() => {
            const img = document.querySelector(
                'img[src*="Photo"], img[src*="photo"], img[id*="photo"], ' +
                'img[id*="Photo"], img[class*="profile"], img[class*="student"]'
            );
            return img ? img.getAttribute('src') : null;
        });

        if (!photoSrc) {
            // No photo on this ERP account — not a hard failure
            this._setState(PAGE_STATE.SUCCESS);
            return { photoUrl: null, mimeType: null, sizeBytes: 0 };
        }

        // Resolve relative URLs
        const absolutePhotoUrl = photoSrc.startsWith('http')
            ? photoSrc
            : `${this._siteBase}/${photoSrc.replace(/^\//, '')}`;

        // Get cookies from the page context to authenticate the photo request
        const cookies   = await this._page.cookies();
        const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');

        // Fetch the photo as a stream using native Node https/http
        const { photoUrl, mimeType, sizeBytes } = await this._streamPhotoToStorage(
            absolutePhotoUrl,
            cookieStr
        );

        this._setState(PAGE_STATE.SUCCESS);
        return { photoUrl, mimeType, sizeBytes };
    }

    /**
     * Download the photo and pipe it to disk. Returns the saved file path.
     * Never accumulates bytes in memory — uses Node stream pipeline.
     *
     * @private
     * @param {string} url
     * @param {string} cookieStr
     * @returns {Promise<{ photoUrl: string, mimeType: string, sizeBytes: number }>}
     */
    async _streamPhotoToStorage(url, cookieStr) {
        return new Promise((resolve, reject) => {
            const protocol = url.startsWith('https') ? require('https') : require('http');
            const safeId   = this._userId.replace(/[^a-zA-Z0-9_-]/g, '_');
            const fileName = `${safeId}.jpg`;
            const filePath = path.join(PHOTO_DIR, fileName);

            // Ensure photo directory exists
            try { fs.mkdirSync(PHOTO_DIR, { recursive: true }); } catch (_) {}

            const fileStream = fs.createWriteStream(filePath);
            let mimeType  = 'image/jpeg';
            let sizeBytes = 0;

            protocol.get(url, { headers: { Cookie: cookieStr } }, (res) => {
                mimeType = res.headers['content-type'] || 'image/jpeg';

                res.on('data', (chunk) => { sizeBytes += chunk.length; });
                res.pipe(fileStream);

                fileStream.on('finish', () => {
                    fileStream.close();
                    resolve({
                        photoUrl: `/data/photos/${fileName}`,   // relative serve path
                        mimeType,
                        sizeBytes,
                    });
                });

                fileStream.on('error', (err) => {
                    fs.unlink(filePath, () => {});  // clean up partial file
                    reject(err);
                });
            }).on('error', reject);
        });
    }
}

module.exports = PhotoPage;
