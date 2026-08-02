const crypto = require('crypto');

// Lazy-load prisma to avoid circular dependency at module init time
let _prisma = null;
function getPrisma() {
    if (!_prisma) {
        try { _prisma = require('./dbService'); } catch (_) { _prisma = null; }
    }
    return _prisma;
}

// Session lifetime: 7 days (survives Render cold starts via DB persistence)
const SESSION_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Compute a non-reversible SHA-256 hash of a raw session token.
 * Used as the key for the token-hash index so raw bearer tokens are never
 * stored on WebSocket objects or in secondary data structures.
 */
function hashToken(rawToken) {
    return crypto.createHash('sha256').update(rawToken).digest('hex');
}

class SessionManager {
    constructor() {
        this.sessions = new Map();        // rawToken  → session object
        this._hashIndex = new Map();      // sha256(rawToken) → rawToken  (for O(1) WS heartbeat lookup)
        // Cleanup every 30 min — removes expired in-memory sessions
        setInterval(() => this.cleanup(), 30 * 60 * 1000);

        // ── Startup diagnostic: verify prisma.session exists ──────────────
        // If this logs 'undefined', the Prisma client was not regenerated after
        // the Session model was added to schema.prisma. Re-run: npx prisma generate
        setImmediate(() => {
            const prisma = getPrisma();
            const sessionType = prisma ? typeof prisma.session : 'prisma-null';
            console.log(`[SessionManager] Startup check — prisma.session type: ${sessionType}`);
            if (prisma && typeof prisma.session !== 'object') {
                console.error('[SessionManager] CRITICAL: prisma.session is undefined. ' +
                    'The Session model is missing from the generated Prisma client. ' +
                    'Run: npx prisma generate. All authenticated requests will fail with 401.');
            } else {
                console.log('[SessionManager] OK — prisma.session.findUnique:', typeof prisma?.session?.findUnique);
            }
        });
    }

    createSession(userId, password, cookies, scrapedData = {}, role = 'STUDENT', isParent = false) {
        // Reuse existing in-memory session for same user if role matches
        for (const [token, session] of this.sessions.entries()) {
            if (session.userId === userId && session.role === role) {
                session.userId = userId;
                session.studentId = userId;
                session.password = password;
                session.cookies = cookies;
                session.scrapedData = scrapedData;
                session.role = role;
                session.isParent = !!isParent;
                session.lastUsed = Date.now();
                session.expiresAt = Date.now() + SESSION_EXPIRY_MS;
                // P0-5: token value removed from log — Railway logs must not contain session credentials
                console.log(`[SessionManager] Reused existing session for ${userId} (role: ${role})`);
                this._persistSession(token, session).catch(() => {});
                return token;
            }
        }

        const token = crypto.randomUUID();
        const session = {
            userId,
            studentId: userId,
            password,
            cookies,
            scrapedData,
            role,
            isParent: !!isParent,
            lastUsed: Date.now(),
            expiresAt: Date.now() + SESSION_EXPIRY_MS
        };
        this.sessions.set(token, session);
        // Maintain hash index for O(1) WebSocket heartbeat revalidation
        this._hashIndex.set(hashToken(token), token);
        // P0-5: token value removed from log — Railway logs must not contain session credentials
        console.log(`[SessionManager] Created new session for ${userId} (role: ${role})`);
        this._persistSession(token, session).catch(() => {});
        return token;
    }

    // Retrieve session — checks in-memory first, then DB (handles cold starts)
    getSession(token) {
        const session = this.sessions.get(token);
        if (session) {
            // Check expiry
            if (session.expiresAt && Date.now() > session.expiresAt) {
                this.sessions.delete(token);
                this._deletePersistedSession(token).catch(() => {});
                return null;
            }
            session.lastUsed = Date.now();
            return session;
        }
        // Not in memory (cold start scenario) — return null synchronously
        // The caller can use getSessionAsync for DB lookup
        return null;
    }

    // Async variant: checks DB after memory miss — used in auth middleware
    async getSessionAsync(token) {
        // 1. Check in-memory cache first
        const memSession = this.getSession(token);
        if (memSession) return memSession;

        // 2. Cold start recovery — check DB
        const prisma = getPrisma();
        if (!prisma) return null;
        try {
            const dbSession = await prisma.session.findUnique({ where: { token } });
            if (!dbSession) return null;
            // Check DB expiry
            if (new Date(dbSession.expiresAt).getTime() < Date.now()) {
                await prisma.session.delete({ where: { token } }).catch(() => {});
                return null;
            }
            // Restore into in-memory map and hash index
            const session = {
                userId: dbSession.userId,
                password: dbSession.password || '',
                cookies: dbSession.cookies || '',
                scrapedData: dbSession.scrapedData ? JSON.parse(dbSession.scrapedData) : {},
                lastUsed: Date.now(),
                expiresAt: new Date(dbSession.expiresAt).getTime()
            };
            this.sessions.set(token, session);
            this._hashIndex.set(hashToken(token), token); // maintain index for WS heartbeat
            console.log(`[SessionManager] Restored cold-start session for ${dbSession.userId} from DB`);
            return session;
        } catch (err) {
            console.warn(`[SessionManager] DB session lookup failed: ${err.message}`);
            return null;
        }
    }

    /**
     * Look up a session by its SHA-256 token hash.
     * Used by WebSocket heartbeat — the raw bearer token is never stored on the socket.
     * Returns the live session object, or null if not found / expired.
     */
    getSessionByTokenHash(tokenHash) {
        const rawToken = this._hashIndex.get(tokenHash);
        if (!rawToken) return null;
        return this.getSession(rawToken); // getSession() handles expiry check + cleanup
    }

    updateCookies(token, newCookies) {
        const session = this.sessions.get(token);
        if (session) {
            session.cookies = newCookies;
            session.lastUsed = Date.now();
        }
    }

    updateScrapedData(token, scrapedData) {
        const session = this.sessions.get(token);
        if (session) {
            session.scrapedData = scrapedData;
            session.lastUsed = Date.now();
        }
    }

    // Update both cookies and scraped data atomically (used after re-login)
    updateSession(token, newCookies, newScrapedData) {
        const session = this.sessions.get(token);
        if (session) {
            session.cookies = newCookies;
            session.scrapedData = newScrapedData;
            session.lastUsed = Date.now();
            console.log(`[SessionManager] Updated session (cookies + scrapedData) for ${session.userId}`);
        }
    }

    deleteSession(token) {
        this.sessions.delete(token);
        this._hashIndex.delete(hashToken(token)); // keep hash index consistent
        this._deletePersistedSession(token).catch(() => {});
    }

    cleanup() {
        const now = Date.now();
        let cleaned = 0;
        for (const [token, session] of this.sessions.entries()) {
            const expiry = session.expiresAt || (session.lastUsed + SESSION_EXPIRY_MS);
            if (now > expiry) {
                this.sessions.delete(token);
                this._hashIndex.delete(hashToken(token)); // keep hash index consistent
                this._deletePersistedSession(token).catch(() => {});
                cleaned++;
            }
        }
        if (cleaned > 0) console.log(`[SessionManager] Cleaned up ${cleaned} expired sessions`);
    }

    // ─── Internal DB Persistence ─────────────────────────────────────────────────────

    async _persistSession(token, session) {
        const prisma = getPrisma();
        if (!prisma) return;
        try {
            await prisma.session.upsert({
                where: { token },
                update: {
                    userId: session.userId,
                    password: session.password,
                    cookies: session.cookies,
                    scrapedData: JSON.stringify(session.scrapedData || {}),
                    lastUsed: new Date(session.lastUsed),
                    expiresAt: new Date(session.expiresAt)
                },
                create: {
                    token,
                    userId: session.userId,
                    password: session.password,
                    cookies: session.cookies,
                    scrapedData: JSON.stringify(session.scrapedData || {}),
                    lastUsed: new Date(session.lastUsed),
                    expiresAt: new Date(session.expiresAt)
                }
            });
        } catch (err) {
            // Non-fatal — session still lives in memory for this process lifetime
            if (!err.message?.includes('does not exist')) {
                console.warn(`[SessionManager] DB session persist failed (non-fatal): ${err.message}`);
            }
        }
    }

    async _deletePersistedSession(token) {
        const prisma = getPrisma();
        if (!prisma) return;
        try {
            await prisma.session.delete({ where: { token } });
        } catch (_) {
            // Ignore — session may not exist in DB
        }
    }
}

module.exports = new SessionManager();
