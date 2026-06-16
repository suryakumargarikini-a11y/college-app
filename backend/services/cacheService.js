const logger = require('./logger');

class CacheService {
    constructor() {
        this.cacheStore = new Map();
        this.defaultTTL = 5 * 60 * 1000; // Default: 5 minutes TTL
        this.redisClient = null;
        this.isRedisConnected = false;

        this.initRedis();
    }

    /**
     * Initializes Redis if the client library and configuration are available.
     * Gracefully falls back to high-performance local memory Map.
     */
    async initRedis() {
        const isProduction = process.env.NODE_ENV === 'production';
        const hasRedisUrl = !!process.env.REDIS_URL;
        const isLocalhostRedis = hasRedisUrl && (process.env.REDIS_URL.includes('localhost') || process.env.REDIS_URL.includes('127.0.0.1'));
        const disableRedisEnv = process.env.DISABLE_REDIS === 'true';

        if (disableRedisEnv || (isProduction && (!hasRedisUrl || isLocalhostRedis))) {
            logger.info('[Cache] Redis is disabled for this environment. Using high-performance in-memory cache engine.');
            this.redisClient = null;
            this.isRedisConnected = false;
            try { require('./metricsService').metrics.redisConnected.set(0); } catch (_) {}
            return;
        }

        if (process.env.REDIS_URL || process.env.REDIS_HOST) {
            try {
                // Dynamic import to prevent crash if 'redis' is not installed
                const redis = require('redis');
                const client = redis.createClient({
                    url: process.env.REDIS_URL || `redis://${process.env.REDIS_HOST || '127.0.0.1'}:${process.env.REDIS_PORT || 6379}`
                });

                client.on('error', (err) => {
                    logger.warn(`[Cache] Redis Error: ${err.message}. Using high-performance in-memory fallback.`);
                    this.isRedisConnected = false;
                    try { require('./metricsService').metrics.redisConnected.set(0); } catch (_) {}
                });

                client.on('connect', () => {
                    logger.info('[Cache] Successfully connected to Redis server.');
                    this.isRedisConnected = true;
                    try { require('./metricsService').metrics.redisConnected.set(1); } catch (_) {}
                });

                await client.connect();
                this.redisClient = client;
            } catch (err) {
                logger.info('[Cache] Redis server or client library not loaded. Running high-performance in-memory fallback cache engine.');
                this.redisClient = null;
                this.isRedisConnected = false;
                try { require('./metricsService').metrics.redisConnected.set(0); } catch (_) {}
            }
        }
    }

    /**
     * Generates a namespaced cache key.
     */
    _makeKey(namespace, userId) {
        return `${namespace}:${userId}`;
    }

    /**
     * Retrieves cached data from namespace.
     */
    async get(namespace, userId) {
        const key = this._makeKey(namespace, userId);

        if (this.isRedisConnected && this.redisClient) {
            try {
                const value = await this.redisClient.get(key);
                if (value) {
                    logger.info(`[Cache] Redis hit for namespace: ${namespace}, user: ${userId}`);
                    return JSON.parse(value);
                }
            } catch (err) {
                logger.error(`[Cache] Redis GET failed: ${err.message}`);
            }
        }

        // Local Memory Fallback
        const cached = this.cacheStore.get(key);
        if (!cached) {
            logger.info(`[Cache] Cache miss for namespace: ${namespace}, user: ${userId}`);
            return null;
        }

        // Check TTL expiration
        const timeDiff = Date.now() - cached.timestamp;
        const ttlLimit = cached.ttl || this.defaultTTL;
        if (timeDiff > ttlLimit) {
            this.cacheStore.delete(key);
            logger.info(`[Cache] Cache expired for namespace: ${namespace}, user: ${userId}`);
            return null;
        }

        logger.info(`[Cache] Local cache hit for namespace: ${namespace}, user: ${userId}`);
        return cached.data;
    }

    /**
     * Caches data under namespace with custom TTL.
     */
    async set(namespace, userId, data, ttlMs = null) {
        const key = this._makeKey(namespace, userId);
        const ttl = ttlMs || this.defaultTTL;

        if (this.isRedisConnected && this.redisClient) {
            try {
                await this.redisClient.setEx(key, Math.ceil(ttl / 1000), JSON.stringify(data));
                logger.info(`[Cache] Saved namespace: ${namespace}, user: ${userId} inside Redis`);
                return;
            } catch (err) {
                logger.error(`[Cache] Redis SETEX failed: ${err.message}`);
            }
        }

        // Local Memory Store
        this.cacheStore.set(key, {
            data,
            timestamp: Date.now(),
            ttl
        });
        logger.info(`[Cache] Local cache saved for namespace: ${namespace}, user: ${userId}`);
    }

    /**
     * Invalidates cache for a specific user under a namespace.
     */
    async invalidate(namespace, userId) {
        const key = this._makeKey(namespace, userId);

        if (this.isRedisConnected && this.redisClient) {
            try {
                await this.redisClient.del(key);
                logger.info(`[Cache] Invalidated namespace: ${namespace}, user: ${userId} in Redis`);
            } catch (err) {
                logger.error(`[Cache] Redis DEL failed: ${err.message}`);
            }
        }

        this.cacheStore.delete(key);
        logger.info(`[Cache] Local cache invalidated for namespace: ${namespace}, user: ${userId}`);
    }

    /**
     * Clears all cache namespaces.
     */
    async clearAll() {
        if (this.isRedisConnected && this.redisClient) {
            try {
                await this.redisClient.flushAll();
                logger.info('[Cache] Flushed all keys inside Redis');
            } catch (err) {
                logger.error(`[Cache] Redis FLUSHALL failed: ${err.message}`);
            }
        }

        this.cacheStore.clear();
        logger.info('[Cache] Flushed all local memory cache namespaces');
    }
}

module.exports = new CacheService();
