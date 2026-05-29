import dotenv from 'dotenv';
dotenv.config();

import { getStockIdentity } from '../src/utils/stock';
import * as fs from 'fs';
import * as path from 'path';

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

const MAX_RETRIES = 3;

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
            console.error(`[Gen] 第${page}页第${attempt}次重试失败: ${err.message}`);
            if (attempt < MAX_RETRIES) {
                await sleep(attempt * 2000);
            } else {
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
        console.log(`[Gen] 正在获取${config.label}股票列表...`);

        const firstPage = await fetchWithRetry(1, pageSize, config.fs);
        if (firstPage.items.length === 0) {
            console.error(`[Gen] ${config.label}第1页获取失败，跳过`);
            continue;
        }

        const total = firstPage.total;
        const totalPages = Math.ceil(total / pageSize);
        console.log(`[Gen] ${config.label}共 ${total} 只，分 ${totalPages} 页`);

        for (const item of firstPage.items) {
            const symbol = String(item.f12 || '').trim();
            const name = String(item.f14 || '').trim();
            if (!symbol || !name || !/^\d{6}$/.test(symbol)) continue;
            const identity = getStockIdentity(symbol);
            if (identity.market === 'unknown') continue;
            allStocks.push({ symbol, name, pinyin: name, market: identity.market });
        }

        for (let page = 2; page <= totalPages; page++) {
            const { items } = await fetchWithRetry(page, pageSize, config.fs);

            for (const item of items) {
                const symbol = String(item.f12 || '').trim();
                const name = String(item.f14 || '').trim();
                if (!symbol || !name || !/^\d{6}$/.test(symbol)) continue;
                const identity = getStockIdentity(symbol);
                if (identity.market === 'unknown') continue;
                allStocks.push({ symbol, name, pinyin: name, market: identity.market });
            }

            console.log(`[Gen] ${config.label} ${page}/${totalPages} 页 (${items.length} 条)`);
            await sleep(800);
        }
    }

    const seen = new Set<string>();
    return allStocks.filter(s => {
        if (seen.has(s.symbol)) return false;
        seen.add(s.symbol);
        return true;
    });
}

function escapeSql(str: string): string {
    return str.replace(/'/g, "''");
}

function generateSql(stocks: StockRow[]): string {
    const lines: string[] = [
        '-- A股股票列表种子数据',
        `-- 生成时间: ${new Date().toISOString()}`,
        `-- 共 ${stocks.length} 只股票`,
        '',
        'INSERT INTO stocks (symbol, name, pinyin, market) VALUES',
    ];

    const values = stocks.map(s =>
        `  ('${escapeSql(s.symbol)}', '${escapeSql(s.name)}', '${escapeSql(s.pinyin)}', '${escapeSql(s.market)}')`
    );

    lines.push(values.join(',\n'));
    lines.push('ON CONFLICT (symbol) DO UPDATE SET');
    lines.push('  name = EXCLUDED.name,');
    lines.push('  pinyin = EXCLUDED.pinyin,');
    lines.push('  market = EXCLUDED.market;');
    lines.push('');

    return lines.join('\n');
}

async function main(): Promise<void> {
    console.log('[Gen] 在本地获取全量 A 股列表...');

    const stocks = await fetchAllStocks();
    console.log(`[Gen] 共获取 ${stocks.length} 只股票`);

    if (stocks.length === 0) {
        console.error('[Gen] 未获取到任何股票数据，退出');
        process.exit(1);
    }

    const sql = generateSql(stocks);
    const outputPath = path.resolve(__dirname, '002_seed_stocks.sql');
    fs.writeFileSync(outputPath, sql, 'utf-8');

    console.log(`[Gen] SQL 文件已生成: ${outputPath}`);
    console.log(`[Gen] 文件大小: ${(Buffer.byteLength(sql) / 1024).toFixed(1)} KB`);
    console.log('[Gen] 请将此文件上传到服务器后执行:');
    console.log('  docker exec -i pg psql -U root -d aistock < scripts/002_seed_stocks.sql');
}

main().catch(err => {
    console.error('[Gen] Fatal:', err);
    process.exit(1);
});
