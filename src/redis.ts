import dotenv from 'dotenv';
dotenv.config();

import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379/2', {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
        const delay = Math.min(times * 200, 5000);
        return delay;
    },
});

redis.on('error', (err) => {
    console.error('[Redis] Connection error:', err.message);
});

redis.on('connect', () => {
    console.log('[Redis] Connected successfully');
});

export default redis;
