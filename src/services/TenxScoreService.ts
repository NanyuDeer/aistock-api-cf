import * as TushareService from './TushareService';
import { EmService } from './EmInfoService';

interface DimDef {
    name: string;
    weight: number;
    indicators: { name: string; key: string }[];
}

const TENX_DIMS: DimDef[] = [
    { name: '成长性', weight: 20, indicators: [
        { name: '营收3年CAGR', key: 'rev_cagr' }, { name: '净利润3年CAGR', key: 'profit_cagr' },
        { name: '扣非净利3年CAGR', key: 'deducted_cagr' }, { name: '盈利质量提升(净利增速-营收增速)', key: 'profit_quality' },
    ]},
    { name: '盈利能力', weight: 15, indicators: [
        { name: 'ROE(3年均)', key: 'roe' }, { name: 'ROIC(3年均)', key: 'roic' },
        { name: '毛利率(3年均)', key: 'gross_margin' }, { name: '净利率(3年均)', key: 'net_margin' },
    ]},
    { name: '估值潜力', weight: 15, indicators: [
        { name: 'PEG', key: 'peg' }, { name: 'PE分位数(5年)', key: 'pe_pct' },
        { name: 'PB分位数(5年)', key: 'pb_pct' }, { name: '市值规模', key: 'market_cap' },
    ]},
    { name: '行业赛道', weight: 12, indicators: [
        { name: '行业景气指数', key: 'industry_boom' }, { name: '行业渗透率/市场空间', key: 'industry_penetration' },
        { name: '政策支持评分', key: 'policy_score' }, { name: '集中度提升空间', key: 'concentration' },
    ]},
    { name: '财务健康', weight: 12, indicators: [
        { name: '流动比率/速动比率', key: 'liquidity_ratio' }, { name: '利息保障倍数', key: 'interest_cover' },
        { name: '自由现金流(3年均)', key: 'fcf' }, { name: '资产负债率(反)', key: 'debt_ratio' },
    ]},
    { name: '竞争壁垒', weight: 12, indicators: [
        { name: '市占率', key: 'market_share' }, { name: '毛利率稳定性(3年)', key: 'margin_stability' },
        { name: '研发投入占比(3年均)', key: 'rd_ratio' }, { name: '无形资产占比(品牌/专利)', key: 'brand_patent' },
    ]},
    { name: '管理层治理', weight: 7, indicators: [
        { name: '大股东质押比(反)', key: 'pledge_ratio' }, { name: '高管增减持净比', key: 'holder_trade_ratio' },
        { name: '管理层持股比例', key: 'mgmt_share_ratio' }, { name: '分红率(3年均)', key: 'dividend_ratio' },
    ]},
    { name: '催化剂强度', weight: 7, indicators: [
        { name: '业绩加速信号', key: 'earnings_accel' }, { name: '订单/合同负债增速', key: 'contract_liab_growth' },
        { name: '分析师预期上修比例', key: 'analyst_upgrade_ratio' }, { name: '事件催化密度评分', key: 'event_catalyst_score' },
    ]},
];

function scoreByRange(value: number, ranges: [number, number][]): number {
    if (value >= ranges[0][0]) return ranges[0][1];
    for (let i = 1; i < ranges.length; i++) {
        if (value >= ranges[i][0]) {
            const ratio = (value - ranges[i][0]) / (ranges[i - 1][0] - ranges[i][0]);
            return Math.round(ranges[i][1] + ratio * (ranges[i - 1][1] - ranges[i][1]));
        }
    }
    return ranges[ranges.length - 1][1];
}

const SCORE_MAPS: Record<string, [number, number][]> = {
    rev_cagr: [[30, 90], [20, 70], [10, 50], [0, 20]],
    profit_cagr: [[30, 90], [20, 70], [10, 50], [0, 20]],
    deducted_cagr: [[30, 90], [20, 70], [10, 50], [0, 20]],
    profit_quality: [[20, 90], [10, 70], [0, 50], [-10, 20]],
    roe: [[20, 90], [15, 70], [10, 50], [0, 20]],
    roic: [[15, 90], [10, 70], [5, 50], [0, 20]],
    gross_margin: [[50, 90], [35, 70], [20, 50], [0, 20]],
    net_margin: [[20, 90], [12, 70], [5, 50], [0, 20]],
    peg: [[0.5, 90], [0.8, 70], [1.2, 50], [2.0, 20]],
    pe_pct: [[10, 90], [25, 70], [50, 50], [80, 20]],
    pb_pct: [[10, 90], [25, 70], [50, 50], [80, 20]],
    market_cap: [[0, 95], [50, 90], [200, 70], [500, 50], [1000, 20]],
    industry_boom: [[80, 90], [60, 70], [40, 50], [0, 20]],
    industry_penetration: [[3, 95], [5, 90], [15, 70], [30, 50], [60, 20]],
    policy_score: [[5, 90], [3, 70], [1, 50], [0, 20]],
    concentration: [[20, 90], [35, 70], [50, 50], [70, 20]],
    liquidity_ratio: [[2.0, 90], [1.5, 70], [1.0, 50], [0, 20]],
    interest_cover: [[8, 90], [5, 70], [3, 50], [1, 20]],
    fcf: [[10, 90], [0, 70], [-5, 50], [-20, 20]],
    debt_ratio: [[30, 90], [45, 70], [60, 50], [80, 20]],
    market_share: [[20, 90], [10, 70], [5, 50], [0, 20]],
    margin_stability: [[0, 90], [1, 90], [3, 70], [5, 50], [10, 20]],
    rd_ratio: [[15, 90], [10, 70], [5, 50], [0, 20]],
    brand_patent: [[30, 90], [15, 70], [5, 50], [0, 20]],
    pledge_ratio: [[0, 90], [5, 90], [15, 70], [30, 50], [50, 20]],
    holder_trade_ratio: [[2, 90], [0, 70], [-0.5, 60], [-2, 50], [-5, 20]],
    mgmt_share_ratio: [[15, 90], [8, 70], [3, 50], [0, 20]],
    dividend_ratio: [[30, 90], [20, 85], [40, 70], [60, 40], [0, 30]],
    earnings_accel: [[20, 90], [10, 70], [0, 50], [-10, 30], [-30, 20]],
    contract_liab_growth: [[40, 90], [20, 70], [5, 50], [0, 40], [-20, 20]],
    analyst_upgrade_ratio: [[70, 90], [50, 70], [30, 50], [0, 20]],
    event_catalyst_score: [[80, 90], [60, 70], [40, 50], [0, 20]],
};

function avg(nums: number[]): number { if (!nums.length) return 0; return nums.reduce((a, b) => a + b, 0) / nums.length; }
function cagr(startVal: number, endVal: number, years: number): number { if (startVal <= 0 || endVal <= 0 || years <= 0) return 0; return Math.pow(endVal / startVal, 1 / years) - 1; }
function percentile(arr: number[], value: number): number { if (!arr.length) return 50; const sorted = [...arr].sort((a, b) => a - b); let count = 0; for (const v of sorted) { if (v <= value) count++; else break; } return Math.round((count / sorted.length) * 100); }

function formatValue(key: string, raw: number | string | null): string {
    if (raw === null || raw === undefined) return '-';
    if (typeof raw === 'string') return raw;
    const pctKeys = new Set(['rev_cagr', 'profit_cagr', 'deducted_cagr', 'profit_quality', 'roe', 'roic', 'gross_margin', 'net_margin', 'debt_ratio', 'market_share', 'rd_ratio', 'pledge_ratio', 'holder_trade_ratio', 'mgmt_share_ratio', 'dividend_ratio', 'earnings_accel', 'contract_liab_growth', 'analyst_upgrade_ratio', 'industry_penetration', 'brand_patent']);
    const pctileKeys = new Set(['pe_pct', 'pb_pct', 'concentration']);
    if (pctKeys.has(key)) return raw.toFixed(1) + '%';
    if (pctileKeys.has(key)) return Math.round(raw) + '%';
    if (key === 'peg') return raw.toFixed(2);
    if (key === 'liquidity_ratio') return raw.toFixed(2);
    if (key === 'interest_cover') return raw.toFixed(1) + 'x';
    if (key === 'fcf') return (raw >= 0 ? '+' : '') + raw.toFixed(1) + '亿';
    if (key === 'margin_stability') return raw.toFixed(1) + 'pp';
    if (key === 'market_cap') return raw.toFixed(0) + '亿';
    if (key === 'policy_score' || key === 'industry_boom' || key === 'event_catalyst_score') return Math.round(raw).toString();
    return raw.toFixed(2);
}

interface RawIndicators { [key: string]: number | string | null | undefined; stockName?: string; }

export interface IndustryCache { [industryCode: string]: { industryName: string; industry_boom: number; industry_penetration: number; concentration: number; members: string[]; }; }
interface PrefetchedData {
    income: TushareService.IncomeRow[]; fina: TushareService.FinaIndicatorRow[]; cashflow: TushareService.CashflowRow[];
    balance: TushareService.BalanceSheetRow[]; daily: TushareService.DailyBasicRow[]; pledge: TushareService.PledgeRow[];
    holdertrade: TushareService.HolderTradeRow[]; managers: TushareService.StkManagerRow[]; dividend: TushareService.DividendRow[];
    top10: TushareService.Top10HolderRow[]; industry: { ts_code: string; industry_name: string; industry_code: string } | null;
}
interface RevenueCache { [symbol: string]: TushareService.IncomeRow[]; }

async function prefetchAllData(symbol: string): Promise<PrefetchedData> {
    const threeYearsAgo = new Date(); threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 4);
    const startDate = threeYearsAgo.toISOString().slice(0, 10).replace(/-/g, '');
    const fiveYearsAgo = new Date(); fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5);
    const startDate5y = fiveYearsAgo.toISOString().slice(0, 10).replace(/-/g, '');
    const emptyArr: any[] = [];
    const catchEmpty = (label: string) => (e: any) => { console.warn(`[TenxScore] ${label} failed:`, e?.message); return emptyArr; };

    const [income, fina, cashflow, balance, daily, pledge, holdertrade, managers, dividend] = await Promise.all([
        TushareService.getIncome(symbol, startDate).catch(catchEmpty('getIncome')),
        TushareService.getFinaIndicator(symbol, startDate).catch(catchEmpty('getFinaIndicator')),
        TushareService.getCashflow(symbol, startDate).catch(catchEmpty('getCashflow')),
        TushareService.getBalanceSheet(symbol, startDate).catch(catchEmpty('getBalanceSheet')),
        TushareService.getDailyBasic(symbol, startDate5y).catch(catchEmpty('getDailyBasic')),
        TushareService.getPledgeDetail(symbol).catch(catchEmpty('getPledgeDetail')),
        TushareService.getStkHoldertrade(symbol, startDate).catch(catchEmpty('getStkHoldertrade')),
        TushareService.getStkManagers(symbol).catch(catchEmpty('getStkManagers')),
        TushareService.getDividend(symbol).catch(catchEmpty('getDividend')),
    ]);
    const [top10, industry] = await Promise.all([
        TushareService.getTop10Holders(symbol).catch(catchEmpty('getTop10Holders')),
        TushareService.getStockIndustry(symbol).catch(e => { console.warn('[TenxScore] getStockIndustry failed:', e?.message); return null; }) as Promise<any>,
    ]);
    return { income: income as any[], fina: fina as any[], cashflow: cashflow as any[], balance: balance as any[], daily: daily as any[], pledge: pledge as any[], holdertrade: holdertrade as any[], managers: managers as any[], dividend: dividend as any[], top10: top10 as any[], industry };
}

async function prefetchDynamicData(symbol: string, cached: PrefetchedData): Promise<PrefetchedData> {
    const fiveYearsAgo = new Date(); fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5);
    const startDate5y = fiveYearsAgo.toISOString().slice(0, 10).replace(/-/g, '');
    const threeYearsAgo = new Date(); threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 4);
    const startDate = threeYearsAgo.toISOString().slice(0, 10).replace(/-/g, '');
    const emptyArr: any[] = [];
    const catchEmpty = (label: string) => (e: any) => { console.warn(`[TenxScore] ${label} failed:`, e?.message); return emptyArr; };
    const [daily, pledge, holdertrade] = await Promise.all([
        TushareService.getDailyBasic(symbol, startDate5y).catch(catchEmpty('getDailyBasic(quick)')),
        TushareService.getPledgeDetail(symbol).catch(catchEmpty('getPledgeDetail(quick)')),
        TushareService.getStkHoldertrade(symbol, startDate).catch(catchEmpty('getStkHoldertrade(quick)')),
    ]);
    return { income: cached.income, fina: cached.fina, cashflow: cached.cashflow, balance: cached.balance, daily: daily as any[], pledge: pledge as any[], holdertrade: holdertrade as any[], managers: cached.managers, dividend: cached.dividend, top10: cached.top10, industry: cached.industry };
}

function calcGrowthData(data: PrefetchedData): RawIndicators {
    const income = data.income;
    const annualReports = income.filter(r => r.end_date && r.end_date.endsWith('1231') && r.total_revenue).sort((a, b) => a.end_date.localeCompare(b.end_date)).slice(-4);
    let rev_cagr = 0, profit_cagr = 0, deducted_cagr = 0, profit_quality = 0;
    if (annualReports.length >= 2) {
        const first = annualReports[0], last = annualReports[annualReports.length - 1], years = annualReports.length - 1;
        if (first.total_revenue > 0 && last.total_revenue > 0) rev_cagr = cagr(first.total_revenue, last.total_revenue, years) * 100;
        else if (first.total_revenue > 0) rev_cagr = ((last.total_revenue / first.total_revenue) - 1) * 100 / years;
        if (first.n_income > 0 && last.n_income > 0) profit_cagr = cagr(first.n_income, last.n_income, years) * 100;
        else if (first.n_income > 0) profit_cagr = ((last.n_income / first.n_income) - 1) * 100 / years;
        else if (first.n_income < 0 && last.n_income < 0) profit_cagr = ((first.n_income - last.n_income) / Math.abs(first.n_income)) * 100 / years;
        else if (first.n_income < 0 && last.n_income > 0) profit_cagr = 100;
        const firstDp = first.n_income_attr_p, lastDp = last.n_income_attr_p;
        if (firstDp && firstDp > 0 && lastDp && lastDp > 0) deducted_cagr = cagr(firstDp, lastDp, years) * 100;
        else if (firstDp && firstDp > 0 && lastDp !== undefined) deducted_cagr = ((lastDp / firstDp) - 1) * 100 / years;
        else if (firstDp && firstDp < 0 && lastDp && lastDp < 0) deducted_cagr = ((firstDp - lastDp) / Math.abs(firstDp)) * 100 / years;
        else if (firstDp && firstDp < 0 && lastDp && lastDp > 0) deducted_cagr = 100;
        const latest = annualReports[annualReports.length - 1], prev = annualReports[annualReports.length - 2];
        let revGrowth = 0; if (prev.total_revenue > 0) revGrowth = ((latest.total_revenue / prev.total_revenue) - 1) * 100;
        let profitGrowth = 0; if (prev.n_income > 0 && latest.n_income > 0) profitGrowth = ((latest.n_income / prev.n_income) - 1) * 100; else if (prev.n_income < 0 && latest.n_income > 0) profitGrowth = 100;
        profit_quality = profitGrowth - revGrowth;
    }
    return { rev_cagr, profit_cagr, deducted_cagr, profit_quality };
}

function calcProfitabilityData(data: PrefetchedData): RawIndicators {
    const annualFina = data.fina.filter(r => r.end_date && r.end_date.endsWith('1231')).sort((a, b) => b.end_date.localeCompare(a.end_date)).slice(0, 3);
    return { roe: avg(annualFina.map(r => r.roe || 0)), roic: avg(annualFina.map(r => r.roic || 0)), gross_margin: avg(annualFina.map(r => r.grossprofit_margin || 0)), net_margin: avg(annualFina.map(r => r.netprofit_margin || 0)) };
}

function calcValuationData(data: PrefetchedData, profitCagr: number): RawIndicators {
    const daily = data.daily;
    const peArr = daily.map(r => r.pe).filter((v): v is number => v !== null && v > 0);
    const pbArr = daily.map(r => r.pb).filter((v): v is number => v !== null && v > 0);
    const currentPE = peArr.length > 0 ? peArr[peArr.length - 1] : 0;
    const currentPB = pbArr.length > 0 ? pbArr[pbArr.length - 1] : 0;
    const pe_pct = peArr.length > 0 ? percentile(peArr, currentPE) : 50;
    const pb_pct = pbArr.length > 0 ? percentile(pbArr, currentPB) : 50;
    const latestDaily = daily.length > 0 ? daily[daily.length - 1] : null;
    const total_mv = latestDaily?.total_mv;
    const market_cap = total_mv ? total_mv / 10000 : 0;
    let peg = 99; if (currentPE > 0 && profitCagr > 0) peg = currentPE / profitCagr;
    return { peg, pe_pct, pb_pct, market_cap };
}

function calcFinancialHealthData(data: PrefetchedData): RawIndicators {
    const { fina, income, cashflow } = data;
    const latestFina = fina.filter(r => r.end_date && r.end_date.endsWith('1231')).sort((a, b) => b.end_date.localeCompare(a.end_date))[0];
    const current_ratio = latestFina?.current_ratio || 0;
    const quick_ratio = latestFina?.quick_ratio || 0;
    const liquidity_ratio = quick_ratio > 0 ? current_ratio * 0.4 + quick_ratio * 0.6 : current_ratio;
    const debt_ratio = latestFina?.debt_to_assets || 0;
    const latestIncome = income.filter(r => r.end_date && r.end_date.endsWith('1231')).sort((a, b) => b.end_date.localeCompare(a.end_date))[0];
    let interest_cover = 0;
    if (latestIncome?.int_exp && latestIncome.int_exp > 0) { const ebit = (latestIncome.total_profit || 0) + latestIncome.int_exp; interest_cover = ebit / latestIncome.int_exp; }
    else if (!latestIncome?.int_exp || latestIncome.int_exp === 0) interest_cover = 20;
    const annualCashflow = cashflow.filter(r => r.end_date && r.end_date.endsWith('1231')).sort((a, b) => b.end_date.localeCompare(a.end_date)).slice(0, 3);
    const fcfValues = annualCashflow.map(r => ((r.n_cashflow_act || 0) - Math.abs(r.c_pay_for_fix_assets || 0)) / 1e8);
    const fcf = avg(fcfValues);
    return { liquidity_ratio, interest_cover, fcf, debt_ratio };
}

function calcGovernanceData(data: PrefetchedData): RawIndicators {
    const { pledge, holdertrade, managers, dividend, income, daily, top10 } = data;
    let pledge_ratio = 0;
    if (pledge.length > 0) { const latestPledge = pledge.sort((a, b) => (b.end_date || '').localeCompare(a.end_date || ''))[0]; pledge_ratio = latestPledge?.pledge_ratio || 0; }
    let holder_trade_ratio = 0;
    const execTrades = holdertrade.filter(r => r.holder_type === 'G' || r.holder_type === 'M');
    if (execTrades.length > 0) { const totalBuyRatio = execTrades.filter(r => r.in_de === 'IN').reduce((s, r) => s + (r.change_ratio || 0), 0); const totalSellRatio = execTrades.filter(r => r.in_de === 'DE').reduce((s, r) => s + (r.change_ratio || 0), 0); holder_trade_ratio = totalBuyRatio - totalSellRatio; }
    let mgmt_share_ratio = 0;
    if (top10.length > 0 && managers.length > 0) {
        const latestPeriod = top10.reduce((a, b) => (a.end_date > b.end_date ? a : b)).end_date;
        const latestHolders = top10.filter(r => r.end_date === latestPeriod);
        const mgmtNames = managers.map(m => m.name);
        for (const holder of latestHolders) { const matched = mgmtNames.some(name => holder.holder_name === name || holder.holder_name.includes(name) || name.includes(holder.holder_name)); if (matched) mgmt_share_ratio += holder.hold_ratio || 0; }
    }
    let dividend_ratio = 0;
    const recentDividends = dividend.filter(r => (r.div_proc === '实施' || r.div_proc === '实施方案') && r.cash_div && r.cash_div > 0).sort((a, b) => (b.end_date || '').localeCompare(a.end_date || ''));
    const seenYears = new Set<string>();
    const uniqueDividends = recentDividends.filter(r => { const year = (r.end_date || '').substring(0, 4); if (seenYears.has(year)) return false; seenYears.add(year); return true; }).slice(0, 3);
    if (uniqueDividends.length > 0) {
        const annualIncome = income.filter(r => r.end_date && r.end_date.endsWith('1231') && r.n_income).sort((a, b) => b.end_date.localeCompare(a.end_date)).slice(0, 3);
        const dividendRatios: number[] = [];
        for (const div of uniqueDividends) { const divYear = (div.end_date || '').substring(0, 4); const matchingIncome = annualIncome.find(inc => (inc.end_date || '').startsWith(divYear)); if (!matchingIncome) continue; const cashDivPerShare = div.cash_div || 0; const eps = matchingIncome.basic_eps || 0; if (eps > 0 && cashDivPerShare > 0) dividendRatios.push((cashDivPerShare / eps) * 100); }
        if (dividendRatios.length > 0) dividend_ratio = avg(dividendRatios);
        else { const latestAnnual = annualIncome[0]; if (latestAnnual?.total_revenue && latestAnnual.revenue_ps && latestAnnual.revenue_ps > 0) { const totalShares = latestAnnual.total_revenue / latestAnnual.revenue_ps; const totalProfit = annualIncome.reduce((s, r) => s + (r.n_income || 0), 0); const totalCashDiv = uniqueDividends.reduce((s, r) => s + (r.cash_div || 0), 0) * totalShares; if (totalProfit > 0) dividend_ratio = (totalCashDiv / totalProfit) * 100; } }
    }
    return { pledge_ratio, holder_trade_ratio, mgmt_share_ratio, dividend_ratio };
}

const policyMap: Record<string, number> = {
    '半导体': 5, '芯片': 5, '人工智能': 5, '新能源': 5, '储能': 5, '信创': 5, '数字经济': 5, '机器人': 5, '量子': 5, '脑机': 5,
    '光伏': 4, '军工': 4, '航天': 4, '创新药': 4, '电池': 4, '风电': 4, '氢能': 4, '软件': 4, '云计算': 4, '大数据': 4, '网络安全': 4, '生物': 4, '基因': 4, '航空': 4, '新材料': 4, '稀土': 4, '碳中和': 4, '环保': 4, '核电': 4, '卫星': 4,
    '医疗器械': 3, '消费电子': 3, '汽车': 3, '物联网': 3, '通信': 3, '5G': 3, '半导体材料': 3, '显示': 3, '面板': 3, '智能家居': 3, '工业互联': 3, '智能制造': 3, '特高压': 3, '宠物': 3, '医美': 3, '养老': 3, '体育': 3, '文化': 3, '教育': 3, '游戏': 3, '影视': 3, '食品': 3, '饮料': 3, '家电': 3, '建材': 3, '装饰': 3, '农业': 3, '种业': 3,
    '银行': 2, '保险': 2, '证券': 2, '地产': 2, '钢铁': 2, '煤炭': 2, '石油': 2, '化工': 2, '有色': 2, '港口': 2, '公路': 2, '铁路': 2, '电力': 2, '水务': 2, '燃气': 2,
    '教培': 1, '高耗能': 1,
};

async function calcIndustryData(symbol: string, data: PrefetchedData, industryCache?: IndustryCache, revenueCache?: RevenueCache): Promise<RawIndicators> {
    let industryCode = data.industry?.industry_code || '';
    let industryName = data.industry?.industry_name || '';
    if (industryCode && industryCache?.[industryCode]) {
        const cached = industryCache[industryCode];
        let policy_score = 2; for (const [keyword, score] of Object.entries(policyMap)) { if (cached.industryName.includes(keyword)) { policy_score = score; break; } }
        return { industry_boom: cached.industry_boom, industry_penetration: cached.industry_penetration, policy_score, concentration: cached.concentration };
    }
    let industry_boom = 50;
    if (industryCode) { try { const longAgo = new Date(); longAgo.setDate(longAgo.getDate() - 150); const startDate = longAgo.toISOString().slice(0, 10).replace(/-/g, ''); const daily = await TushareService.getIndexDaily(industryCode, startDate); if (daily.length >= 10) { const sorted = daily.sort((a, b) => a.trade_date.localeCompare(b.trade_date)); const first = sorted[0], last = sorted[sorted.length - 1]; if (first.close > 0) { const pctChange = ((last.close / first.close) - 1) * 100; industry_boom = Math.max(0, Math.min(100, 50 + pctChange * 2)); } } } catch {} }
    let industry_penetration = 30;
    if (industryCode) { try { const revGrowth = await TushareService.getIndustryRevenueGrowth(industryCode); const growthRate = revGrowth.growthRate; if (growthRate > 30) industry_penetration = 5 + (50 - Math.min(growthRate, 50)) / 50 * 10; else if (growthRate > 15) industry_penetration = 15 + (30 - growthRate) / 15 * 15; else if (growthRate > 5) industry_penetration = 30 + (15 - growthRate) / 10 * 20; else industry_penetration = 50 + (5 - Math.max(growthRate, 0)) / 5 * 30; } catch {} }
    let policy_score = 2; for (const [keyword, score] of Object.entries(policyMap)) { if (industryName.includes(keyword)) { policy_score = score; break; } }
    let concentration = 40;
    if (industryCode) { try { const members = await TushareService.getIndexMember(industryCode); if (members.length > 0) { const twoYearsAgo = new Date(); twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 3); const startDate = twoYearsAgo.toISOString().slice(0, 10).replace(/-/g, ''); const sample = members.length > 30 ? members.filter((_, i) => i % Math.ceil(members.length / 30) === 0) : members; const revenues: { symbol: string; revenue: number }[] = []; for (const sym of sample) { try { let symIncome: any[]; if (revenueCache?.[sym]) symIncome = revenueCache[sym]; else symIncome = await TushareService.getIncome(sym, startDate); const symAnnual = symIncome.filter(r => r.end_date && r.end_date.endsWith('1231') && r.total_revenue).sort((a, b) => b.end_date.localeCompare(a.end_date)); if (symAnnual[0]?.total_revenue) revenues.push({ symbol: sym, revenue: symAnnual[0].total_revenue }); } catch {} } if (revenues.length >= 5) { revenues.sort((a, b) => b.revenue - a.revenue); const top5Revenue = revenues.slice(0, 5).reduce((s, r) => s + r.revenue, 0); const totalRevenue = revenues.reduce((s, r) => s + r.revenue, 0); if (totalRevenue > 0) concentration = (top5Revenue / totalRevenue) * 100; } } } catch {} }
    if (industryCode && industryCache) industryCache[industryCode] = { industryName, industry_boom, industry_penetration, concentration, members: [] };
    return { industry_boom, industry_penetration, policy_score, concentration };
}

async function calcMoatData(symbol: string, data: PrefetchedData, industryCache?: IndustryCache, revenueCache?: RevenueCache): Promise<RawIndicators> {
    const { fina, income, balance } = data;
    const threeYearsAgo = new Date(); threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 4);
    const startDate = threeYearsAgo.toISOString().slice(0, 10).replace(/-/g, '');
    let market_share = 5;
    try { let members: string[] = []; const industryCode = data.industry?.industry_code; if (industryCode) { if (industryCache?.[industryCode]) members = industryCache[industryCode].members; else members = await TushareService.getIndexMember(industryCode); if (members.length > 0) { const annualIncome = income.filter(r => r.end_date && r.end_date.endsWith('1231') && r.total_revenue).sort((a, b) => b.end_date.localeCompare(a.end_date)); const latestRevenue = annualIncome[0]?.total_revenue || 0; if (latestRevenue > 0) { const sample = members.length > 20 ? members.filter((_, i) => i % Math.ceil(members.length / 20) === 0) : members; const revenues: number[] = [latestRevenue]; for (const sym of sample) { if (sym === symbol) continue; try { let symIncome: any[]; if (revenueCache?.[sym]) symIncome = revenueCache[sym]; else symIncome = await TushareService.getIncome(sym, startDate); const symAnnual = symIncome.filter(r => r.end_date && r.end_date.endsWith('1231') && r.total_revenue).sort((a, b) => b.end_date.localeCompare(a.end_date)); if (symAnnual[0]?.total_revenue) revenues.push(symAnnual[0].total_revenue); } catch {} } revenues.sort((a, b) => b - a); if (revenues.length > 0 && latestRevenue > 0) { const totalIndustryRev = revenues.reduce((s, v) => s + v, 0); market_share = (latestRevenue / totalIndustryRev) * 100; } } } } } catch {}
    const annualFina = fina.filter(r => r.end_date && r.end_date.endsWith('1231') && r.grossprofit_margin).sort((a, b) => b.end_date.localeCompare(a.end_date)).slice(0, 3);
    let margin_stability = 5; if (annualFina.length >= 2) { const margins = annualFina.map(r => r.grossprofit_margin || 0); const mean = avg(margins); const variance = avg(margins.map(m => Math.pow(m - mean, 2))); margin_stability = Math.sqrt(variance); }
    const annualIncome = income.filter(r => r.end_date && r.end_date.endsWith('1231')).sort((a, b) => b.end_date.localeCompare(a.end_date)).slice(0, 3);
    let rd_ratio = 0; if (annualIncome.length > 0) { const rdRatios: number[] = []; for (const r of annualIncome) { if (r.total_revenue && r.total_revenue > 0 && r.rd_exp) rdRatios.push((r.rd_exp / r.total_revenue) * 100); } if (rdRatios.length > 0) rd_ratio = avg(rdRatios); }
    let brand_patent = 0; const annualBalance = balance.filter(r => r.end_date && r.end_date.endsWith('1231')).sort((a, b) => b.end_date.localeCompare(a.end_date)).slice(0, 3);
    if (annualBalance.length > 0) { const ratios: number[] = []; for (const r of annualBalance) { const equity = r.total_hldr_eqy_exc_min_int || r.total_assets - r.total_liab; if (equity && equity > 0) { const intangible = r.intan_assets || 0; ratios.push((intangible / equity) * 100); } } if (ratios.length > 0) brand_patent = avg(ratios); }
    return { market_share, margin_stability, rd_ratio, brand_patent };
}

async function calcCatalystData(symbol: string, data: PrefetchedData): Promise<RawIndicators> {
    const { income, balance } = data;
    let earnings_accel = 0;
    const annualReports = income.filter(r => r.end_date && r.end_date.endsWith('1231') && r.n_income_attr_p).sort((a, b) => b.end_date.localeCompare(a.end_date)).slice(0, 3);
    if (annualReports.length >= 3) {
        const latest = annualReports[0].n_income_attr_p || 0, prev = annualReports[1].n_income_attr_p || 0, prevPrev = annualReports[2].n_income_attr_p || 0;
        let recentGrowth = 0; if (prev > 0) recentGrowth = ((latest / prev) - 1) * 100; else if (prev < 0 && latest > 0) recentGrowth = 100;
        let prevGrowth = 0; if (prevPrev > 0) prevGrowth = ((prev / prevPrev) - 1) * 100; else if (prevPrev < 0 && prev > 0) prevGrowth = 100;
        earnings_accel = recentGrowth - prevGrowth;
    }
    let contract_liab_growth = 0;
    const annualBalance = balance.filter(r => r.end_date && r.end_date.endsWith('1231') && r.contract_liab !== null && r.contract_liab !== undefined).sort((a, b) => b.end_date.localeCompare(a.end_date)).slice(0, 2);
    if (annualBalance.length >= 2) { const latest = annualBalance[0].contract_liab || 0, prev = annualBalance[1].contract_liab || 0; if (prev > 0) contract_liab_growth = ((latest / prev) - 1) * 100; }
    let analyst_upgrade_ratio = 0;
    try { const { ThsService } = await import('./ThsService'); const forecast = await ThsService.getProfitForecast(symbol); const detailTable = forecast['业绩预测详表_详细指标预测']; if (Array.isArray(detailTable) && detailTable.length > 0) { let upgrade = 0, total = 0; for (const row of detailTable) { if (row['预测机构'] || row['机构名称']) { total++; const action = row['评级'] || row['调整方向'] || ''; if (action.includes('上调') || action.includes('增持') || action.includes('买入')) upgrade++; } } if (total > 0) analyst_upgrade_ratio = (upgrade / total) * 100; } } catch {}
    let event_catalyst_score = 0;
    try { const { ClsStockNewsService } = await import('./ClsStockNewsService'); const newsResult = await ClsStockNewsService.getStockNews(symbol, { limit: 20, lastTime: 0 }); const recentCount = newsResult.items?.length || 0; const catalystKeywords = ['签约', '中标', '获批', '量产', '突破', '合作', '收购', '并购', '新品', '发布', '订单', '扩产', '投产', '上市', '获批', '授权', '认证', '首发', '落地', '交付']; let catalystCount = 0; for (const item of (newsResult.items || [])) { const text = (item.title || '') + (item.content || ''); if (catalystKeywords.some(kw => text.includes(kw))) catalystCount++; } const newsScore = Math.min(50, recentCount * 3); const catalystDensity = recentCount > 0 ? (catalystCount / recentCount) * 50 : 0; event_catalyst_score = Math.min(100, newsScore + catalystDensity); } catch {}
    return { earnings_accel, contract_liab_growth, analyst_upgrade_ratio, event_catalyst_score };
}

export interface TenxScoreResult {
    score: number; label: string; expectedMultiple: string; description: string; aiConclusion: string;
    dimensions: { name: string; weight: number; score: number; indicators: { name: string; key: string; value: string; score: number; }[]; }[];
    dimScores: number[]; rawData?: PrefetchedData; updatedAt: string;
}

export class TenxScoreService {
    static async calculateTenxScore(symbol: string, industryCache?: IndustryCache, cachedStaticData?: PrefetchedData, revenueCache?: RevenueCache): Promise<TenxScoreResult> {
        let stockName = symbol;
        try { const info = await EmService.getStockInfo(symbol); stockName = info['股票简称'] || symbol; } catch {}

        let data: PrefetchedData;
        if (cachedStaticData) data = await prefetchDynamicData(symbol, cachedStaticData);
        else data = await prefetchAllData(symbol);

        const growthData = calcGrowthData(data);
        const profitData = calcProfitabilityData(data);
        const healthData = calcFinancialHealthData(data);
        const governanceData = calcGovernanceData(data);
        const profitCagr = (growthData.profit_cagr as number) || 0;
        const valuationData = calcValuationData(data, profitCagr);
        const emptyData: RawIndicators = {};
        const [industryData, moatData] = await Promise.all([
            calcIndustryData(symbol, data, industryCache, revenueCache).catch(e => { console.warn('[TenxScore] calcIndustryData failed:', e?.message); return emptyData; }),
            calcMoatData(symbol, data, industryCache, revenueCache).catch(e => { console.warn('[TenxScore] calcMoatData failed:', e?.message); return emptyData; }),
        ]);
        const catalystData = await calcCatalystData(symbol, data).catch(e => { console.warn('[TenxScore] calcCatalystData failed:', e?.message); return emptyData; });

        const allRaw: RawIndicators = { stockName, ...growthData, ...profitData, ...valuationData, ...industryData, ...healthData, ...moatData, ...governanceData, ...catalystData };

        const indicatorScores: Record<string, number> = {};
        const zeroAsMissingKeys = new Set(['rev_cagr', 'profit_cagr', 'deducted_cagr', 'earnings_accel', 'contract_liab_growth', 'holder_trade_ratio', 'mgmt_share_ratio', 'analyst_upgrade_ratio', 'event_catalyst_score']);
        for (const [key, value] of Object.entries(allRaw)) {
            if (typeof value === 'number' && SCORE_MAPS[key]) {
                if (key === 'dividend_ratio') { const dr = value as number; if (dr >= 20 && dr <= 40) indicatorScores[key] = 90; else if (dr < 20) indicatorScores[key] = Math.round(30 + (dr / 20) * 55); else indicatorScores[key] = Math.round(90 - (dr - 40) * 1.5); indicatorScores[key] = Math.max(20, Math.min(90, indicatorScores[key])); }
                else if (zeroAsMissingKeys.has(key) && value === 0) { indicatorScores[key] = 50; allRaw[key] = null; }
                else indicatorScores[key] = scoreByRange(value, SCORE_MAPS[key]);
            }
        }

        const dimensions = TENX_DIMS.map(dim => {
            const scores = dim.indicators.map(ind => indicatorScores[ind.key] ?? 50);
            const dimScore = Math.round(avg(scores));
            return { name: dim.name, weight: dim.weight, score: dimScore, indicators: dim.indicators.map((ind, i) => ({ name: ind.name, key: ind.key, value: formatValue(ind.key, allRaw[ind.key] ?? null), score: scores[i] })) };
        });

        const totalScore = Math.round(dimensions.reduce((sum, dim) => sum + dim.score * dim.weight / 100, 0) * 10) / 10;
        const { label, expectedMultiple } = this.getRating(totalScore);
        const aiConclusion = this.generateConclusion(stockName, totalScore, dimensions);

        return { score: totalScore, label, expectedMultiple, description: this.getDescription(totalScore), aiConclusion, dimensions, dimScores: dimensions.map(d => d.score), rawData: data, updatedAt: new Date().toISOString() };
    }

    private static getRating(score: number): { label: string; expectedMultiple: string } {
        if (score >= 85) return { label: '十倍股相似度', expectedMultiple: '10倍+' };
        if (score >= 75) return { label: '五倍股相似度', expectedMultiple: '5-10倍' };
        if (score >= 65) return { label: '三倍股相似度', expectedMultiple: '3-5倍' };
        if (score >= 50) return { label: '一倍股相似度', expectedMultiple: '1-3倍' };
        return { label: '低于平均', expectedMultiple: '<1倍' };
    }

    private static getDescription(score: number): string {
        if (score >= 85) return '整体具备十倍股核心特征，建议持续跟踪催化剂落地节奏。';
        if (score >= 75) return '具备五倍股潜力，多数维度表现优秀，关注短板补强。';
        if (score >= 65) return '有亮点但存在短板，需等待关键催化因素验证。';
        if (score >= 50) return '部分维度有改善空间，需关注基本面拐点信号。';
        return '当前与十倍股样本差距较大，建议关注基本面拐点信号。';
    }

    private static generateConclusion(stockName: string, score: number, dimensions: TenxScoreResult['dimensions']): string {
        const strongest = dimensions.reduce((a, b) => a.score > b.score ? a : b);
        const weakest = dimensions.reduce((a, b) => a.score < b.score ? a : b);
        const strongInds = strongest.indicators.filter(i => i.score >= 60).map(i => i.name);
        const weakInds = weakest.indicators.filter(i => i.score < 50).map(i => i.name);
        let text = `${stockName}综合评分${score}，评级${this.getRating(score).label}。`;
        text += `最强维度"${strongest.name}"由${strongInds.join('、') || '多项指标'}支撑；`;
        text += `"${weakest.name}"偏弱${weakInds.length ? '，需关注' + weakInds.join('、') + '能否补强' : '，各项指标均已激活'}。`;
        if (score >= 80) text += '整体具备十倍股核心特征，建议持续跟踪催化剂落地节奏。';
        else if (score >= 60) text += '有亮点但存在短板，需等待关键催化因素验证。';
        else text += '当前与十倍股样本差距较大，建议关注基本面拐点信号。';
        return text;
    }
}
