const TOKEN = '2876ea85cb005fb5fa17c809a98174f2d5aae8b1f830110a5ead6211';

async function tushareRequest(apiName, params) {
    const body = {
        api_name: apiName,
        token: TOKEN,
        params: params,
        fields: '',
    };

    const response = await fetch('https://api.tushare.pro', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const json = await response.json();
    if (json.code !== 0) throw new Error(`Tushare error: ${json.msg}`);
    return json.data;
}

function getStockMarket(symbol) {
    if (symbol.startsWith('600') || symbol.startsWith('601') || symbol.startsWith('603') || symbol.startsWith('688')) return 'sh';
    if (symbol.startsWith('000') || symbol.startsWith('001') || symbol.startsWith('002') || symbol.startsWith('003') || symbol.startsWith('300')) return 'sz';
    if (symbol.startsWith('920')) return 'bj';
    return 'unknown';
}

function escapeSql(str) {
    return str.replace(/'/g, "''");
}

async function main() {
    console.log('[Gen] 正在从 Tushare 获取 A 股列表...');

    const data = await tushareRequest('stock_basic', {
        exchange: '',
        list_status: 'L',
        fields: 'ts_code,symbol,name,area,industry,market',
    });

    if (!data.fields || !data.items) {
        console.error('[Gen] 返回数据格式异常');
        process.exit(1);
    }

    const { fields, items } = data;
    const symbolIdx = fields.indexOf('symbol');
    const nameIdx = fields.indexOf('name');

    if (symbolIdx === -1 || nameIdx === -1) {
        console.error('[Gen] 缺少必要字段');
        process.exit(1);
    }

    const stocks = [];
    for (const row of items) {
        const symbol = String(row[symbolIdx] || '').trim();
        const name = String(row[nameIdx] || '').trim();
        if (!symbol || !name || !/^\d{6}$/.test(symbol)) continue;
        const market = getStockMarket(symbol);
        if (market === 'unknown') continue;
        stocks.push({ symbol, name, pinyin: name, market });
    }

    console.log(`[Gen] 共获取 ${stocks.length} 只股票`);

    const lines = [
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

    const sql = lines.join('\n');
    const fs = await import('fs');
    const path = await import('path');
    const outputPath = path.resolve(import.meta.dirname || '.', '002_seed_stocks.sql');
    fs.writeFileSync(outputPath, sql, 'utf-8');

    console.log(`[Gen] SQL 文件已生成: ${outputPath}`);
    console.log(`[Gen] 文件大小: ${(Buffer.byteLength(sql) / 1024).toFixed(1)} KB`);
    console.log('[Gen] 上传到服务器后执行:');
    console.log('  docker exec -i pg psql -U root -d aistock < scripts/002_seed_stocks.sql');
}

main().catch(err => {
    console.error('[Gen] Fatal:', err);
    process.exit(1);
});
