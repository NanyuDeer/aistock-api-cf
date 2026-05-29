import { TenxScoreService, IndustryCache } from './TenxScoreService';
import * as TushareService from './TushareService';
import pool from '../db';

const PRIORITY_STOCKS = ['688205', '688008', '300058', '300136', '002050'];

interface RevenueCache {
    [symbol: string]: TushareService.IncomeRow[];
}

export class TenxBatchService {
    private static readonly BATCH_DELAY_MS = 2000;

    static async run(force: boolean = false): Promise<void> {
        const today = new Date().toISOString().slice(0, 10);

        const result = await pool.query('SELECT symbol FROM stocks');
        const allSymbols = result.rows.map((r: any) => r.symbol as string);

        if (!allSymbols.length) {
            console.log('[TenxBatch] 数据库中无股票数据，跳过');
            return;
        }

        const symbols = this.prioritizeSymbols(allSymbols);
        console.log(`[TenxBatch] 共${symbols.length}只股票待评分, date=${today}, force=${force}`);
        console.log(`[TenxBatch] 优先股票: ${symbols.slice(0, PRIORITY_STOCKS.length).join(', ')}`);

        const { industryCache, revenueCache } = await this.preloadIndustryData(symbols);
        console.log(`[TenxBatch] 行业数据缓存完成, 共${Object.keys(industryCache).length}个行业, 营收缓存${Object.keys(revenueCache).length}只股票`);

        let success = 0;
        let skipped = 0;
        let failed = 0;

        for (const symbol of symbols) {
            try {
                if (!force) {
                    const existing = await pool.query(
                        'SELECT 1 FROM tenx_scores WHERE symbol = $1 AND score_date = $2',
                        [symbol, today],
                    );
                    if (existing.rows.length > 0) { skipped++; continue; }
                }

                const scoreResult = await TenxScoreService.calculateTenxScore(symbol, industryCache, undefined, revenueCache);

                const rawDataJson = scoreResult.rawData ? JSON.stringify(scoreResult.rawData) : null;
                try {
                    await pool.query(`
                        INSERT INTO tenx_scores
                            (symbol, score_date, score, label, expected_multiple, description, ai_conclusion, dim_scores, indicators, raw_data, updated_at)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                        ON CONFLICT (symbol, score_date) DO UPDATE SET
                            score = EXCLUDED.score,
                            label = EXCLUDED.label,
                            expected_multiple = EXCLUDED.expected_multiple,
                            description = EXCLUDED.description,
                            ai_conclusion = EXCLUDED.ai_conclusion,
                            dim_scores = EXCLUDED.dim_scores,
                            indicators = EXCLUDED.indicators,
                            raw_data = EXCLUDED.raw_data,
                            updated_at = EXCLUDED.updated_at
                    `, [
                        symbol, today, scoreResult.score, scoreResult.label, scoreResult.expectedMultiple,
                        scoreResult.description, scoreResult.aiConclusion, JSON.stringify(scoreResult.dimScores),
                        JSON.stringify(scoreResult.dimensions), rawDataJson, scoreResult.updatedAt,
                    ]);
                } catch {
                    try {
                        await pool.query(`
                            INSERT INTO tenx_scores
                                (symbol, score_date, score, label, expected_multiple, description, ai_conclusion, dim_scores, indicators, updated_at)
                            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                            ON CONFLICT (symbol, score_date) DO UPDATE SET
                                score = EXCLUDED.score,
                                label = EXCLUDED.label,
                                expected_multiple = EXCLUDED.expected_multiple,
                                description = EXCLUDED.description,
                                ai_conclusion = EXCLUDED.ai_conclusion,
                                dim_scores = EXCLUDED.dim_scores,
                                indicators = EXCLUDED.indicators,
                                updated_at = EXCLUDED.updated_at
                        `, [
                            symbol, today, scoreResult.score, scoreResult.label, scoreResult.expectedMultiple,
                            scoreResult.description, scoreResult.aiConclusion, JSON.stringify(scoreResult.dimScores),
                            JSON.stringify(scoreResult.dimensions), scoreResult.updatedAt,
                        ]);
                    } catch {}
                }

                success++;
                console.log(`[TenxBatch] ${symbol} 评分完成: ${scoreResult.score}`);
                await this.sleep(this.BATCH_DELAY_MS);
            } catch (err: any) {
                failed++;
                console.error(`[TenxBatch] ${symbol} 评分失败:`, err?.message || err);
            }
        }

        console.log(`[TenxBatch] 完成: 成功=${success}, 跳过=${skipped}, 失败=${failed}`);
    }

    private static prioritizeSymbols(symbols: string[]): string[] {
        const prioritySet = new Set(PRIORITY_STOCKS);
        const priority = symbols.filter(s => prioritySet.has(s));
        const rest = symbols.filter(s => !prioritySet.has(s));
        return [...priority, ...rest];
    }

    private static async preloadIndustryData(symbols: string[]): Promise<{
        industryCache: IndustryCache;
        revenueCache: RevenueCache;
    }> {
        const industryCache: IndustryCache = {};
        const revenueCache: RevenueCache = {};

        const stockIndustryMap = new Map<string, { code: string; name: string }>();
        for (const symbol of symbols) {
            try {
                const industry = await TushareService.getStockIndustry(symbol);
                if (industry?.industry_code) {
                    stockIndustryMap.set(symbol, { code: industry.industry_code, name: industry.industry_name });
                }
            } catch {}
        }

        const industrySet = new Map<string, string>();
        for (const [, info] of stockIndustryMap) {
            if (!industrySet.has(info.code)) industrySet.set(info.code, info.name);
        }

        console.log(`[TenxBatch] 发现${industrySet.size}个行业, 开始预加载...`);

        for (const [industryCode, industryName] of industrySet) {
            try {
                let industry_boom = 50;
                try {
                    const twentyDaysAgo = new Date();
                    twentyDaysAgo.setDate(twentyDaysAgo.getDate() - 150);
                    const startDate = twentyDaysAgo.toISOString().slice(0, 10).replace(/-/g, '');
                    const daily = await TushareService.getIndexDaily(industryCode, startDate);
                    if (daily.length >= 2) {
                        const sorted = daily.sort((a, b) => a.trade_date.localeCompare(b.trade_date));
                        const first = sorted[0], last = sorted[sorted.length - 1];
                        if (first.close > 0) {
                            const pctChange = ((last.close / first.close) - 1) * 100;
                            industry_boom = Math.max(0, Math.min(100, 50 + pctChange * 2));
                        }
                    }
                } catch {}

                let members: string[] = [];
                try { members = await TushareService.getIndexMember(industryCode); } catch {}

                let totalRevenue = 0, prevRevenue = 0;
                const sampleSize = 20;
                const sample = members.length > sampleSize
                    ? members.filter((_, i) => i % Math.ceil(members.length / sampleSize) === 0)
                    : members;

                for (const sym of sample) {
                    if (revenueCache[sym]) continue;
                    try {
                        const twoYearsAgo = new Date();
                        twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 3);
                        const startDate = twoYearsAgo.toISOString().slice(0, 10).replace(/-/g, '');
                        const income = await TushareService.getIncome(sym, startDate);
                        revenueCache[sym] = income;
                        const annualReports = income
                            .filter(r => r.end_date && r.end_date.endsWith('1231') && r.total_revenue)
                            .sort((a, b) => b.end_date.localeCompare(a.end_date));
                        if (annualReports.length >= 2) {
                            totalRevenue += annualReports[0].total_revenue || 0;
                            prevRevenue += annualReports[1].total_revenue || 0;
                        }
                    } catch {}
                }

                const growthRate = prevRevenue > 0 ? ((totalRevenue / prevRevenue) - 1) * 100 : 0;
                let industry_penetration = 30;
                if (growthRate > 30) industry_penetration = 5 + (50 - Math.min(growthRate, 50)) / 50 * 10;
                else if (growthRate > 15) industry_penetration = 15 + (30 - growthRate) / 15 * 15;
                else if (growthRate > 5) industry_penetration = 30 + (15 - growthRate) / 10 * 20;
                else industry_penetration = 50 + (5 - Math.max(growthRate, 0)) / 5 * 30;

                let concentration = 40;
                if (members.length > 0) concentration = Math.min(80, Math.max(20, 100 - members.length * 0.8));

                industryCache[industryCode] = { industryName, industry_boom, industry_penetration, concentration, members };
                console.log(`[TenxBatch] 行业缓存: ${industryName}(${industryCode}), 成分股=${members.length}, 景气=${industry_boom.toFixed(0)}, 渗透率=${industry_penetration.toFixed(1)}%`);
            } catch (err: any) {
                console.error(`[TenxBatch] 行业缓存失败 ${industryCode}:`, err?.message || err);
            }
        }

        return { industryCache, revenueCache };
    }

    private static sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
