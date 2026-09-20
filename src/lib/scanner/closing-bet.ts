import type { CheckItem, ClosingBetCandidate, LiveSnapshot, MarketIndex } from "./types";
import { computeAtr, computeRsi, countConsecutiveNetBuyDays } from "./indicators";

export const TRADING_VALUE_TOP_N = 20;
export const CHANGE_RATE_TOP_N = 10;
const MIN_SUPPLY_AMOUNT = 5_000_000_000;

export const CONDITION_LABELS = [
  "거래대금 상위",
  "테마 대장주(등락률 상위)",
  "외국인/기관 수급",
  "장초반 급등후 횡보(근사)",
  "뉴스 모멘텀",
] as const;

export const QUALITY_LABELS = [
  "1. 거래량 질(5일 평균비 3~5배)",
  "2. 기술적 위치(고가-3%+이평+RSI)",
  "3. 수급의 질(동반매수+금액기준)",
  "4. 뉴스 지속성 필터",
  "5. 섹터/시장 컨텍스트",
  "6. 공매도/대주주 리스크",
  "7. 실시간 마이크로 패턴",
  "8. 리스크 관리(ATR 손절/포지션)",
] as const;

function fmtPct(v: number | null | undefined) {
  return v == null ? "미확보" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}
function fmtWon(v: number | null | undefined) {
  return v == null ? "미확보" : `${Math.round(v).toLocaleString("ko-KR")}원`;
}

export function evaluateClosingBetCandidate(
  snap: LiveSnapshot,
  opts: {
    isTradingValueTop: boolean;
    isChangeRateTop: boolean;
    indices?: MarketIndex[];
  },
): ClosingBetCandidate {
  const conditions: CheckItem[] = [];
  const quality: CheckItem[] = [];

  if (snap.tradingValueToday == null || snap.changeRatePct == null) {
    conditions.push({
      label: CONDITION_LABELS[0],
      status: "unknown",
      detail: "거래대금/등락률 데이터 미확보",
    });
  } else {
    const ok = opts.isTradingValueTop && snap.changeRatePct > 0;
    const est = snap.tradingValueIsEstimated ? " (근사치: 종가×거래량)" : " (KIS 실측)";
    conditions.push({
      label: CONDITION_LABELS[0],
      status: ok ? "pass" : "fail",
      detail: `KIS 거래대금 순위 ${opts.isTradingValueTop ? "포함" : "미포함"}${est} · 등락률 ${fmtPct(snap.changeRatePct)}`,
    });
  }

  if (snap.changeRatePct == null) {
    conditions.push({
      label: CONDITION_LABELS[1],
      status: "unknown",
      detail: "등락률 데이터 미확보",
    });
  } else {
    conditions.push({
      label: CONDITION_LABELS[1],
      status: opts.isChangeRateTop ? "pass" : "fail",
      detail: `KIS 등락률 순위 ${opts.isChangeRateTop ? "포함" : "미포함"} (표준 테마 분류가 없어 전일대비 등락률 순위로 근사)`,
    });
  }

  if (snap.foreignNetBuy1d == null || snap.instNetBuy1d == null) {
    conditions.push({
      label: CONDITION_LABELS[2],
      status: "unknown",
      detail: "수급 데이터 미확보",
    });
  } else {
    const consec = countConsecutiveNetBuyDays(snap.investorRows, "frgn_ntby_qty");
    const ok = snap.foreignNetBuy1d > 0 && snap.instNetBuy1d > 0;
    conditions.push({
      label: CONDITION_LABELS[2],
      status: ok ? "pass" : "fail",
      detail: `외국인 순매수 ${snap.foreignNetBuy1d.toLocaleString("ko-KR")} / 기관 순매수 ${snap.instNetBuy1d.toLocaleString("ko-KR")} (외국인 연속매수 ${consec}일)`,
    });
  }

  let pullbackPct: number | null = null;
  if (snap.highPrice == null || snap.currentPrice == null || snap.highPrice === 0) {
    conditions.push({
      label: CONDITION_LABELS[3],
      status: "unknown",
      detail: "당일 고가/현재가 데이터 미확보",
    });
  } else {
    pullbackPct = ((snap.highPrice - snap.currentPrice) / snap.highPrice) * 100;
    const ok = pullbackPct >= 0 && pullbackPct <= 3;
    conditions.push({
      label: CONDITION_LABELS[3],
      status: ok ? "pass" : "fail",
      detail: `당일 고가 대비 ${pullbackPct.toFixed(1)}% (일봉 근사 — 09~10시 분봉 패턴은 미연동, 차트 직접 확인 권장)`,
    });
  }

  const news = snap.newsItems;
  if (news == null) {
    conditions.push({
      label: CONDITION_LABELS[4],
      status: "unknown",
      detail: "증권사/공개 시황 뉴스 호출 실패 — 뉴스를 지어내지 않고 판단불가로 표시",
    });
  } else if (news.length === 0) {
    conditions.push({
      label: CONDITION_LABELS[4],
      status: "fail",
      detail: "종목 뉴스 검색 결과 없음 (네이버증권 공개피드 · Google 뉴스 RSS)",
    });
  } else {
    conditions.push({
      label: CONDITION_LABELS[4],
      status: "pass",
      detail: `종목 뉴스 ${news.length}건 (네이버증권·Google 뉴스) — 정책펀드/계약 등 질적 판단은 직접 확인 (자동 판정 안 함)`,
      newsItems: news,
    });
  }

  const matchScore = conditions.filter((c) => c.status === "pass").length;
  const rsi = computeRsi(snap.dailyPrices);
  const atr = computeAtr(snap.dailyPrices);

  let volRatio: number | null = null;
  if (snap.volume != null && snap.avgTradingValue5d && snap.avgTradingValue5d > 0 && snap.currentPrice) {
    const avgVol = snap.avgTradingValue5d / snap.currentPrice;
    if (avgVol > 0) volRatio = snap.volume / avgVol;
  }
  if (volRatio == null) {
    quality.push({
      label: QUALITY_LABELS[0],
      status: "unknown",
      detail: "평균 거래량 대비 비율 산출 불가 (데이터 부족)",
    });
  } else {
    quality.push({
      label: QUALITY_LABELS[0],
      status: volRatio >= 3 ? "pass" : "fail",
      detail: `최근 평균 대비 거래량 약 ${volRatio.toFixed(1)}배 (근사치) · 매수체결강도는 실시간 체결 미연동으로 판단불가`,
    });
  }

  if (pullbackPct == null || snap.ma5 == null || snap.ma20 == null || snap.currentPrice == null) {
    quality.push({
      label: QUALITY_LABELS[1],
      status: "unknown",
      detail: "고가/이평선 데이터 일부 미확보",
    });
  } else {
    const aboveMa = snap.currentPrice > snap.ma5 && snap.currentPrice > snap.ma20;
    const rsiOk = rsi != null && rsi >= 55 && rsi <= 75;
    const ok = pullbackPct >= 0 && pullbackPct <= 3 && aboveMa && rsiOk;
    quality.push({
      label: QUALITY_LABELS[1],
      status: ok ? "pass" : "fail",
      detail: `고가대비 ${pullbackPct.toFixed(1)}% · 5일/20일선 상회 ${aboveMa ? "예" : "아니오"} · RSI ${rsi ?? "판단불가"}`,
    });
  }

  if (snap.foreignNetBuyAmount1d != null || snap.instNetBuyAmount1d != null) {
    const amt = (snap.foreignNetBuyAmount1d ?? 0) + (snap.instNetBuyAmount1d ?? 0);
    quality.push({
      label: QUALITY_LABELS[2],
      status: amt >= MIN_SUPPLY_AMOUNT ? "pass" : "fail",
      detail: `외국인+기관 순매수 합산 약 ${fmtWon(amt)} (50억원 기준) · 연기금/프로그램 세부 구분은 판단불가`,
    });
  } else if (snap.foreignNetBuy1d != null && snap.instNetBuy1d != null) {
    const ok = snap.foreignNetBuy1d > 0 && snap.instNetBuy1d > 0;
    quality.push({
      label: QUALITY_LABELS[2],
      status: ok ? "pass" : "fail",
      detail: "동반 순매수 수량 기준으로만 확인됨(금액 필드 미확보) · 연기금/프로그램 세부 구분은 판단불가",
    });
  } else {
    quality.push({ label: QUALITY_LABELS[2], status: "unknown", detail: "수급 데이터 미확보" });
  }

  if (news == null) {
    quality.push({
      label: QUALITY_LABELS[3],
      status: "unknown",
      detail: "뉴스 피드 미확보 — 수동 확인 필요",
    });
  } else {
    quality.push({
      label: QUALITY_LABELS[3],
      status: news.length === 0 ? "unknown" : "unknown",
      detail: `종목 뉴스 ${news.length}건 — 단발성 테마인지 펀더멘털 뉴스인지는 직접 읽고 판단 (자동 판단 안 함)`,
      newsItems: news.length ? news : undefined,
    });
  }

  const kospi = opts.indices?.find((i) => /kospi/i.test(i.name) || i.code === "0001" || i.code === "KOSPI");
  const kosdaq = opts.indices?.find((i) => /kosdaq/i.test(i.name) || i.code === "1001" || i.code === "KOSDAQ");
  if (kospi?.changeRatePct == null && kosdaq?.changeRatePct == null) {
    quality.push({
      label: QUALITY_LABELS[4],
      status: "unknown",
      detail: "KOSPI/KOSDAQ 지수 등락률 미확보",
    });
  } else {
    const parts = [];
    if (kospi?.changeRatePct != null) parts.push(`KOSPI ${fmtPct(kospi.changeRatePct)}`);
    if (kosdaq?.changeRatePct != null) parts.push(`KOSDAQ ${fmtPct(kosdaq.changeRatePct)}`);
    const downHard = (kospi?.changeRatePct ?? 0) <= -1.5;
    quality.push({
      label: QUALITY_LABELS[4],
      status: downHard ? "fail" : "pass",
      detail: `${parts.join(" · ")} — 지수 급락(-1.5% 이하) 시 종가베팅 가중치 하향. 주도 테마 여부는 별도 확인`,
    });
  }

  quality.push({
    label: QUALITY_LABELS[5],
    status: "unknown",
    detail: "공매도 비중/대주주 매도 공시는 공매도 종합포털·DART가 필요해 자동 판정하지 않음 — 매매 전 수동 확인",
  });

  quality.push({
    label: QUALITY_LABELS[6],
    status: "unknown",
    detail: "실시간 1분/5분봉·호가 잔량은 미연동(일봉 기준) — 매수 직전 HTS/MTS 차트에서 직접 확인",
  });

  let stopLoss: number | null = null;
  let stopBasis: string;
  if (atr != null && snap.currentPrice != null) {
    stopLoss = Math.round(snap.currentPrice - atr * 1.5);
    stopBasis = `ATR(14)=${atr.toLocaleString("ko-KR")} 기준: 현재가 − ATR×1.5`;
    quality.push({
      label: QUALITY_LABELS[7],
      status: "pass",
      detail: `ATR 기반 손절가 ${stopLoss.toLocaleString("ko-KR")}원 제안 · 개별 종목은 총 투자금의 1~2% 이내 · 목표가 도달 시 50% 이상 분할 익절 권장(자동 매도 아님)`,
    });
  } else {
    stopLoss = snap.currentPrice != null ? Math.round(snap.currentPrice * 0.97) : null;
    stopBasis = "ATR 계산 불가(데이터 부족)로 -3% 근사치 사용";
    quality.push({
      label: QUALITY_LABELS[7],
      status: "unknown",
      detail: "ATR 계산에 필요한 일봉 데이터 부족 - 근사치(-3%)로 대체 · 개별 종목은 총 투자금의 1~2% 이내 권장",
    });
  }

  let targetPrice: number | null = null;
  let targetBasis = "데이터 부족으로 산출 불가";
  if (snap.high20d != null) {
    targetPrice = Math.round(snap.high20d * 1.05);
    targetBasis = `최근 20일 고가 ${snap.high20d.toLocaleString("ko-KR")}원 재돌파 기준 +5% 근사 목표`;
  } else if (snap.currentPrice != null) {
    targetPrice = Math.round(snap.currentPrice * 1.05);
    targetBasis = "최근 고가 데이터 미확보로 현재가 +5% 근사 목표 사용";
  }

  const reasonParts = conditions.filter((c) => c.status === "pass").map((c) => c.label);
  const reasonSummary = reasonParts.length
    ? `충족: ${reasonParts.join(", ")}`
    : "충족된 핵심 조건 없음(참고용으로만 확인)";

  const rankSources: string[] = [];
  if (opts.isTradingValueTop) rankSources.push("거래대금 상위");
  if (opts.isChangeRateTop) rankSources.push("등락률 상위");

  const extraRisk: string[] = [];
  if (snap.marketCapEok != null && snap.marketCapEok < 1000) {
    extraRisk.push(`시가총액 ${Math.round(snap.marketCapEok)}억원 — 종가베팅 유동성 하한(1,000억원) 미달`);
  }
  if (snap.listedShares != null) {
    const sh = snap.listedShares;
    if (sh < 20_000_000 || sh > 120_000_000) {
      extraRisk.push(`상장주식수 ${(sh / 10_000).toFixed(0)}만주 — 유동 5천만주 내외 기준과 거리 있음(유통주식 미제공, 상장주로 근사)`);
    }
  }
  if (snap.ma5 != null && snap.ma10 != null && snap.ma20 != null && snap.currentPrice != null) {
    const aligned = snap.currentPrice > snap.ma5 && snap.ma5 > snap.ma10 && snap.ma10 > snap.ma20;
    if (!aligned) extraRisk.push("단기 이평(5·10·20) 정배열이 아님 — 주도주 필터에서 가중치 하향");
  }

  return {
    stockCode: snap.stockCode,
    stockName: snap.stockName,
    currentPrice: snap.currentPrice,
    changeRatePct: snap.changeRatePct,
    tradingValueToday: snap.tradingValueToday,
    reasonSummary,
    conditions,
    qualityChecks: quality,
    targetPrice,
    targetBasis,
    stopLoss,
    stopLossBasis: stopBasis,
    riskNotes: [
      ...extraRisk,
      "목표가/손절가는 규칙 기반 근사치이며 확정된 미래 예측이 아닙니다.",
      "뉴스·공매도·실시간 호가는 직접 확인 후 매매하세요.",
      "포지션 크기는 총 투자금의 1~2% 이내, 목표가 도달 시 최소 50% 분할 익절을 권장합니다.",
    ],
    matchScore,
    rankSources,
  };
}

export function rankClosingBetCandidates(
  candidates: ClosingBetCandidate[],
  topN = 10,
): ClosingBetCandidate[] {
  return [...candidates]
    .sort((a, b) => {
      if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
      const tv = (b.tradingValueToday ?? 0) - (a.tradingValueToday ?? 0);
      if (tv !== 0) return tv;
      return a.stockCode.localeCompare(b.stockCode);
    })
    .slice(0, topN);
}
