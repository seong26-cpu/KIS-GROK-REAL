import type { AnalysisReport, LiveSnapshot, NewsItem, SihwangSnapshot } from "./types";
import { computeAtr, computeMacd, computeRsi, computeStochastic, computeSupportResistance, toNum } from "./indicators";
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
  const stoch = computeStochastic(daily);
  const stochNote = stoch
    ? `스토캐스틱 %K ${stoch.k} / %D ${stoch.d}${stoch.k >= 80 ? " · 단기 과매수" : stoch.k <= 20 ? " · 단기 과매도" : ""}`
    : "스토캐스틱 산출에 일봉이 부족합니다.";
  const atr = computeAtr(daily);
  const sr = computeSupportResistance(daily, p, ma20, ma60, atr);
  const stop = sr.support2 ?? (p != null ? Math.round(p * 0.92) : null);

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
    .slice(0, 40)
    .reverse()
    .map((b) => ({ date: String(b.date ?? ""), close: toNum(b.stck_clpr) ?? 0, volume: toNum(b.acml_vol) }))
    .filter((x) => x.close > 0);

  const won = (n: number | null) => (n == null ? "미산출" : `${Math.round(n).toLocaleString("ko-KR")}원`);
  const { fetchDartFacts } = await import("@/lib/dart/client.server");
  const dart = await fetchDartFacts(env.stockCode, p);
  const { fetchNaverConsensus } = await import("@/lib/market/brief.server");
  const naver = await fetchNaverConsensus(env.stockCode, p).catch(() => ({
    consensus: null,
    researches: [] as { broker: string; title: string; date: string }[],
  }));
  if (dart?.titles.length) {
    news.unshift(...dart.titles.filter((t) => !news.some((n) => n.title === t.title)).slice(0, 6));
  }
  const name = env.stockName ?? env.stockCode;
  const supplyNote = supplyRows.length
    ? `최근 수급 ${supplyRows
        .slice(0, 3)
        .map((r) => `${r.date || "일자"} 외인 ${r.foreign ?? "—"} 기관 ${r.inst ?? "—"}`)
        .join(" / ")}`
    : "투자자별 수급을 확보하지 못했습니다.";
  const newsLine = news.length
    ? `수집 기사 ${news.length}건. 제목만 인용하며 실적·수주 숫자는 기사에 적힌 경우에만 확인하세요.`
    : "최근 뉴스를 확보하지 못해 펀더멘털 문장은 쓰지 않습니다.";
  const summary = [
    `${name}(${env.stockCode}) 현재가 ${won(p)}, 당일 ${env.changeRatePct == null ? "등락 미확보" : `${env.changeRatePct >= 0 ? "+" : ""}${env.changeRatePct.toFixed(2)}%`}. 시황은 ${marketState}. ${marketReason}`,
    `${maNote}. ${volumeRatio != null ? `거래량은 직전 3일 평균 대비 ${volumeRatio}배` : "거래량 배수는 미산출"}. ${macdNote}. RSI ${rsi ?? "미산출"}. ${stochNote}.`,
    `${supplyNote} ${newsLine}`,
    dart?.lines.length ? `DART ${dart.lines.join(" / ")}` : "DART 재무 숫자를 붙이지 못했습니다.",
    naver.consensus
      ? `네이버 컨센서스 ${naver.consensus.date} 목표 ${naver.consensus.target}원, 추천평균 ${naver.consensus.score} (5 적극매수~1 적극매도). 현재가 대비 ${naver.consensus.upsidePct == null ? "괴리 계산 불가" : `${naver.consensus.upsidePct}%`}.`
      : "네이버 목표주가를 받지 못했습니다.",
    p == null
      ? "현재가가 없어 매수·매도 가격을 만들지 않습니다."
      : `지지 ${won(sr.support1)} / ${won(sr.support2)}, 저항 ${won(sr.resistance1)} / ${won(sr.resistance2)}. 추격 매수보다 지지 안착을 확인하고, 저항에서는 분할 축소를 규칙으로 둡니다.`,
  ].join(" ");

  const timing = [
    {
      title: "1차 매수",
      body:
        sr.support1 != null
          ? `${won(sr.support1)} 부근 지지가 당일 저가·거래량으로 확인될 때 분할. 종가 기준 이 가격을 종가가 이탈하면 보류.`
          : "지지선을 산출할 일봉이 부족해 매수 가격을 제시하지 않습니다.",
    },
    {
      title: "2차 매수",
      body: "가격만으로 비중을 늘리지 않습니다. 수집된 뉴스·공시에 수주·실적·공급계약이 실제로 있을 때만 추가. 해당 기사가 없으면 2차는 보류입니다.",
    },
    {
      title: "차익 실현",
      body:
        sr.resistance1 != null
          ? `1차 ${won(sr.resistance1)}${sr.resistance2 != null ? `, 2차 ${won(sr.resistance2)}` : ""}. 저항은 최근 고점·스윙 고점이며 목표가를 임의로 올리지 않습니다.`
          : "현재가 위 저항을 일봉에서 찾지 못했습니다.",
    },
    {
      title: "손절·비중 축소",
      body:
        stop != null
          ? `${won(sr.support1)} 이탈 시 비중 축소, ${won(stop)} 종가 이탈 시 정리. 이 가격은 일봉 지지·저점에서 계산한 값입니다.`
          : "손절 기준을 만들 저점이 없습니다.",
    },
  ];

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
    summary,
    timing,
    levels: {
      support1: sr.support1,
      support2: sr.support2,
      resistance1: sr.resistance1,
      resistance2: sr.resistance2,
      stop,
    },
    chartBars: recentCloses,
    stochNote,
    consensus: naver.consensus,
    researches: naver.researches,
  };
}
