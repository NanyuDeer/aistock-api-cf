import redis from '../redis';

export class CacheService {
    static async get<T>(key: string): Promise<T | null> {
        const raw = await redis.get(key);
        if (!raw) return null;
        try { return JSON.parse(raw) as T; } catch { return null; }
    }

    static async put<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
        if (!Number.isFinite(ttlSeconds)) throw new Error(`Invalid TTL for key ${key}: ${ttlSeconds}`);
        const normalizedTtlSeconds = Math.max(60, Math.floor(ttlSeconds));
        await redis.set(key, JSON.stringify(value), 'EX', normalizedTtlSeconds);
    }

    static async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
        await CacheService.put(key, value, ttlSeconds);
    }

    static async refresh<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
        await CacheService.put(key, value, ttlSeconds);
    }

    static async del(key: string): Promise<void> {
        await redis.del(key);
    }
}
