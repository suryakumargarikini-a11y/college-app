/**
 * SITAM Smart ERP — Zero-Trust Security Service
 *
 * Implements:
 *   1. SSRF Mitigation wrapper for Puppeteer & Axios requests.
 *   2. Token Blacklist / Revocation list (JWT rotation support).
 *   3. SRE Control-Plane RBAC authorization.
 */

const dns = require('dns').promises;
const logger = require('./logger');

// Local in-memory JWT blacklist if Redis is down
const localTokenBlacklist = new Set();

class SecurityService {
    /**
     * Prevents Server-Side Request Forgery (SSRF) by validating URLs
     * and blocking private IP networks (localhost, link-local, AWS metadata).
     */
    async validateUrlForScraping(urlStr) {
        try {
            const parsedUrl = new URL(urlStr);
            const host = parsedUrl.hostname;

            // Simple loopback check
            if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
                logger.warn(`[Security-SSRF] Blocked loopback connection attempt to: ${host}`);
                return false;
            }

            // AWS / Cloud Metadata endpoint
            if (host === '169.254.169.254') {
                logger.warn('[Security-SSRF] Blocked cloud metadata connection attempt.');
                return false;
            }

            // Resolve host IP
            const addresses = await dns.resolve(host).catch(() => []);
            if (addresses.length === 0) {
                // If it is already an IP address
                if (/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(host)) {
                    addresses.push(host);
                }
            }

            for (const ip of addresses) {
                if (this._isPrivateIp(ip)) {
                    logger.warn(`[Security-SSRF] Blocked private range IP address redirection: ${ip}`);
                    return false;
                }
            }

            return true;
        } catch (err) {
            logger.error(`[Security-SSRF] URL Validation crashed for ${urlStr}: ${err.message}`);
            return false;
        }
    }

    /**
     * Checks if IP belongs to RFC 1918 or RFC 3927 private ranges.
     */
    _isPrivateIp(ip) {
        const parts = ip.split('.').map(Number);
        if (parts.length !== 4) return true; // Block invalid IPv4

        // Local loopback
        if (parts[0] === 127) return true;

        // Private IPv4 ranges:
        // 10.0.0.0 – 10.255.255.255
        if (parts[0] === 10) return true;

        // 172.16.0.0 – 172.31.255.255
        if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;

        // 192.168.0.0 – 192.168.255.255
        if (parts[0] === 192 && parts[1] === 168) return true;

        // Link-local address range 169.254.x.x
        if (parts[0] === 169 && parts[1] === 254) return true;

        return false;
    }

    /**
     * Revokes a JWT, adding it to the Redis/Memory revocation blacklist.
     */
    async revokeToken(token, ttlSec = 86400) {
        const tokenHash = this._hashToken(token);
        if (require('./redisService').isAlive()) {
            try {
                const redis = require('./redisService').client;
                await redis.set(`security:revoked:token:${tokenHash}`, 'true', 'EX', ttlSec);
                logger.info('[Security] Token blacklisted successfully in Redis.');
                return;
            } catch (_) {}
        }
        localTokenBlacklist.add(tokenHash);
        logger.info('[Security] Token blacklisted successfully in fallback memory.');
    }

    /**
     * Verifies if a token has been revoked.
     */
    async isTokenRevoked(token) {
        const tokenHash = this._hashToken(token);
        if (require('./redisService').isAlive()) {
            try {
                const redis = require('./redisService').client;
                const res = await redis.get(`security:revoked:token:${tokenHash}`);
                return res === 'true';
            } catch (_) {}
        }
        return localTokenBlacklist.has(tokenHash);
    }

    /**
     * Middleware check to authorize SRE operations based on operator role tags.
     */
    authorizeOperator(requiredRole = 'operator') {
        return (req, res, next) => {
            const role = req.headers['x-sre-role'] || 'user';
            
            if (role === 'admin' || role === requiredRole) {
                return next();
            }

            logger.error(`[Security-RBAC] Unauthorized access attempt to SRE Control Plane by: ${role}`);
            return res.status(403).json({
                error: 'Forbidden',
                message: 'Access to the SRE Control Plane is restricted to authorized operations.'
            });
        };
    }

    _hashToken(token) {
        const crypto = require('crypto');
        return crypto.createHash('sha256').update(token).digest('hex');
    }
}

module.exports = new SecurityService();
