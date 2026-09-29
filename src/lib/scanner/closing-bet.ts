import type { CheckItem, ClosingBetCandidate, DailyBar, LiveSnapshot, MarketIndex } from "./types";
import { computeAtr, computeRsi, countConsecutiveNetBuyDays, toNum } from "./indicators";

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

function barClose(bar: DailyBar | undefined): number | null {
  return toNum(bar?.stck_clpr);
}

/** 직전 거래일 등락. 일봉이 없으면 null. 없는 숫자를 만들지 않는다. */
export function prevSessionChangePct(daily: DailyBar[]): number | null {
  const prev = barClose(daily[1]);
  const before = barClose(daily[2]);
  if (prev == null || before == null || before === 0) return null;
  return ((prev - before) / before) * 100;
}

export function volumeMultiple(snap: LiveSnapshot): number | null {
  const today = snap.volume ?? toNum(snap.dailyPrices[0]?.acml_vol);
  const prior = snap.dailyPrices
    .slice(1, 21)
    .map((b) => toNum(b.acml_vol))
    .filter((n): n is number => n != null && n > 0);
  if (today == null || prior.length < 5) return null;
  const avg = prior.reduce((a, b) => a + b, 0) / prior.length;
  return avg > 0 ? today / avg : null;
}

/**
 * 9/28 종가 → 9/29 시초에서 갈린 차이.
 * 한화솔루션 +17% 고점 마감, SK이노베이션 이틀 연속 +5%는 시초 매도가 나왔고
 * LG이노텍은 전일 하락 다음 하루 급등 후 고점에서 되돌려 마감했다.
 * 당일 +12% 이상, 전일·당일 모두 +5% 이상, 거래량 4배 이상이면서 +10%면 추격으로 본다.
 */
export function chaseBlockReason(snap: LiveSnapshot): string | null {
  const chg = snap.changeRatePct;
  const prev = prevSessionChangePct(snap.dailyPrices);
  const vol = volumeMultiple(snap);
  const parts: string[] = [];
  if (chg != null && chg >= 12) parts.push(`당일 ${fmtPct(chg)} (12% 이상 마감)`);
  if (chg != null && prev != null && chg >= 5 && prev >= 5) {
    parts.push(`전일 ${fmtPct(prev)} · 당일 ${fmtPct(chg)} 연속 급등`);
  }
  if (vol != null && vol >= 4 && (chg ?? 0) >= 10) {
    parts.push(`거래량 ${vol.toFixed(1)}배 · 당일 ${fmtPct(chg)} 과열`);
  }
  if (!parts.length) return null;
  return parts.join(" · ");
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
  const chaseWhy = chaseBlockReason(snap);
  const chaseBlocked = chaseWhy != null;
  const prevChg = prevSessionChangePct(snap.dailyPrices);
  if (snap.highPrice == null || snap.currentPrice == null || snap.highPrice === 0) {
    conditions.push({
      label: CONDITION_LABELS[3],
      status: "unknown",
      detail: "당일 고가/현재가 데이터 미확보",
    });
  } else {
    pullbackPct = ((snap.highPrice - snap.currentPrice) / snap.highPrice) * 100;
    const chg = snap.changeRatePct;
    const digested = pullbackPct > 3 && pullbackPct <= 8 && (chg ?? 0) > 0 && (chg ?? 99) < 12 && !chaseBlocked;
    const nearHighOk = pullbackPct >= 0 && pullbackPct <= 3 && (chg == null || chg < 10) && !chaseBlocked;
    if (chaseBlocked && pullbackPct <= 4) {
      conditions.push({
        label: CONDITION_LABELS[3],
        status: "fail",
        detail: `고가 대비 ${pullbackPct.toFixed(1)}%로 고점 근처 마감. ${chaseWhy}. 이 형태는 다음날 시초부터 매도 우위가 나온 사례가 있어 통과로 세지 않습니다.`,
      });
    } else if (nearHighOk) {
      conditions.push({
        label: CONDITION_LABELS[3],
        status: "pass",
        detail: `당일 고가 대비 ${pullbackPct.toFixed(1)}%. 과열 마감은 아닙니다.`,
      });
    } else if (digested) {
      conditions.push({
        label: CONDITION_LABELS[3],
        status: "pass",
        detail: `장중 고점 대비 ${pullbackPct.toFixed(1)}% 되돌려 마감. 윗꼬리를 메우는 시초 매수세가 있는지는 다음날 확인.`,
      });
    } else {
      conditions.push({
        label: CONDITION_LABELS[3],
        status: "fail",
        detail: `당일 고가 대비 ${pullbackPct.toFixed(1)}%. ${chaseBlocked ? chaseWhy : "고점 밀착도 장중 분봉은 일봉으로 근사합니다."}`,
      });
    }
  }

  conditions.push(
    chaseBlocked
      ? {
          label: "과열 추격 배제",
          status: "fail",
          detail: `${chaseWhy}. 전일 등락 ${fmtPct(prevChg)}. 같은 3/5여도 이 칸에서 갈립니다.`,
        }
      : {
          label: "과열 추격 배제",
          status: snap.changeRatePct == null && prevChg == null ? "unknown" : "pass",
          detail:
            snap.changeRatePct == null && prevChg == null
              ? "당일·전일 등락을 모두 못 받아 과열 여부를 판단하지 않습니다."
              : `당일 ${fmtPct(snap.changeRatePct)} · 전일 ${fmtPct(prevChg)}. 12% 이상 마감, 이틀 연속 +5%, 거래량 4배의 +10% 마감은 아닙니다.`,
        },
  );

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
  } else if (volRatio >= 4 && (snap.changeRatePct ?? 0) >= 10) {
    quality.push({
      label: QUALITY_LABELS[0],
      status: "fail",
      detail: `최근 평균 대비 거래량 약 ${volRatio.toFixed(1)}배 · 당일 ${fmtPct(snap.changeRatePct)}. 3~5배 증가가 아니라 급등일 거래 폭증이라 통과로 세지 않습니다.`,
    });
  } else {
    quality.push({
      label: QUALITY_LABELS[0],
      status: volRatio >= 3 && volRatio <= 5 ? "pass" : "fail",
      detail: `최근 평균 대비 거래량 약 ${volRatio.toFixed(1)}배 (일봉 근사, 기준 3~5배) · 매수체결강도는 실시간 체결 미연동`,
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
      ...(chaseBlocked ? [`추격제외: ${chaseWhy}`] : []),
      ...extraRisk,
      "목표가/손절가는 규칙 기반 근사치이며 확정된 미래 예측이 아닙니다.",
      "뉴스·공매도·실시간 호가는 직접 확인 후 매매하세요.",
      "포지션 크기는 총 투자금의 1~2% 이내, 목표가 도달 시 최소 50% 분할 익절을 권장합니다.",
    ],
    matchScore,
    rankSources,
    chaseBlocked,
  };
}

/** 15시 종가배팅: 과열 마감은 거래대금이 커도 뒤로. 나머지는 거래대금, 같으면 조건 점수. */
export function rankClosingBetCandidates(
  candidates: ClosingBetCandidate[],
  topN = 10,
): ClosingBetCandidate[] {
  return [...candidates]
    .sort((a, b) => {
      const aBlock = a.chaseBlocked ? 1 : 0;
      const bBlock = b.chaseBlocked ? 1 : 0;
      if (aBlock !== bBlock) return aBlock - bBlock;
      const av = a.tradingValueToday ?? 0;
      const bv = b.tradingValueToday ?? 0;
      const aHas = av > 0;
      const bHas = bv > 0;
      if (aHas !== bHas) return aHas ? -1 : 1;
      if (bv !== av) return bv - av;
      if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
      return a.stockCode.localeCompare(b.stockCode);
    })
    .slice(0, topN);
}
