import { getStockIdentity } from '../utils/stock';
import { tushareRequest, getDailyBasic } from './TushareService';
import { createThrottler } from '../utils/throttle';

const tushareQuoteThrottler = createThrottler(150);

export type QuoteLevel = 'core' | 'activity' | 'fundamental';

function toTsCode(symbol: string): string {
    const identity = getStockIdentity(symbol);
    return `${symbol}.${identity.market.toUpperCase()}`;
}

function getTodayStr(): string {
    const d = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

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
    return getTodayStr();
}

async function fetchDaily(symbol: string, tradeDate: string): Promise<Record<string, any> | null> {
    await tushareQuoteThrottler.throttle();
    const rows = await tushareRequest('daily', {
        ts_code: toTsCode(symbol),
        trade_date: tradeDate,
    });
    return rows.length > 0 ? rows[0] : null;
}

async function fetchDailyMultiDate(symbol: string, startDate: string, endDate: string): Promise<Record<string, any>[]> {
    await tushareQuoteThrottler.throttle();
    return tushareRequest('daily', {
        ts_code: toTsCode(symbol),
        start_date: startDate,
        end_date: endDate,
    });
}

export class TushareQuoteService {
    static async getQuote(symbol: string, level: QuoteLevel = 'core'): Promise<Record<string, any>> {
        const tradeDate = getRecentTradeDate();
        const [dailyRow, basicRow] = await Promise.all([
            fetchDaily(symbol, tradeDate),
            getDailyBasic(symbol, tradeDate).catch(() => []),
        ]);
        const basic = basicRow.length > 0 ? basicRow[0] : null;

        if (!dailyRow) {
            const fallbackDate = getRecentTradeDate();
            if (fallbackDate !== tradeDate) {
                const fallback = await fetchDaily(symbol, fallbackDate);
                if (!fallback) throw new Error(`Tushare行情接口无数据: ${symbol}`);
                return this.buildQuote(symbol, fallback, basic, level);
            }
            throw new Error(`Tushare行情接口无数据: ${symbol}`);
        }

        return this.buildQuote(symbol, dailyRow, basic, level);
    }

    private static buildQuote(
        symbol: string,
        daily: Record<string, any>,
        basic: Record<string, any> | null,
        level: QuoteLevel,
    ): Record<string, any> {
        const preClose = Number(daily.pre_close) || 0;
        const close = Number(daily.close) || 0;
        const change = close - preClose;
        const pctChg = preClose > 0 ? (change / preClose) * 100 : 0;
        const vol = Number(daily.vol) || 0;
        const amount = Number(daily.amount) || 0;
        const high = Number(daily.high) || 0;
        const low = Number(daily.low) || 0;
        const open = Number(daily.open) || 0;

        const result: Record<string, any> = {
            '股票代码': symbol,
            '股票简称': '',
            '最新价': close,
            '涨跌额': Math.round(change * 100) / 100,
            '涨跌幅': Math.round(pctChg * 100) / 100,
        };

        if (level === 'core') {
            result['更新时间'] = daily.trade_date || '';
            return result;
        }

        if (level === 'activity') {
            result['均价'] = vol > 0 ? Math.round((amount * 1000 / (vol * 100)) * 100) / 100 : 0;
            result['最高价'] = high;
            result['最低价'] = low;
            result['今开价'] = open;
            result['昨收价'] = preClose;
            result['成交量'] = vol * 100;
            result['成交额'] = amount * 1000;
            result['振幅'] = preClose > 0 ? Math.round(((high - low) / preClose) * 10000) / 100 : 0;
            result['换手率'] = Number(daily.turnover) || 0;
            result['更新时间'] = daily.trade_date || '';
            return result;
        }

        if (level === 'fundamental') {
            result['动态市盈率'] = basic?.pe ?? null;
            result['市净率'] = basic?.pb ?? null;
            result['总市值'] = basic?.total_mv ? Math.round(basic.total_mv * 10000) : null;
            result['流通市值'] = basic?.circ_mv ? Math.round(basic.circ_mv * 10000) : null;
            result['换手率'] = Number(daily.turnover) || 0;
            result['成交量'] = vol * 100;
            result['成交额'] = amount * 1000;
            result['昨收价'] = preClose;
            result['今开价'] = open;
            result['最高价'] = high;
            result['最低价'] = low;
            result['更新时间'] = daily.trade_date || '';
            return result;
        }

        return result;
    }

    static async getBatchQuotes(symbols: string[], level: QuoteLevel = 'core'): Promise<Record<string, any>[]> {
        const results = await Promise.allSettled(symbols.map(symbol => this.getQuote(symbol, level)));
        return results.map((result, index) => {
            if (result.status === 'fulfilled') return result.value;
            return { '股票代码': symbols[index], '错误': result.reason?.message || '查询失败' };
        });
    }
}
