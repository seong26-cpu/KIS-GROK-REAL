import type { LiveSnapshot, RankedStock } from "@/lib/scanner/types";
import { computeHighLow, computeMa, computeRsi, toNum } from "@/lib/scanner/indicators";
import { fetchStockNews } from "@/lib/market/news.server";
import type { KisClient } from "./client.server";

export async function buildSnapshot(
  client: KisClient,
  code: string,
  seed?: Partial<RankedStock> & { marketCapEok?: number | null; listedShares?: number | null; avgTradingValue?: number | null },
): Promise<LiveSnapshot> {
  const errors: string[] = [];
  let cur: Record<string, unknown> = {};
  try {
    cur = await client.getCurrentPrice(code);
  } catch (e) {
    errors.push(`현재가: ${e instanceof Error ? e.message : String(e)}`);
  }

  let daily: LiveSnapshot["dailyPrices"] = [];
  try {
    daily = await client.getDailyPrices(code, 130);
  } catch (e) {
    errors.push(`일봉: ${e instanceof Error ? e.message : String(e)}`);
  }

  let investorRows: LiveSnapshot["investorRows"] = [];
  try {
    investorRows = await client.getInvestorTrend(code);
  } catch (e) {
    errors.push(`수급: ${e instanceof Error ? e.message : String(e)}`);
  }

  const price = toNum(cur.stck_prpr) ?? seed?.price ?? null;
  const volume = toNum(cur.acml_vol) ?? seed?.volume ?? null;
  let tv = toNum(cur.acml_tr_pbmn) ?? seed?.tradingValue ?? null;
  let tvEst = false;
  if (tv == null && price != null && volume != null) {
    tv = price * volume;
    tvEst = true;
  }

  const ma5 = computeMa(daily, 5);
  const ma10 = computeMa(daily, 10);
  const ma20 = computeMa(daily, 20);
  const ma60 = computeMa(daily, 60);
  const ma120 = computeMa(daily, 120);
  const [high20d, low20d] = computeHighLow(daily, 20);
  const [high60d, low60d] = computeHighLow(daily, 60);

  const avg5 =
    seed?.avgTradingValue ??
    (() => {
      const vals = daily.slice(0, 5).map((b) => toNum(b.acml_tr_pbmn)).filter((n): n is number => n != null);
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    })();

  const foreign1 = toNum(investorRows[0]?.frgn_ntby_qty);
  const foreign2 = toNum(investorRows[1]?.frgn_ntby_qty);
  const inst1 = toNum(investorRows[0]?.orgn_ntby_qty);
  const instAmt = toNum(investorRows[0]?.orgn_ntby_tr_pbmn);
  const foreignAmt = toNum(investorRows[0]?.frgn_ntby_tr_pbmn);

  let instCum20: number | null = null;
  if (investorRows.length) {
    let s = 0;
    let n = 0;
    for (const row of investorRows.slice(0, 20)) {
      const v = toNum(row.orgn_ntby_qty);
      if (v == null) continue;
      s += v;
      n += 1;
    }
    if (n) instCum20 = s;
  }

  const name = String(cur.hts_kor_isnm ?? seed?.name ?? "").trim() || null;
  let news = null;
  try {
    news = await fetchStockNews(code, name ?? undefined);
  } catch {
    news = null;
  }

  const htsAvls = toNum(cur.hts_avls);
  const listed = toNum(cur.lstn_stcn) ?? seed?.listedShares ?? null;

  return {
    stockCode: code,
    stockName: name,
    currentPrice: price,
    prevClose: toNum(cur.stck_sdpr ?? cur.stck_prdy_clpr),
    openPrice: toNum(cur.stck_oprc),
    highPrice: toNum(cur.stck_hgpr),
    lowPrice: toNum(cur.stck_lwpr),
    volume,
    prevVolume: toNum(daily[1]?.acml_vol),
    ma5,
    ma10,
    ma20,
    ma60,
    ma120,
    high20d,
    low20d,
    high60d,
    low60d,
    foreignNetBuy1d: foreign1,
    foreignNetBuy2d: foreign2,
    instNetBuy1d: inst1,
    instNetBuyCum20: instCum20,
    pensionNetBuyCum20: null,
    programNetBuyToday: null,
    changeRatePct: toNum(cur.prdy_ctrt) ?? seed?.changeRatePct ?? null,
    tradingValueToday: tv,
    tradingValueIsEstimated: tvEst,
    avgTradingValue5d: avg5,
    dailyPrices: daily,
    investorRows,
    foreignNetBuyAmount1d: foreignAmt,
    instNetBuyAmount1d: instAmt,
    newsItems: news,
    errors,
    marketCapEok: htsAvls ?? seed?.marketCapEok ?? null,
    listedShares: listed,
  };
}
