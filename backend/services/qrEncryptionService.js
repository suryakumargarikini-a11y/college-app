'use strict';

const crypto = require('crypto');
const logger = require('./logger');

// Retrieve key(s) from environment.
// Can be a raw string or a JSON object mapping version to 32-byte key.
const getKeys = () => {
    const envKey = process.env.EXIT_PASS_QR_ENCRYPTION_KEY || 'default_exit_pass_qr_key_32bytes!!';
    try {
        const parsed = JSON.parse(envKey);
        if (typeof parsed === 'object' && parsed !== null) {
            return parsed;
        }
    } catch (e) {
        // Treat as raw string
    }
    return { "1": envKey };
};

const getActiveVersion = (keys) => {
    const versions = Object.keys(keys).map(v => parseInt(v, 10)).filter(v => !isNaN(v));
    if (versions.length === 0) return "1";
    return Math.max(...versions).toString();
};

const getDerivedKey = (rawKey) => {
    // Ensure the key is exactly 32 bytes by hashing it
    return crypto.createHash('sha256').update(rawKey).digest();
};

/**
 * Encrypts a string using AES-256-GCM.
 * Output format: version:iv_hex:auth_tag_hex:ciphertext_hex
 */
function encrypt(text) {
    if (!text) return '';
    try {
        const keys = getKeys();
        const activeVersion = getActiveVersion(keys);
        const rawKey = keys[activeVersion];
        const key = getDerivedKey(rawKey);

        const iv = crypto.randomBytes(12); // Standard 12 bytes IV for GCM
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        const authTag = cipher.getAuthTag().toString('hex');

        return `${activeVersion}:${iv.toString('hex')}:${authTag}:${encrypted}`;
    } catch (err) {
        logger.error('[QrEncryption] Encryption error:', err);
        throw new Error('QR encryption failed');
    }
}

/**
 * Decrypts a formatted string using AES-256-GCM.
 */
function decrypt(encryptedText) {
    if (!encryptedText) return '';
    try {
        const parts = encryptedText.split(':');
        if (parts.length !== 4) {
            throw new Error('Invalid encrypted format');
        }

        const [version, ivHex, authTagHex, encryptedHex] = parts;
        const keys = getKeys();
        const rawKey = keys[version];
        if (!rawKey) {
            throw new Error(`Encryption key version ${version} not found`);
        }
        const key = getDerivedKey(rawKey);

        const iv = Buffer.from(ivHex, 'hex');
        const authTag = Buffer.from(authTagHex, 'hex');
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(authTag);

        let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (err) {
        logger.error('[QrEncryption] Decryption error:', err);
        throw new Error('QR decryption failed');
    }
}

module.exports = { encrypt, decrypt };
