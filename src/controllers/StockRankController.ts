import { Request, Response, NextFunction } from 'express';
import { TushareRankService } from '../services/TushareRankService';
import { createResponse } from '../utils/response';
import { formatToChinaTime } from '../utils/datetime';
import { CacheService } from '../services/CacheService';
import {
    HOT_STOCKS_CACHE_KEY,
    HOT_STOCKS_CACHE_TTL_SECONDS,
    HOT_STOCKS_SOURCE,
    type HotStocksCachePayload,
} from '../constants/cache';

export class StockRankController {
    private static readonly DEFAULT_COUNT = 8;
    private static readonly MAX_COUNT = 100;

    private static isValidCachedPayload(value: unknown): value is HotStocksCachePayload {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
        const payload = value as Record<string, unknown>;
        if (typeof payload.timestamp !== 'number' || !Number.isFinite(payload.timestamp)) return false;
        if (typeof payload.source !== 'string' || !payload.source) return false;
        if (!Array.isArray(payload.hotStocks)) return false;
        return true;
    }

    private static async getCachedHotStocks(): Promise<HotStocksCachePayload | null> {
        try {
            const cached = await CacheService.get<HotStocksCachePayload>(HOT_STOCKS_CACHE_KEY);
            if (!this.isValidCachedPayload(cached)) return null;
            return cached;
        } catch (err) {
            console.error('Error reading hot stocks cache:', err);
            return null;
        }
    }

    private static async writeHotStocksCache(rankList: Awaited<ReturnType<typeof TushareRankService.getStockHotRank>>): Promise<void> {
        const hotStocks = rankList.slice(0, StockRankController.MAX_COUNT);
        const payload: HotStocksCachePayload = {
            timestamp: Date.now(),
            generatedAt: new Date().toISOString(),
            source: HOT_STOCKS_SOURCE,
            topN: hotStocks.length,
            symbols: hotStocks.map(item => item['股票代码']),
            hotStocks,
        };

        try {
            await CacheService.set(HOT_STOCKS_CACHE_KEY, payload, HOT_STOCKS_CACHE_TTL_SECONDS);
        } catch (err) {
            console.error('Error writing hot stocks cache:', err);
        }
    }

    static async getHotRank(req: Request, res: Response, _next: NextFunction): Promise<void> {
        try {
            const countParam = req.query.count as string;
            let count = StockRankController.DEFAULT_COUNT;

            if (countParam) {
                const parsed = Number(countParam);
                if (!Number.isInteger(parsed) || parsed <= 0 || parsed > StockRankController.MAX_COUNT) {
                    createResponse(res, 400, `Invalid count - count 必须是 1-${StockRankController.MAX_COUNT} 的整数`);
                    return;
                }
                count = parsed;
            }

            const cached = await this.getCachedHotStocks();
            if (cached && cached.hotStocks.length >= count) {
                createResponse(res, 200, 'success (cached)', {
                    '来源': cached.source,
                    '更新时间': formatToChinaTime(cached.timestamp),
                    '人气榜': cached.hotStocks.slice(0, count),
                });
                return;
            }

            const rankList = await TushareRankService.getStockHotRank();
            const now = Date.now();

            this.writeHotStocksCache(rankList).catch(() => {});

            createResponse(res, 200, 'success', {
                '来源': HOT_STOCKS_SOURCE,
                '更新时间': formatToChinaTime(now),
                '人气榜': rankList.slice(0, count),
            });
        } catch (err: any) {
            console.error('Error fetching stock hot rank:', err);
            createResponse(res, 500, err instanceof Error ? err.message : 'Internal Server Error');
        }
    }
}
