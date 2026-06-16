const Redis = require('ioredis');
const logger = require('./logger');

class RedisService {
    constructor() {
        this.client = null;
        this.isConnected = false;

        const isProduction = process.env.NODE_ENV === 'production';
        const hasRedisUrl = !!process.env.REDIS_URL;
        const isLocalhostRedis = hasRedisUrl && (process.env.REDIS_URL.includes('localhost') || process.env.REDIS_URL.includes('127.0.0.1'));
        const disableRedisEnv = process.env.DISABLE_REDIS === 'true';

        // Disable Redis if explicitly disabled, or if in production and no valid external REDIS_URL is provided
        this.isDisabled = disableRedisEnv || (isProduction && (!hasRedisUrl || isLocalhostRedis));
        this.redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
        
        if (this.isDisabled) {
            logger.info('[RedisService] Redis is disabled for this environment. Using in-memory fallback cache and queues.');
        }
    }

    /**
     * Initialize connection pool to Redis server with graceful backoffs.
     */
    connect() {
        if (this.isDisabled) {
            return null;
        }

        logger.info(`[RedisService] Attempting connection to Redis at: ${this.redisUrl}`);
        
        try {
            this.client = new Redis(this.redisUrl, {
                maxRetriesPerRequest: null, // Critical requirement for BullMQ
                enableReadyCheck: true,
                            retryStrategy: (times) => {
                    // Exponential backoff with a maximum delay of 15 seconds
                    const delay = Math.min(times * 100, 15000);
                    
                    const metricsService = require('./metricsService');
                    metricsService.metrics.redisReconnectTotal.inc();
                    
                    try {
                        const { tracer } = require('../telemetry/tracing');
                        const span = tracer.startSpan('redis.reconnect', {
                            attributes: {
                                'dependency.type': 'cache',
                                'dependency.name': 'redis',
                                'anomaly': true,
                                'anomaly.type': 'redis_reconnect_storm',
                                'anomaly.severity': 'critical'
                            }
                        });
                        span.addEvent('redis_reconnect_started', { attempt: times, delay_ms: delay });
                        span.end();
                    } catch (_) {}
                    
                    if (times > 5) {
                        logger.warn(`[RedisService] Connection retrying... Attempt count: ${times}. Delay: ${delay}ms`);
                    }
                    return delay;
                }
            });

            // Wrap send_command for latency profiling & error logging
            const originalSendCommand = this.client.send_command;
            this.client.send_command = function(command, ...args) {
                const commandName = command && command.name ? command.name.toUpperCase() : 'UNKNOWN';
                const { traceSpan } = require('../telemetry/tracing');
                
                return traceSpan(`redis.command.${commandName.toLowerCase()}`, {
                    'db.system': 'redis',
                    'db.operation': commandName,
                    'dependency.type': 'cache',
                    'dependency.name': 'redis',
                    'dependency.category': 'distributed_queue',
                    'dependency.criticality': 'medium'
                }, async (span) => {
                    const start = Date.now();
                    try {
                        const result = originalSendCommand.apply(this, [command, ...args]);
                        if (result && typeof result.then === 'function') {
                            const res = await result;
                            const duration = (Date.now() - start) / 1000;
                            const metricsService = require('./metricsService');
                            metricsService.metrics.redisCommandDuration.observe({ command: commandName }, duration);
                            
                            // Check latency violation (100ms for Redis command SLO)
                            if (duration * 1000 > 100) {
                                span.setAttribute('anomaly', true);
                                span.setAttribute('anomaly.type', 'redis_latency_spike');
                                span.setAttribute('anomaly.severity', 'medium');
                            }
                            
                            return res;
                        }
                        return result;
                    } catch (err) {
                        const duration = (Date.now() - start) / 1000;
                        const metricsService = require('./metricsService');
                        metricsService.metrics.redisCommandDuration.observe({ command: commandName }, duration);
                        logger.error(`[RedisService] Redis command ${commandName} failed: ${err.message}`, {
                            command: commandName,
                            durationMs: duration * 1000,
                            tag: 'REDIS_COMMAND_FAILURE'
                        });
                        
                        // Tag span as error anomaly
                        span.setAttribute('anomaly', true);
                        span.setAttribute('anomaly.type', 'redis_command_failure');
                        span.setAttribute('anomaly.severity', 'high');
                        
                        throw err;
                    }
                });
            };

            this.client.on('connect', () => {
                const metricsService = require('./metricsService');
                metricsService.metrics.redisConnected.set(1);
                logger.info('[RedisService] Connection established successfully.');
            });

            this.client.on('ready', () => {
                this.isConnected = true;
                const metricsService = require('./metricsService');
                metricsService.metrics.redisConnected.set(1);
                logger.info('[RedisService] Redis client is ready to accept commands.');
                this._startMemoryMonitor();
            });

            this.client.on('error', (err) => {
                // Prevent error spam from dropping application server
                logger.error(`[RedisService] Redis connection error: ${err.message}`, { tag: 'REDIS_OUTAGE' });
                this.isConnected = false;
                const metricsService = require('./metricsService');
                metricsService.metrics.redisConnected.set(0);
            });

            this.client.on('close', () => {
                logger.warn('[RedisService] Connection closed.', { tag: 'REDIS_OUTAGE' });
                this.isConnected = false;
                const metricsService = require('./metricsService');
                metricsService.metrics.redisConnected.set(0);
            });

            return this.client;
        } catch (error) {
            logger.error(`[RedisService] Initialization failed: ${error.message}`);
            this.isConnected = false;
            return null;
        }
    }

    /**
     * Start background monitoring of Redis memory usage.
     */
    _startMemoryMonitor() {
        if (this._memoryInterval) clearInterval(this._memoryInterval);
        
        this._memoryInterval = setInterval(async () => {
            if (!this.isAlive()) return;
            try {
                const info = await this.client.info('memory');
                const usedMemoryMatch = info.match(/used_memory:(\d+)/);
                const maxMemoryMatch = info.match(/maxmemory:(\d+)/);
                
                if (usedMemoryMatch) {
                    const usedBytes = parseInt(usedMemoryMatch[1], 10);
                    const maxBytes = maxMemoryMatch ? parseInt(maxMemoryMatch[1], 10) : 0;
                    const usedMb = (usedBytes / 1024 / 1024).toFixed(2);
                    
                    if (maxBytes > 0 && usedBytes >= maxBytes * 0.85) {
                        logger.warn(`[RedisService] High memory pressure detected: ${usedMb}MB used / ${(maxBytes / 1024 / 1024).toFixed(2)}MB limit`, {
                            usedBytes,
                            maxBytes,
                            tag: 'REDIS_MEMORY_PRESSURE'
                        });
                    } else {
                        logger.debug(`[RedisService] Memory usage healthy: ${usedMb}MB`);
                    }
                }
            } catch (err) {
                logger.debug(`[RedisService] Failed to query memory metrics: ${err.message}`);
            }
        }, 60000); // Check every minute
    }

    /**
     * Check if Redis is fully operational.
     */
    isAlive() {
        return this.isConnected && this.client !== null;
    }

    /**
     * Clean disconnect from connection pool.
     */
    async disconnect() {
        if (this.client) {
            logger.info('[RedisService] Gracefully disconnecting Redis connection pool...');
            try {
                await this.client.quit();
                logger.info('[RedisService] Redis successfully disconnected.');
            } catch (err) {
                logger.error(`[RedisService] Error during shutdown: ${err.message}`);
            } finally {
                this.client = null;
                this.isConnected = false;
            }
        }
    }
}

module.exports = new RedisService();
