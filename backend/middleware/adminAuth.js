'use strict';

const crypto = require('crypto');
const prisma = require('../services/dbService');

// ── P0-3: Startup Guard — ADMIN_JWT_SECRET ────────────────────────────────────
const _ADMIN_JWT_KNOWN_DEFAULTS = new Set([
    'sitam-admin-secret-key-change-in-production',
    'sitam-admin-secret-key',
]);
const _rawAdminJwtSecret = process.env.ADMIN_JWT_SECRET;
if (!_rawAdminJwtSecret || _rawAdminJwtSecret.trim() === '') {
    console.error('[FATAL] ADMIN_JWT_SECRET environment variable is missing or empty. ' +
        'Set a strong unique secret in Railway → Variables before deploying. Server will not start.');
    throw new Error('ADMIN_JWT_SECRET must be configured before starting the server.');
}
if (_ADMIN_JWT_KNOWN_DEFAULTS.has(_rawAdminJwtSecret)) {
    console.error('[FATAL] ADMIN_JWT_SECRET is set to a known public default value. ' +
        'Replace it with a strong unique secret in Railway → Variables.');
    throw new Error('ADMIN_JWT_SECRET must not use a known default value.');
}
if (_rawAdminJwtSecret.length < 32) {
    console.error(`[FATAL] ADMIN_JWT_SECRET is too short (${_rawAdminJwtSecret.length} chars, minimum 32). ` +
        'Use a longer secret.');
    throw new Error('ADMIN_JWT_SECRET must be at least 32 characters long.');
}
const ADMIN_JWT_SECRET = _rawAdminJwtSecret;
// ─────────────────────────────────────────────────────────────────────────────

function base64urlEncode(str) {
    return Buffer.from(str).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64urlDecode(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    return Buffer.from(str, 'base64').toString();
}

function signToken(admin, expiresInHours = 8) {
    const payload = {
        id: admin.id,
        email: admin.email,
        role: admin.role,
        pwHash: admin.passwordHash ? admin.passwordHash.slice(0, 12) : (admin.pwHash || undefined)
    };
    const header = base64urlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    payload.exp = Math.floor(Date.now() / 1000) + (expiresInHours * 3600);
    payload.iat = Math.floor(Date.now() / 1000);
    const encodedPayload = base64urlEncode(JSON.stringify(payload));
    const signature = crypto
        .createHmac('sha256', ADMIN_JWT_SECRET)
        .update(`${header}.${encodedPayload}`)
        .digest('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
    return `${header}.${encodedPayload}.${signature}`;
}

function verifyToken(token) {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('Invalid token');
    const [header, payload, signature] = parts;
    const expectedSig = crypto
        .createHmac('sha256', ADMIN_JWT_SECRET)
        .update(`${header}.${payload}`)
        .digest('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
    if (signature !== expectedSig) throw new Error('Invalid signature');
    const decoded = JSON.parse(base64urlDecode(payload));
    if (decoded.exp < Math.floor(Date.now() / 1000)) throw new Error('Token expired');
    return decoded;
}

const adminAuth = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No token provided' });
    }
    const token = authHeader.split(' ')[1];
    try {
        const decoded = verifyToken(token);
        
        // Query current Admin record from DB
        const admin = await prisma.admin.findUnique({
            where: { id: decoded.id },
            select: { id: true, email: true, role: true, isActive: true, passwordHash: true }
        });
        
        // 1. Account Deactivation Check (Immediate Revocation)
        if (!admin || !admin.isActive) {
            return res.status(401).json({ error: 'Account disabled or session invalid' });
        }

        // 2. Password Reset Revocation Check (Immediate Revocation)
        if (decoded.pwHash && admin.passwordHash) {
            const currentHashPrefix = admin.passwordHash.slice(0, 12);
            if (decoded.pwHash !== currentHashPrefix) {
                return res.status(401).json({ error: 'Password was changed. Session invalidated. Please log in again.' });
            }
        }

        // 3. Current DB Role Authority (Role Change Takes Effect Immediately)
        req.admin = {
            id: admin.id,
            email: admin.email,
            role: admin.role // Always use current DB role, ignoring outdated token role claims
        };
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
};

const authorizeRoles = (...roles) => {
    return (req, res, next) => {
        if (!req.admin) {
            return res.status(401).json({ error: 'Unauthorized: Not authenticated' });
        }
        if (!roles.includes(req.admin.role)) {
            return res.status(403).json({ error: `Forbidden: Access restricted to roles [${roles.join(', ')}]` });
        }
        next();
    };
};

module.exports = { adminAuth, signToken, verifyToken, authorizeRoles };
