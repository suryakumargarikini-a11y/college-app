'use strict';

const crypto = require('crypto');

// Use a fallback key for development/tests, but load from env in production
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'default_sitam_encryption_key_32bytes_!!'; // Must be 32 bytes
const IV_LENGTH = 16; // For AES, this is always 16

/**
 * Encrypt plain text using AES-256-CBC.
 *
 * @param {string} text
 * @returns {string} Encrypted text in the format iv:encryptedData
 */
function encrypt(text) {
    if (!text) return '';
    try {
        const iv = crypto.randomBytes(IV_LENGTH);
        const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY.padEnd(32).substring(0, 32)), iv);
        let encrypted = cipher.update(text);
        encrypted = Buffer.concat([encrypted, cipher.final()]);
        return iv.toString('hex') + ':' + encrypted.toString('hex');
    } catch (err) {
        return text; // Fallback
    }
}

/**
 * Decrypt text using AES-256-CBC.
 *
 * @param {string} textFormat - Encrypted text in the format iv:encryptedData
 * @returns {string} Decrypted plain text
 */
function decrypt(textFormat) {
    if (!textFormat) return '';
    try {
        const textParts = textFormat.split(':');
        if (textParts.length < 2) return textFormat; // Probably not encrypted
        const iv = Buffer.from(textParts.shift(), 'hex');
        const encryptedText = Buffer.from(textParts.join(':'), 'hex');
        const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY.padEnd(32).substring(0, 32)), iv);
        let decrypted = decipher.update(encryptedText);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        return decrypted.toString();
    } catch (err) {
        return textFormat; // Fallback
    }
}

module.exports = { encrypt, decrypt };
