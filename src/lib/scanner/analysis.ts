import type { AnalysisReport, LiveSnapshot, NewsItem, SihwangSnapshot } from "./types";
import { computeMacd, computeRsi, toNum } from "./indicators";
import { fetchMarketNews } from "@/lib/market/news.server";

function trendFromTape(snap: SihwangSnapshot | null, symbol: string): AnalysisReport["kospiTrend"] {
  const item = snap?.korean.find((t) => t.symbol === symbol) ?? snap?.global.find((t) => t.symbol === symbol);
  if (!item) return [];
  if (item.history?.length) {
    return item.history.slice(-5).map((h) => ({ date: h.date, close: h.close, changePct: h.changePct }));
  }
  if (item.price == null) return [];
  return [{ date: snap?.fetchedAt?.slice(0, 10) ?? "", close: item.price, changePct: item.changeRatePct }];
}

export async function buildAnalysis(
  env: LiveSnapshot,
  sihwang: SihwangSnapshot | null,
): Promise<AnalysisReport> {
  const errors = [...env.errors];
  const kospi = sihwang?.korean.find((t) => t.symbol === "KOSPI");
  const kosdaq = sihwang?.korean.find((t) => t.symbol === "KOSDAQ");
  const kospiTrend = trendFromTape(sihwang, "KOSPI");
  const kosdaqTrend = trendFromTape(sihwang, "KOSDAQ");

  const chgs = [kospi?.changeRatePct, kosdaq?.changeRatePct].filter((n): n is number => n != null);
  let marketState: AnalysisReport["marketState"] = "판단불가";
  let marketReason = "코스피/코스닥 시황을 확보하지 못했습니다.";
  if (chgs.length) {
    const avg = chgs.reduce((a, b) => a + b, 0) / chgs.length;
    marketState = avg >= 0.4 ? "상승" : avg <= -0.4 ? "하락" : "횡보";
    marketReason = `당일 코스피 ${kospi?.changeRatePct?.toFixed(2) ?? "—"}% · 코스닥 ${kosdaq?.changeRatePct?.toFixed(2) ?? "—"}% (평균 ${avg.toFixed(2)}%). ${
      kospiTrend.length >= 2 ? `코스피 최근 ${kospiTrend.length}거래일 종가 추이를 반영했습니다.` : "지수 5일 추이는 아직 부족합니다."
    }`;
  }

  const p = env.currentPrice;
  const ma5 = env.ma5;
  const ma20 = env.ma20;
  const ma60 = env.ma60;
  let maTrendOk: boolean | null = null;
  let maNote = "데이터 부족으로 판단불가";
  if (p != null && ma5 != null && ma20 != null) {
    maTrendOk = p > ma5 && ma5 > ma20;
    maNote = `현재가 ${Math.round(p).toLocaleString("ko-KR")} ${p > ma5 ? ">" : "≤"} 5일 ${Math.round(ma5).toLocaleString("ko-KR")} ${ma5 > ma20 ? ">" : "≤"} 20일 ${Math.round(ma20).toLocaleString("ko-KR")}${ma60 != null ? ` / 60일 ${Math.round(ma60).toLocaleString("ko-KR")}` : ""}`;
  }

  let volumeRatio: number | null = null;
  let volumeSurge: boolean | null = null;
  const daily = env.dailyPrices;
  if (daily.length >= 4) {
    const today = toNum(daily[0]?.acml_vol);
    const prev = [1, 2, 3].map((i) => toNum(daily[i]?.acml_vol));
    if (today != null && prev.every((v) => v != null) && prev.reduce((a, b) => a + (b ?? 0), 0) > 0) {
      const avg = (prev as number[]).reduce((a, b) => a + b, 0) / 3;
      volumeRatio = Math.round((today / avg) * 100) / 100;
      volumeSurge = volumeRatio >= 1.5;
    }
  }

  const rsi = computeRsi(daily);
  const macd = computeMacd(daily);
  const macdGolden = macd?.goldenCross ?? null;
  const macdNote = macd
    ? `MACD ${macd.macd} / 시그널 ${macd.signal}${macd.goldenCross ? " · 골든크로스" : macd.deadCross ? " · 데드크로스" : ""}`
    : "MACD 산출에 필요한 일봉이 부족합니다.";

  const supplyRows = env.investorRows.slice(0, 3).map((row) => ({
    date: String(row.stck_bsop_date ?? row.bsop_date ?? ""),
    foreign: toNum(row.frgn_ntby_qty),
    inst: toNum(row.orgn_ntby_qty),
    individual: toNum(row.prsn_ntby_qty),
  }));

  let econ: NewsItem[] = [];
  try {
    econ = (await fetchMarketNews()) ?? [];
  } catch {
    econ = [];
  }
  const news = [...(env.newsItems ?? []), ...econ].slice(0, 8);

  const signals: AnalysisReport["signals"] = [];
  signals.push({ met: marketState === "상승" || marketState === "횡보", note: `시황 '${marketState}' (상승/횡보면 우호)` });
  signals.push({ met: maTrendOk, note: maNote });
  signals.push({
    met: volumeSurge,
    note: volumeRatio != null ? `거래량 3일평균 대비 ${volumeRatio}배` : "거래량 데이터 부족",
  });
  signals.push({
    met: rsi == null ? null : rsi >= 30 && rsi <= 55,
    note: rsi == null ? "RSI 미산출" : `RSI(14) ${rsi}`,
  });
  signals.push({ met: macdGolden, note: macdNote });
  signals.push({
    met: news.length > 0 ? true : env.newsItems === null ? null : false,
    note: news.length ? `관련 뉴스 ${news.length}건 (호재/악재는 직접 확인)` : "최근 뉴스 없음 또는 조회 실패",
  });

  const met = signals.filter((s) => s.met === true).length;
  const unknown = signals.filter((s) => s.met == null).length;
  const known = signals.length - unknown;
  const recommend = known > 0 ? met >= Math.max(3, Math.floor(known / 2) + 1) : null;

  let targetLow: number | null = null;
  let targetHigh: number | null = null;
  let targetBasis = "데이터 부족으로 산출 불가";
  if (p != null) {
    targetLow = Math.round(p * 0.95);
    targetHigh = Math.round(p);
    if (ma20 != null) targetLow = Math.max(targetLow, Math.round(ma20 * 0.98));
    targetBasis = ma20 != null ? `현재가 -5%~현재가, 20일선 ${Math.round(ma20).toLocaleString("ko-KR")} 부근 지지` : "현재가 -5%~현재가";
  }
  const d1 = new Date(Date.now() + 9 * 3600_000);
  d1.setUTCDate(d1.getUTCDate() + 1);
  const d3 = new Date(d1);
  d3.setUTCDate(d3.getUTCDate() + 2);
  const fmt = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  const targetDateText = `${fmt(d1)} ~ ${fmt(d3)}, 5일선 지지 재확인 후 시가 근접`;

  const strengths: string[] = [];
  const risks: string[] = [];
  for (const s of signals) {
    if (s.met === true) strengths.push(s.note);
    if (s.met === false) risks.push(s.note);
  }
  const foreign3 = supplyRows.length >= 3 && supplyRows.every((r) => r.foreign != null && r.foreign > 0);
  const inst3 = supplyRows.length >= 3 && supplyRows.every((r) => r.inst != null && r.inst > 0);
  if (foreign3) strengths.push("최근 3일 외국인 연속 순매수");
  if (inst3) strengths.push("최근 3일 기관 연속 순매수");
  if (!env.investorRows.length) risks.push("수급 데이터 미확보 — 매매 전 HTS에서 확인");

  const sketch: string[] = [];
  if (env.changeRatePct != null) sketch.push(`당일 등락률 ${env.changeRatePct >= 0 ? "+" : ""}${env.changeRatePct.toFixed(2)}%`);
  if (volumeSurge != null) sketch.push(volumeSurge ? "거래량 증가" : "거래량 평이");
  if (maTrendOk != null) sketch.push(maTrendOk ? "이평 정배열" : "이평 혼조/역배열");
  if (macd) sketch.push(macd.goldenCross ? "MACD 골든" : macd.deadCross ? "MACD 데드" : "MACD 보합");

  const recentCloses = [...daily]
    .slice(0, 10)
    .reverse()
    .map((b) => ({ date: String(b.date ?? ""), close: toNum(b.stck_clpr) ?? 0 }))
    .filter((x) => x.close > 0);

  return {
    generatedAt: new Date().toISOString(),
    stockCode: env.stockCode,
    stockName: env.stockName,
    currentPrice: p,
    marketState,
    marketReason,
    kospiTrend,
    kosdaqTrend,
    maNote,
    maTrendOk,
    volumeRatio,
    volumeSurge,
    rsi,
    macdGolden,
    macdNote,
    supplyRows,
    news,
    strengths: strengths.slice(0, 3),
    risks: risks.slice(0, 3),
    recommend,
    targetLow,
    targetHigh,
    targetBasis,
    targetDateText,
    chartSketch: sketch.join(" · ") || "데이터 부족으로 스케치 불가",
    signals,
    recentCloses,
    tradingValueToday: env.tradingValueToday,
    changeRatePct: env.changeRatePct,
    marketCapEok: env.marketCapEok ?? null,
    disclaimer:
      "실측 데이터를 규칙으로 정리한 참고 자료이며 투자 조언이 아닙니다. 뉴스의 호재·악재와 미확보 항목은 직접 확인하세요.",
    errors,
  };
}
