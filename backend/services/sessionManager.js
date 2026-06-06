const crypto = require('crypto');

class SessionManager {
    constructor() {
        this.sessions = new Map();
        setInterval(() => this.cleanup(), 5 * 60 * 1000);
    }

    createSession(userId, password, cookies, scrapedData = {}) {
        // Reuse existing session for same user
        for (const [token, session] of this.sessions.entries()) {
            if (session.userId === userId) {
                session.password = password;
                session.cookies = cookies;
                session.scrapedData = scrapedData;
                session.lastUsed = Date.now();
                console.log(`[SessionManager] Reused existing session for ${userId}, token: ${token}`);
                return token;
            }
        }

        const token = crypto.randomUUID();
        this.sessions.set(token, {
            userId,
            password,
            cookies,
            scrapedData,
            lastUsed: Date.now()
        });
        console.log(`[SessionManager] Created new session for ${userId}, token: ${token}`);
        return token;
    }

    getSession(token) {
        const session = this.sessions.get(token);
        if (session) {
            session.lastUsed = Date.now();
            return session;
        }
        return null;
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
    }

    cleanup() {
        const EXPIRY_MS = 60 * 60 * 1000;
        const now = Date.now();
        let cleaned = 0;
        for (const [token, session] of this.sessions.entries()) {
            if (now - session.lastUsed > EXPIRY_MS) {
                this.sessions.delete(token);
                cleaned++;
            }
        }
        if (cleaned > 0) console.log(`[SessionManager] Cleaned up ${cleaned} expired sessions`);
    }
}

module.exports = new SessionManager();
