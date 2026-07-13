const Redis = require('ioredis');

async function main() {
    const redis = new Redis('redis://localhost:6379');
    try {
        console.log('Pinging Redis...');
        const res = await redis.ping();
        console.log('Redis response:', res);
    } catch (e) {
        console.error('Redis connection failed:', e.message);
    } finally {
        redis.disconnect();
    }
}

main().catch(console.error);
