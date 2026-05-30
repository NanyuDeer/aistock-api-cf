import { tushareRequest } from './TushareService';
import { createThrottler } from '../utils/throttle';

const tushareRankThrottler = createThrottler(150);

export interface StockRankResult {
    当前排名: number;
    股票代码: string;
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

interface RankRow {
    symbol: string;
    score: number;
}

export class TushareRankService {
    static async getStockHotRank(): Promise<StockRankResult[]> {
        const tradeDate = getRecentTradeDate();

        await tushareRankThrottler.throttle();

        const rows: Record<string, any>[] = await tushareRequest('daily', {
            trade_date: tradeDate,
            fields: 'ts_code,trade_date,pct_chg,amount,vol',
        });

        if (!rows || rows.length === 0) throw new Error('Tushare人气排行接口返回数据为空');

        const sorted: RankRow[] = rows
            .map((row: Record<string, any>): RankRow => {
                const tsCode = String(row.ts_code || '');
                const symbol = tsCode.split('.')[0];
                const amount = Number(row.amount) || 0;
                const pctChg = Number(row.pct_chg) || 0;
                const score = Math.abs(pctChg) * 0.6 + amount * 0.4;
                return { symbol, score };
            })
            .filter((item: RankRow) => /^\d{6}$/.test(item.symbol))
            .sort((a: RankRow, b: RankRow) => b.score - a.score);

        return sorted.slice(0, 100).map((item: RankRow, index: number): StockRankResult => ({
            '当前排名': index + 1,
            '股票代码': item.symbol,
        }));
    }
}
