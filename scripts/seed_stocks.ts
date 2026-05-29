import dotenv from 'dotenv';
dotenv.config();

import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
});

function getStockMarket(symbol: string): string {
    if (symbol.startsWith('600') || symbol.startsWith('601') || symbol.startsWith('603') || symbol.startsWith('688')) return 'sh';
    if (symbol.startsWith('000') || symbol.startsWith('001') || symbol.startsWith('002') || symbol.startsWith('003') || symbol.startsWith('300')) return 'sz';
    if (symbol.startsWith('920')) return 'bj';
    return 'unknown';
}

const EASTMONEY_URL = 'https://80.push2.eastmoney.com/api/qt/clist/get';

interface StockRow {
    symbol: string;
    name: string;
    pinyin: string;
    market: string;
}

function sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
}

const MAX_RETRIES = 5;

async function fetchWithRetry(page: number, pageSize: number, fs: string): Promise<{ items: any[]; total: number }> {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const url = `${EASTMONEY_URL}?pn=${page}&pz=${pageSize}&po=1&np=1&fltt=2&invt=2&fid=f3&fs=${fs}&fields=f12,f14`;

            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                    'Accept': '*/*',
                    'Accept-Language': 'zh-CN,zh;q=0.9',
                    'Referer': 'https://quote.eastmoney.com/',
                },
            });

            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const json: any = await response.json();
            if (!json.data?.diff) return { items: [], total: 0 };

            return { items: json.data.diff, total: json.data.total || 0 };
        } catch (err: any) {
            const delay = attempt * 3000;
            console.error(`[Seed] 第${page}页第${attempt}次重试失败: ${err.message}，等待${delay}ms...`);
            if (attempt < MAX_RETRIES) {
                await sleep(delay);
            } else {
                console.error(`[Seed] 第${page}页已重试${MAX_RETRIES}次，跳过`);
                return { items: [], total: 0 };
            }
        }
    }
    return { items: [], total: 0 };
}

async function fetchAllStocks(): Promise<StockRow[]> {
    const allStocks: StockRow[] = [];
    const pageSize = 500;

    const marketConfigs = [
        { fs: 'm:1+t:23', label: '沪市A股' },
        { fs: 'm:0+t:23', label: '深市A股' },
    ];

    for (const config of marketConfigs) {
        console.log(`[Seed] 正在获取${config.label}股票列表...`);

        const firstPage = await fetchWithRetry(1, pageSize, config.fs);
        if (firstPage.items.length === 0) {
            console.error(`[Seed] ${config.label}第1页获取失败，跳过`);
            continue;
        }

        const total = firstPage.total;
        const totalPages = Math.ceil(total / pageSize);
        console.log(`[Seed] ${config.label}共 ${total} 只，分 ${totalPages} 页`);

        for (const item of firstPage.items) {
            const symbol = String(item.f12 || '').trim();
            const name = String(item.f14 || '').trim();
            if (!symbol || !name || !/^\d{6}$/.test(symbol)) continue;
            const market = getStockMarket(symbol);
            if (market === 'unknown') continue;
            allStocks.push({ symbol, name, pinyin: name, market });
        }

        for (let page = 2; page <= totalPages; page++) {
            const { items } = await fetchWithRetry(page, pageSize, config.fs);

            for (const item of items) {
                const symbol = String(item.f12 || '').trim();
                const name = String(item.f14 || '').trim();
                if (!symbol || !name || !/^\d{6}$/.test(symbol)) continue;
                const market = getStockMarket(symbol);
                if (market === 'unknown') continue;
                allStocks.push({ symbol, name, pinyin: name, market });
            }

            console.log(`[Seed] ${config.label} ${page}/${totalPages} 页 (${items.length} 条)`);
            await sleep(1500);
        }
    }

    const seen = new Set<string>();
    return allStocks.filter(s => {
        if (seen.has(s.symbol)) return false;
        seen.add(s.symbol);
        return true;
    });
}

async function insertStocks(stocks: StockRow[]): Promise<void> {
    const batchSize = 200;

    for (let i = 0; i < stocks.length; i += batchSize) {
        const batch = stocks.slice(i, i + batchSize);
        const values: any[] = [];
        const placeholders: string[] = [];

        for (let j = 0; j < batch.length; j++) {
            const offset = j * 4;
            placeholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4})`);
            values.push(batch[j].symbol, batch[j].name, batch[j].pinyin, batch[j].market);
        }

        const sql = `
            INSERT INTO stocks (symbol, name, pinyin, market)
            VALUES ${placeholders.join(', ')}
            ON CONFLICT (symbol) DO UPDATE SET
                name = EXCLUDED.name,
                pinyin = EXCLUDED.pinyin,
                market = EXCLUDED.market
        `;

        try {
            await pool.query(sql, values);
            console.log(`[Seed] 插入 ${Math.min(i + batchSize, stocks.length)}/${stocks.length}`);
        } catch (err: any) {
            console.error(`[Seed] 批量插入失败: ${err.message}`);
        }

        await sleep(100);
    }
}

async function main(): Promise<void> {
    console.log('[Seed] 开始获取全量 A 股列表...');

    const stocks = await fetchAllStocks();
    console.log(`[Seed] 共获取 ${stocks.length} 只股票`);

    if (stocks.length === 0) {
        console.error('[Seed] 未获取到任何股票数据，退出');
        process.exit(1);
    }

    console.log('[Seed] 开始写入数据库...');
    await insertStocks(stocks);

    const result = await pool.query('SELECT COUNT(*) as count FROM stocks');
    console.log(`[Seed] 完成！stocks 表现有 ${result.rows[0].count} 条记录`);

    await pool.end();
}

main().catch(err => {
    console.error('[Seed] Fatal:', err);
    process.exit(1);
});
