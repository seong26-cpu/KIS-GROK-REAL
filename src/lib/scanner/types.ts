export type CheckStatus = "pass" | "fail" | "unknown";

export type NewsItem = {
  title: string;
  pubDate: string;
  source?: string;
  code?: string;
  link?: string;
};

export type CheckItem = {
  label: string;
  status: CheckStatus;
  detail: string;
  newsItems?: NewsItem[];
};

export type RankedStock = {
  code: string;
  name: string;
  rank: number;
  price: number | null;
  changeRatePct: number | null;
  volume: number | null;
  tradingValue: number | null;
  tradingValueEstimated: boolean;
  source: "trading_value" | "change_rate" | "both";
};

export type LiveSnapshot = {
  stockCode: string;
  stockName: string | null;
  currentPrice: number | null;
  prevClose: number | null;
  openPrice: number | null;
  highPrice: number | null;
  lowPrice: number | null;
  volume: number | null;
  prevVolume: number | null;
  ma5: number | null;
  ma10: number | null;
  ma20: number | null;
  ma60: number | null;
  ma120: number | null;
  high20d: number | null;
  low20d: number | null;
  high60d: number | null;
  low60d: number | null;
  foreignNetBuy1d: number | null;
  foreignNetBuy2d: number | null;
  instNetBuy1d: number | null;
  instNetBuyCum20: number | null;
  pensionNetBuyCum20: number | null;
  programNetBuyToday: number | null;
  changeRatePct: number | null;
  tradingValueToday: number | null;
  tradingValueIsEstimated: boolean;
  avgTradingValue5d: number | null;
  dailyPrices: DailyBar[];
  investorRows: InvestorRow[];
  foreignNetBuyAmount1d: number | null;
  instNetBuyAmount1d: number | null;
  newsItems: NewsItem[] | null;
  errors: string[];
  marketCapEok?: number | null;
  listedShares?: number | null;
};

export type DailyBar = {
  date?: string;
  stck_clpr?: string | number;
  stck_oprc?: string | number;
  stck_hgpr?: string | number;
  stck_lwpr?: string | number;
  acml_vol?: string | number;
  acml_tr_pbmn?: string | number;
};

export type InvestorRow = Record<string, string | number | undefined>;

export type ClosingBetCandidate = {
  stockCode: string;
  stockName: string | null;
  currentPrice: number | null;
  changeRatePct: number | null;
  tradingValueToday: number | null;
  reasonSummary: string;
  conditions: CheckItem[];
  qualityChecks: CheckItem[];
  targetPrice: number | null;
  targetBasis: string;
  stopLoss: number | null;
  stopLossBasis: string;
  riskNotes: string[];
  matchScore: number;
  rankSources: string[];
};

export type CaseVerdict = {
  caseId: number;
  caseTitle: string;
  probabilityLabel: string;
  stockCode: string;
  stockName: string | null;
  verdict: "적극매수" | "매수" | "관망" | "판단불가";
  actionTiming: string;
  currentPrice: number | null;
  targetPrice: number | null;
  targetBasis: string;
  exitPrice: number | null;
  exitBasis: string;
  supplyDemandNote: string;
  reasons: string[];
  warnings: string[];
  prohibitedActions: string[];
  dataConfidence: string;
};

export type BoardStock = {
  code: string;
  name: string;
  themeId: string;
  themeName: string;
  currentPrice: number | null;
  changeRatePct: number | null;
  rs: number | null;
  highVsPeakPct: number | null;
  tradingValueEok: number | null;
  prevVolPct: number | null;
  ret20Pct: number | null;
  isLimitUp: boolean;
  isNearHigh: boolean;
  isLeader: boolean;
  newsTitles: string[];
  cases: CaseVerdict[];
  closingReasons: string[];
  closingConditions: CheckItem[];
  closingQuality: CheckItem[];
  supplyDemandNote: string;
  targetPrice: number | null;
  stopLoss: number | null;
  bars: { date: string; close: number; volume: number | null }[];
  supply: { date: string; foreign: number | null; inst: number | null; individual: number | null }[];
};

export type ThemeCard = {
  id: string;
  name: string;
  rank?: number;
  avgChangePct: number | null;
  stocks: BoardStock[];
};

export type MarketIndex = {
  code: string;
  name: string;
  price: number | null;
  changeRatePct: number | null;
};

export type TapeItem = {
  symbol: string;
  name: string;
  price: number | null;
  changeRatePct: number | null;
  source: string;
  history?: { date: string; close: number; changePct: number | null }[];
};

export type SihwangSnapshot = {
  fetchedAt: string;
  korean: TapeItem[];
  global: TapeItem[];
  notes: string[];
};

export type RankingSnapshot = {
  fetchedAt: string;
  tradingValueTop: RankedStock[];
  changeRateTop: RankedStock[];
  merged: RankedStock[];
  indices: MarketIndex[];
  cacheHit: boolean;
  ttlSec: number;
};

export type BrokerCreds = {
  appKey: string;
  appSecret: string;
};

/** @deprecated use BrokerCreds */
export type KisCreds = BrokerCreds;

export type TokenStatus = {
  hasToken: boolean;
  secondsRemaining?: number;
  totalSeconds?: number;
  issuedAt?: number;
  expiresAt?: number;
};

export type UniverseSnapshot = {
  fetchedAt: string;
  sources: string[];
  notes: string[];
  prevTv: RankedStock[];
  avg5Tv: RankedStock[];
  todayTv: RankedStock[];
  changeRate: RankedStock[];
  selected: Array<
    RankedStock & {
      prevTvRank: number | null;
      avg5TvRank: number | null;
      todayTvRank: number | null;
      marketCapEok: number | null;
      listedShares: number | null;
      avgTradingValue: number | null;
      leaderScore: number;
      filterNotes: string[];
      inA: boolean;
      inB: boolean;
      inC: boolean;
    }
  >;
  rejectedCap: number;
};

export type AnalysisReport = {
  generatedAt: string;
  stockCode: string;
  stockName: string | null;
  currentPrice: number | null;
  marketState: "상승" | "하락" | "횡보" | "판단불가";
  marketReason: string;
  kospiTrend: { date: string; close: number; changePct: number | null }[];
  kosdaqTrend: { date: string; close: number; changePct: number | null }[];
  maNote: string;
  maTrendOk: boolean | null;
  volumeRatio: number | null;
  volumeSurge: boolean | null;
  rsi: number | null;
  macdGolden: boolean | null;
  macdNote: string;
  supplyRows: { date: string; foreign: number | null; inst: number | null; individual: number | null }[];
  news: NewsItem[];
  strengths: string[];
  risks: string[];
  recommend: boolean | null;
  targetLow: number | null;
  targetHigh: number | null;
  targetBasis: string;
  targetDateText: string;
  chartSketch: string;
  signals: { met: boolean | null; note: string }[];
  recentCloses: { date: string; close: number }[];
  tradingValueToday: number | null;
  changeRatePct: number | null;
  marketCapEok: number | null;
  disclaimer: string;
  errors: string[];
  summary?: string;
  timing?: { title: string; body: string }[];
  levels?: {
    support1: number | null;
    support2: number | null;
    resistance1: number | null;
    resistance2: number | null;
    stop: number | null;
  };
  chartBars?: { date: string; close: number; volume: number | null }[];
  stochNote?: string;
};

export const MIN_PRICE = 1000;
export const MIN_AVG_TRADING_VALUE = 1_000_000_000;
export const TRADING_VALUE_TOP_N_DEFAULT = 20;
export const CHANGE_RATE_TOP_N_DEFAULT = 10;
export const RANKING_CACHE_TTL_MS = 5 * 60 * 1000;
