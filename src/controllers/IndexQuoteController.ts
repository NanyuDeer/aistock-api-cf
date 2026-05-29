import { Request, Response, NextFunction } from 'express';
import { getStockIdentity } from '../utils/stock';
import { formatToChinaTime } from '../utils/datetime';
import { createResponse } from '../utils/response';
import { isValidAShareSymbol, isValidGlobalIndexSymbol } from '../utils/validator';
import { CacheService } from '../services/CacheService';
import { eastmoneyThrottler } from '../utils/throttlers';
import {
    INDEX_QUOTE_CACHE_KEY_PREFIX,
    buildTimestampedCachePayload,
    isValidStockInfoCachePayload,
    type StockInfoCachePayload,
} from '../constants/cache';
import { getAShareIndexCacheTtlSeconds } from '../utils/tradingTime';

const MAX_SYMBOLS = 20;
const INDEX_FIELDS = 'f57,f58,f43,f44,f45,f46,f47,f48,f60,f170,f169,f168,f296,f86';

const FIELD_NAME_MAP: Record<string, string> = {
    'f57': '指数代码', 'f58': '指数简称', 'f43': '最新价', 'f44': '最高价',
    'f45': '最低价', 'f46': '今开价', 'f47': '成交量', 'f48': '成交额',
    'f60': '昨收价', 'f170': '涨跌幅', 'f169': '涨跌额', 'f168': '换手率',
    'f296': '成交笔数', 'f86': '更新时间',
};

const BASE_URL = 'https://push2.eastmoney.com/api/qt/stock/get';
const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Referer': 'https://quote.eastmoney.com/',
};

async function getIndexQuote(symbol: string): Promise<Record<string, any>> {
    const { eastmoneyId } = getStockIdentity(symbol);
    const indexId = eastmoneyId === 1 ? 0 : 1;
    const url = `${BASE_URL}?invt=2&fltt=2&fields=${INDEX_FIELDS}&secid=${indexId}.${symbol}`;
    await eastmoneyThrottler.throttle();
    const response = await fetch(url, { headers: HEADERS });
    if (!response.ok) throw new Error(`东方财富指数接口请求失败: ${response.status}`);
    const json: any = await response.json();
    const innerData = json.data;
    if (!innerData) throw new Error(`指数 ${symbol} 数据不存在`);
    const result: Record<string, any> = {};
    for (const [key, name] of Object.entries(FIELD_NAME_MAP)) {
        if (!(key in innerData)) continue;
        let value = innerData[key];
        if (key === 'f47' && typeof value === 'number') value = value * 100;
        else if (key === 'f86' && typeof value === 'number') value = formatToChinaTime(value * 1000);
        result[name] = value;
    }
    return result;
}

async function getGlobalIndexQuote(symbol: string): Promise<Record<string, any>> {
    const isHangSeng = symbol.startsWith('HS');
    const primaryMarketId = isHangSeng ? 124 : 100;
    const fallbackMarketId = 251;
    const primaryUrl = `${BASE_URL}?invt=2&fltt=2&fields=${INDEX_FIELDS}&secid=${primaryMarketId}.${symbol}`;
    await eastmoneyThrottler.throttle();
    let response = await fetch(primaryUrl, { headers: HEADERS });
    if (!response.ok) throw new Error(`东方财富指数接口请求失败: ${response.status}`);
    let json: any = await response.json();
    let innerData = json.data;
    if (!innerData && !isHangSeng) {
        const fallbackUrl = `${BASE_URL}?invt=2&fltt=2&fields=${INDEX_FIELDS}&secid=${fallbackMarketId}.${symbol}`;
        await eastmoneyThrottler.throttle();
        response = await fetch(fallbackUrl, { headers: HEADERS });
        if (!response.ok) throw new Error(`东方财富指数接口请求失败: ${response.status}`);
        json = await response.json();
        innerData = json.data;
    }
    if (!innerData) throw new Error(`指数 ${symbol} 数据不存在`);
    const result: Record<string, any> = {};
    for (const [key, name] of Object.entries(FIELD_NAME_MAP)) {
        if (!(key in innerData)) continue;
        let value = innerData[key];
        if (key === 'f47' && typeof value === 'number') value = value * 100;
        else if (key === 'f86' && typeof value === 'number') value = formatToChinaTime(value * 1000);
        result[name] = value;
    }
    return result;
}

export class IndexQuoteController {
    private static buildIndexCacheKey(market: 'cn' | 'gb', symbol: string): string {
        return `${INDEX_QUOTE_CACHE_KEY_PREFIX}${market}:${symbol.toUpperCase()}`;
    }

    private static async readCachedQuote(market: 'cn' | 'gb', symbol: string): Promise<Record<string, any> | null> {
        const cacheKey = this.buildIndexCacheKey(market, symbol);
        try {
            const cached = await CacheService.get<StockInfoCachePayload>(cacheKey);
            if (!isValidStockInfoCachePayload(cached)) return null;
            return cached.data;
        } catch (err) {
            console.error(`Error reading index quote cache ${cacheKey}:`, err);
            return null;
        }
    }

    private static async writeCachedQuote(market: 'cn' | 'gb', symbol: string, quote: Record<string, any>, ttlSeconds?: number): Promise<void> {
        if (Object.keys(quote).length === 0) return;
        const resolvedTtl = ttlSeconds ?? await getAShareIndexCacheTtlSeconds();
        const cacheKey = this.buildIndexCacheKey(market, symbol);
        try {
            await CacheService.set(cacheKey, buildTimestampedCachePayload(quote), resolvedTtl);
        } catch (err) {
            console.error(`Error writing index quote cache ${cacheKey}:`, err);
        }
    }

    static async getIndexQuotes(req: Request, res: Response, _next: NextFunction): Promise<void> {
        const symbolsParam = req.query.symbols as string;
        if (!symbolsParam) {
            createResponse(res, 400, '缺少 symbols 参数，示例: ?symbols=000001,399006');
            return;
        }
        const symbols = [...new Set(symbolsParam.split(',').map(s => s.trim()).filter(Boolean))];
        if (symbols.length === 0) {
            createResponse(res, 400, '缺少 symbols 参数');
            return;
        }
        if (symbols.length > MAX_SYMBOLS) {
            createResponse(res, 400, `单次最多查询 ${MAX_SYMBOLS} 只指数`);
            return;
        }
        const invalidSymbols = symbols.filter(s => !isValidAShareSymbol(s));
        if (invalidSymbols.length > 0) {
            createResponse(res, 400, `Invalid symbol(s) - 指数代码必须是6位数字: ${invalidSymbols.join(', ')}`);
            return;
        }

        try {
            const quoteResults = await Promise.all(symbols.map(async (symbol) => {
                try {
                    const cached = await this.readCachedQuote('cn', symbol);
                    if (cached) return { quote: cached, fromCache: true };
                    const quote = await getIndexQuote(symbol);
                    await this.writeCachedQuote('cn', symbol, quote);
                    return { quote, fromCache: false };
                } catch (err: any) {
                    return { quote: { '指数代码': symbol, '错误': err?.message || '查询失败' }, fromCache: false };
                }
            }));
            const allFromCache = quoteResults.every(item => item.fromCache);
            const quotes = quoteResults.map(item => item.quote);
            createResponse(res, 200, allFromCache ? 'success (cached)' : 'success', {
                '来源': '东方财富', '指数数量': quotes.length, '行情': quotes,
            });
        } catch (err: any) {
            createResponse(res, 500, err instanceof Error ? err.message : 'Internal Server Error');
        }
    }

    static async getGlobalIndexQuotes(req: Request, res: Response, _next: NextFunction): Promise<void> {
        const symbolsParam = req.query.symbols as string;
        if (!symbolsParam) {
            createResponse(res, 400, '缺少 symbols 参数，示例: ?symbols=HXC,XIN9,HSTECH');
            return;
        }
        const symbols = [...new Set(symbolsParam.split(',').map(s => s.trim().toUpperCase()).filter(Boolean))];
        if (symbols.length === 0) {
            createResponse(res, 400, '缺少 symbols 参数');
            return;
        }
        if (symbols.length > MAX_SYMBOLS) {
            createResponse(res, 400, `单次最多查询 ${MAX_SYMBOLS} 只指数`);
            return;
        }
        const invalidSymbols = symbols.filter(s => !isValidGlobalIndexSymbol(s));
        if (invalidSymbols.length > 0) {
            createResponse(res, 400, `Invalid symbol(s) - 全球指数代码格式错误: ${invalidSymbols.join(', ')}`);
            return;
        }

        try {
            const quoteResults = await Promise.all(symbols.map(async (symbol) => {
                try {
                    const cached = await this.readCachedQuote('gb', symbol);
                    if (cached) return { quote: cached, fromCache: true };
                    const quote = await getGlobalIndexQuote(symbol);
                    await this.writeCachedQuote('gb', symbol, quote);
                    return { quote, fromCache: false };
                } catch (err: any) {
                    return { quote: { '指数代码': symbol, '错误': err?.message || '查询失败' }, fromCache: false };
                }
            }));
            const allFromCache = quoteResults.every(item => item.fromCache);
            const quotes = quoteResults.map(item => item.quote);
            createResponse(res, 200, allFromCache ? 'success (cached)' : 'success', {
                '来源': '东方财富', '指数数量': quotes.length, '行情': quotes,
            });
        } catch (err: any) {
            createResponse(res, 500, err instanceof Error ? err.message : 'Internal Server Error');
        }
    }
}
