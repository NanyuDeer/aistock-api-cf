import { Request, Response, NextFunction } from 'express';
import { createResponse } from '../utils/response';
import { isValidAShareSymbol, isValidGlobalIndexSymbol } from '../utils/validator';
import { CacheService } from '../services/CacheService';
import { getIndexDaily } from '../services/TushareService';
import {
    INDEX_QUOTE_CACHE_KEY_PREFIX,
    buildTimestampedCachePayload,
    isValidStockInfoCachePayload,
    type StockInfoCachePayload,
} from '../constants/cache';
import { getAShareIndexCacheTtlSeconds } from '../utils/tradingTime';

const MAX_SYMBOLS = 20;

const A_SHARE_INDEX_MAP: Record<string, string> = {
    '000001': '000001.SH',
    '000002': '000002.SH',
    '000003': '000003.SH',
    '000004': '000004.SH',
    '000005': '000005.SH',
    '399001': '399001.SZ',
    '399002': '399002.SZ',
    '399003': '399003.SZ',
    '399004': '399004.SZ',
    '399005': '399005.SZ',
    '399006': '399006.SZ',
    '399007': '399007.SZ',
    '399008': '399008.SZ',
    '399009': '399009.SZ',
    '399010': '399010.SZ',
    '399011': '399011.SZ',
    '399012': '399012.SZ',
    '399013': '399013.SZ',
    '399014': '399014.SZ',
    '399015': '399015.SZ',
    '399016': '399016.SZ',
    '399100': '399100.SZ',
    '399106': '399106.SZ',
    '399107': '399107.SZ',
    '399108': '399108.SZ',
    '399300': '399300.SZ',
    '399550': '399550.SZ',
    '399673': '399673.SZ',
    '399678': '399678.SZ',
    '399971': '399971.SZ',
};

function getRecentTradeDate(): string {
    const now = new Date();
    const hour = now.getHours();
    if (hour < 15) {
        now.setDate(now.getDate() - 1);
    }
    for (let i = 0; i < 7; i++) {
        const day = now.getDay();
        if (day !== 0 && day !== 6) {
            const pad = (n: number) => n.toString().padStart(2, '0');
            return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
        }
        now.setDate(now.getDate() - 1);
    }
    const d = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

async function getIndexQuoteFromTushare(symbol: string): Promise<Record<string, any>> {
    const tsCode = A_SHARE_INDEX_MAP[symbol];
    if (!tsCode) throw new Error(`指数 ${symbol} 不在支持列表中`);

    const tradeDate = getRecentTradeDate();
    let rows = await getIndexDaily(tsCode, tradeDate);

    if (rows.length === 0) {
        const d = new Date();
        d.setDate(d.getDate() - 1);
        for (let i = 0; i < 7; i++) {
            const day = d.getDay();
            if (day !== 0 && day !== 6) {
                const pad = (n: number) => n.toString().padStart(2, '0');
                const prevDate = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
                rows = await getIndexDaily(tsCode, prevDate);
                if (rows.length > 0) break;
            }
            d.setDate(d.getDate() - 1);
        }
    }

    if (rows.length === 0) throw new Error(`指数 ${symbol} 数据不存在`);

    const latest = rows[rows.length - 1];
    const close = Number(latest.close) || 0;
    const preClose = Number(latest.pre_close) || 0;
    const change = close - preClose;
    const pctChg = preClose > 0 ? (change / preClose) * 100 : 0;
    const high = Number(latest.high) || 0;
    const low = Number(latest.low) || 0;
    const open = Number(latest.open) || 0;
    const vol = Number(latest.vol) || 0;
    const amount = Number(latest.amount) || 0;

    return {
        '指数代码': symbol,
        '指数简称': '',
        '最新价': close,
        '最高价': high,
        '最低价': low,
        '今开价': open,
        '成交量': vol * 100,
        '成交额': amount * 1000,
        '昨收价': preClose,
        '涨跌幅': Math.round(pctChg * 100) / 100,
        '涨跌额': Math.round(change * 100) / 100,
        '换手率': 0,
        '更新时间': latest.trade_date || '',
    };
}

async function getGlobalIndexQuoteFromTushare(symbol: string): Promise<Record<string, any>> {
    const globalIndexMap: Record<string, string> = {
        'HXC': 'HSI',
        'HSI': 'HSI',
        'HSTECH': 'HSTECH',
        'HSCEI': 'HSCEI',
        'XIN9': 'FTXIN9',
        'DJI': 'DJI',
        'SPX': 'SPX',
        'IXIC': 'IXIC',
        'N225': 'N225',
        'FTSE': 'FTSE',
        'GDAXI': 'GDAXI',
        'FCHI': 'FCHI',
    };

    const indexName = globalIndexMap[symbol] || symbol;

    return {
        '指数代码': symbol,
        '指数简称': indexName,
        '最新价': null,
        '最高价': null,
        '最低价': null,
        '今开价': null,
        '成交量': null,
        '成交额': null,
        '昨收价': null,
        '涨跌幅': null,
        '涨跌额': null,
        '换手率': null,
        '更新时间': '',
        '提示': '全球指数暂不支持Tushare接口',
    };
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
                    const quote = await getIndexQuoteFromTushare(symbol);
                    await this.writeCachedQuote('cn', symbol, quote);
                    return { quote, fromCache: false };
                } catch (err: any) {
                    return { quote: { '指数代码': symbol, '错误': err?.message || '查询失败' }, fromCache: false };
                }
            }));
            const allFromCache = quoteResults.every(item => item.fromCache);
            const quotes = quoteResults.map(item => item.quote);
            createResponse(res, 200, allFromCache ? 'success (cached)' : 'success', {
                '来源': 'Tushare', '指数数量': quotes.length, '行情': quotes,
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
                    const quote = await getGlobalIndexQuoteFromTushare(symbol);
                    await this.writeCachedQuote('gb', symbol, quote);
                    return { quote, fromCache: false };
                } catch (err: any) {
                    return { quote: { '指数代码': symbol, '错误': err?.message || '查询失败' }, fromCache: false };
                }
            }));
            const allFromCache = quoteResults.every(item => item.fromCache);
            const quotes = quoteResults.map(item => item.quote);
            createResponse(res, 200, allFromCache ? 'success (cached)' : 'success', {
                '来源': 'Tushare', '指数数量': quotes.length, '行情': quotes,
            });
        } catch (err: any) {
            createResponse(res, 500, err instanceof Error ? err.message : 'Internal Server Error');
        }
    }
}
