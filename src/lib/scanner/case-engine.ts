import type { CaseVerdict, LiveSnapshot, MarketIndex } from "./types";
import { MIN_AVG_TRADING_VALUE, MIN_PRICE } from "./types";

export const CASE_PRIORITY_ORDER = [9, 8, 1, 2, 10, 11, 5, 6, 7, 3, 4] as const;

export const CASE_PROBABILITY_LABEL: Record<number, string> = {
  9: "최고 확률",
  8: "매우 높음",
  1: "높음",
  2: "높음",
  10: "중상",
  11: "중상",
  5: "중",
  6: "중",
  7: "중하",
  3: "중하",
  4: "상대적 낮음",
};

const CASE_TIMING_STYLE: Record<number, string> = {
  1: "종가확인형",
  2: "종가확인형",
  3: "즉시형",
  4: "종가확인형",
  5: "즉시형",
  6: "즉시형",
  7: "종가확인형",
  8: "스윙형",
  9: "스윙형",
  10: "종가확인형",
  11: "즉시형",
};

export const CASE_TITLES: Record<number, string> = {
  1: "신고가 횡보 + 이평선 수렴 + 외국인 연속매수",
  2: "장기조정 후 20일선 돌파 + 기관 매집",
  3: "거래대금 급증 + 프로그램 매수 전환",
  4: "급락 후 아래꼬리 + 20일선 지지",
  5: "과열 후 조정 + 매물대 돌파",
  6: "지수급락 속 지지 방어 + 기관매수",
  7: "급락 회복탄력 + 이평선밀집 반등",
  8: "변동성 속 정배열 우상향 + 연기금매집",
  9: "견고한 우상향 + 연기금 지속매집",
  10: "전고점 실패 후 저점상향 + 기관외인 동반매수",
  11: "박스권 돌파 시도 + 120일선 우상향",
};

const COMMON_PROHIBITED = [
  "이탈가(전략 무효화 가격)를 하회했는데도 손절을 미루는 행위",
  "목표가 도달 전 뉴스/루머만으로 추가 물량을 몰아서 매수하는 행위",
  "장 마감 전 미확정 데이터만으로 '종가확인형' 케이스를 즉시 매매로 실행하는 행위",
  "서로 다른 CASE 근거를 섞어 손절 기준을 임의로 상향/하향하는 행위",
];

function missing(...vals: Array<number | null | undefined>): boolean {
  return vals.some((v) => v == null);
}

export function isPennyStock(snap: LiveSnapshot, minPrice = MIN_PRICE): boolean {
  if (snap.currentPrice == null) return false;
  return snap.currentPrice < minPrice;
}

export function passesBlueChipFilter(snap: LiveSnapshot): boolean {
  if (snap.currentPrice == null) return false;
  if (isPennyStock(snap)) return false;
  if (snap.avgTradingValue5d != null && snap.avgTradingValue5d < MIN_AVG_TRADING_VALUE) return false;
  return true;
}

export function evaluateCase(
  caseId: number,
  snap: LiveSnapshot,
  indices?: MarketIndex[],
): CaseVerdict {
  const reasons: string[] = [];
  const warnings: string[] = [];
  let verdict: CaseVerdict["verdict"] = "관망";
  const timingStyle = CASE_TIMING_STYLE[caseId] ?? "종가확인형";
  const baseTiming = () => {
    if (timingStyle === "즉시형") return "즉시(장중 실시간 확인 필요)";
    if (timingStyle === "스윙형") return "스윙 관점 - 눌림목 발생 시 분할 진입";
    return "당일 종가 확정 후 신뢰도 상승 - 종가 확인 후 익일 시가로 최종 판단";
  };
  let actionTiming = baseTiming();
  let targetPrice: number | null = null;
  let targetBasis = "데이터 부족으로 산출 불가";
  let exitPrice: number | null = null;
  let exitBasis = "데이터 부족으로 산출 불가";

  const sd: string[] = [];
  if (snap.foreignNetBuy1d != null) sd.push(`전일 외국인 순매수 ${snap.foreignNetBuy1d.toLocaleString("ko-KR")}`);
  if (snap.instNetBuy1d != null) sd.push(`전일 기관 순매수 ${snap.instNetBuy1d.toLocaleString("ko-KR")}`);
  if (snap.instNetBuyCum20 != null) sd.push(`최근 20일 기관 누적순매수 ${snap.instNetBuyCum20.toLocaleString("ko-KR")}`);
  if (snap.pensionNetBuyCum20 != null)
    sd.push(`최근 20일 연기금 누적순매수 ${snap.pensionNetBuyCum20.toLocaleString("ko-KR")}`);
  const supplyDemandNote = sd.length ? sd.join(" / ") : "수급 데이터 미확보";

  const kospi = indices?.find((i) => i.code === "0001");

  if (caseId === 1) {
    if (missing(snap.currentPrice, snap.high20d, snap.ma5, snap.ma20)) {
      warnings.push("현재가/최근20일고가/5·20일 이평선 중 일부 미확보");
    } else {
      const boxTop = snap.high20d!;
      targetPrice = Math.round(boxTop * 1.05);
      targetBasis = `최근 20일 고가(박스권 상단) ${boxTop.toLocaleString("ko-KR")}원 재돌파 기준 +5% 근사 목표`;
      exitPrice = snap.ma5 != null ? Math.round(snap.ma5) : null;
      exitBasis = "5일선 이탈 시 수렴 구도 붕괴로 판단, 후보 교체";
      if (snap.currentPrice! >= boxTop) {
        reasons.push(`현재가 ${snap.currentPrice!.toLocaleString("ko-KR")}원이 박스권 상단 ${boxTop.toLocaleString("ko-KR")}원 이상`);
        if ((snap.foreignNetBuy1d ?? 0) > 0 && (snap.foreignNetBuy2d ?? 0) > 0) {
          verdict = "적극매수";
          actionTiming = "즉시 (박스 상단 돌파 + 외국인 2일 연속 순매수 확인됨)";
          reasons.push("외국인 2거래일 연속 순매수 확인");
        } else {
          verdict = "매수";
          actionTiming = "돌파는 확인되었으나 외국인 2일 연속 순매수 미확인 - 종가 기준 재확인";
        }
      } else {
        reasons.push(`현재가 ${snap.currentPrice!.toLocaleString("ko-KR")}원, 박스권 상단 ${boxTop.toLocaleString("ko-KR")}원 아직 미돌파`);
      }
    }
  } else if (caseId === 2) {
    if (missing(snap.currentPrice, snap.ma20, snap.volume, snap.prevVolume)) {
      warnings.push("현재가/20일선/거래량 데이터 일부 미확보");
    } else {
      exitPrice = Math.round(snap.ma20!);
      exitBasis = "20일선(종가 기준) 재이탈 시 돌파 실패로 간주";
      targetPrice = Math.round(snap.ma20! * 1.1);
      targetBasis = "20일선 돌파 시작가 대비 통상 스윙 목표(+10%) 근사치";
      const volRatio = snap.prevVolume ? snap.volume! / snap.prevVolume : null;
      if (snap.currentPrice! > snap.ma20! && volRatio && volRatio >= 1.5) {
        reasons.push(`20일선 ${snap.ma20!.toLocaleString("ko-KR")}원 상향 돌파, 거래량 전일比 ${(volRatio * 100).toFixed(0)}%`);
        if ((snap.instNetBuyCum20 ?? 0) > 0) {
          verdict = "적극매수";
          actionTiming = "종가 확정 확인 후 즉시(익일 시가 갭 여부로 2차 확인 권장)";
          reasons.push("최근 20일 기관 누적 순매수 확인");
        } else {
          verdict = "매수";
          actionTiming = "돌파는 확인, 기관 누적 매수 데이터 미확인 - 신중 진입";
        }
      }
    }
  } else if (caseId === 3) {
    if (missing(snap.currentPrice, snap.lowPrice)) {
      warnings.push("현재가/저가 데이터 미확보 (프로그램 순매수는 별도 확인)");
    } else {
      const riseFromLow = snap.lowPrice ? (snap.currentPrice! - snap.lowPrice) / snap.lowPrice : 0;
      targetPrice = Math.round(snap.currentPrice! * 1.05);
      targetBasis = "단기 반등 트리거 성격 - 진입가 대비 +5% 근사 목표";
      exitPrice = Math.round(snap.lowPrice!);
      exitBasis = "당일 저가 재이탈 시 매물 소화 실패로 판단";
      if (riseFromLow >= 0.03 && (snap.tradingValueToday ?? 0) > 0) {
        verdict = "매수";
        actionTiming = "즉시(장중 실시간) - 지속성이 약한 케이스이므로 짧은 목표 관리 필수";
        reasons.push(`저가 대비 반등폭 ${(riseFromLow * 100).toFixed(1)}% + 당일 거래대금 확인`);
      }
    }
  } else if (caseId === 4) {
    if (missing(snap.currentPrice, snap.lowPrice, snap.openPrice, snap.ma20)) {
      warnings.push("현재가/저가/시가/20일선 데이터 미확보");
    } else {
      const tailRatio = snap.lowPrice ? (snap.currentPrice! - snap.lowPrice) / snap.lowPrice : 0;
      const nearMa20 = snap.ma20 ? Math.abs(snap.lowPrice! - snap.ma20) / snap.ma20 <= 0.03 : false;
      targetPrice = Math.round(snap.ma20! * 1.08);
      targetBasis = "20일선 지지 확인 후 통상 회복 목표(+8%) 근사치";
      exitPrice = Math.round(snap.ma20! * 0.97);
      exitBasis = "20일선 대비 -3% 초과 이탈 시 지지 실패";
      if (tailRatio >= 0.03 && nearMa20 && snap.currentPrice! >= snap.ma20!) {
        verdict = "매수";
        actionTiming = "당일 종가 아래꼬리 확정 확인 후, 익일 시가 갭 여부로 2차 확인";
        reasons.push("저가 대비 종가 반등폭 3% 이상 + 20일선 지지 확인");
      }
    }
  } else if (caseId === 5) {
    if (missing(snap.currentPrice, snap.high20d, snap.ma20, snap.volume, snap.prevVolume)) {
      warnings.push("현재가/최근20일고가/20일선/거래량 데이터 일부 미확보");
    } else {
      const supplyZone = snap.high20d!;
      const volRatio = snap.prevVolume ? snap.volume! / snap.prevVolume : null;
      targetPrice = Math.round(supplyZone * 1.08);
      targetBasis = "매물대(최근 20일 고가권) 돌파 기준 +8% 근사 목표";
      exitPrice = Math.round(snap.ma20!);
      exitBasis = "20일선(추세선) 이탈 시 눌림목 실패로 판단";
      if (snap.currentPrice! > supplyZone && snap.currentPrice! > snap.ma20! && volRatio && volRatio >= 1.2) {
        verdict = "매수";
        actionTiming = "즉시(시초가 형성 후 30분~1시간)";
        reasons.push("매물대 돌파 + 거래량 전일比 120% 이상 확인");
      }
    }
  } else if (caseId === 6) {
    if (missing(snap.currentPrice, snap.lowPrice, snap.openPrice, snap.ma60)) {
      warnings.push("현재가/저가/시가/60일선 데이터 일부 미확보");
    } else {
      const recover = snap.lowPrice ? (snap.currentPrice! - snap.lowPrice) / snap.lowPrice : 0;
      const nearSupport = snap.ma60 ? Math.abs(snap.currentPrice! - snap.ma60) / snap.ma60 <= 0.03 : false;
      targetPrice = snap.high20d != null ? Math.round(snap.high20d) : null;
      targetBasis = "지수 반등 시 최근 전고점 회복을 목표로 근사";
      exitPrice = snap.ma60 != null ? Math.round(snap.ma60 * 0.97) : null;
      exitBasis = "60일선 대비 -3% 초과 이탈 시 지지 실패";
      const indexDown = kospi?.changeRatePct != null ? kospi.changeRatePct <= -1 : null;
      if (indexDown === false) {
        actionTiming = "이 CASE는 지수 급락 당일에만 성립 - 현재 KOSPI가 급락 구간이 아님";
      } else if (recover >= 0.02 && nearSupport && (snap.instNetBuy1d ?? 0) > 0) {
        verdict = "매수";
        actionTiming = "지수 급락 당일에만 유효 - 즉시 확인";
        reasons.push("낙폭 축소 2% 이상 + 60일선 부근 지지 + 기관 순매수 확인");
        if (indexDown) reasons.push(`KOSPI ${kospi!.changeRatePct!.toFixed(2)}% (급락 구간)`);
      }
    }
  } else if (caseId === 7) {
    if (missing(snap.currentPrice, snap.high20d, snap.ma5, snap.ma20, snap.volume, snap.prevVolume)) {
      warnings.push("현재가/최근고가/이평선/거래량 데이터 일부 미확보");
    } else {
      const nearHigh = snap.high20d ? Math.abs(snap.currentPrice! - snap.high20d) / snap.high20d <= 0.03 : false;
      const maConverge = snap.ma5 && snap.ma20 ? Math.abs(snap.ma5 - snap.ma20) / snap.ma20 <= 0.05 : false;
      const volRatio = snap.prevVolume ? snap.volume! / snap.prevVolume : null;
      targetPrice = snap.high20d != null ? Math.round(snap.high20d) : null;
      targetBasis = "전고점 재돌파를 목표가로 설정";
      exitPrice = snap.ma5 && snap.ma20 ? Math.round(Math.min(snap.ma5, snap.ma20)) : null;
      exitBasis = "이평선 밀집대 하단 이탈 시 반등 실패로 판단";
      if (nearHigh && maConverge && volRatio && volRatio >= 1) {
        verdict = "매수";
        actionTiming = "종가 부근 전고점 돌파 확정 여부 확인 후 진입";
        reasons.push("전고점 근접 + 이평선 밀집 + 거래량 전일 수준 이상 확인");
      }
    }
  } else if (caseId === 8) {
    if (missing(snap.ma5, snap.ma10, snap.ma20)) {
      warnings.push("단기 이평선(5·10·20일) 데이터 미확보");
    } else {
      const aligned = snap.ma5! >= snap.ma10! && snap.ma10! >= snap.ma20!;
      targetBasis = "스윙/중기 케이스로 고정 목표가 대신 10일선 트레일링 관리 권장";
      exitPrice = Math.round(snap.ma10!);
      exitBasis = "10일선(정배열 기준선) 종가 이탈 시 추세 훼손";
      if (aligned && (snap.pensionNetBuyCum20 ?? 0) > 0) {
        verdict = "매수";
        actionTiming = "스윙 관점 - 눌림목 발생 시 분할 매수";
        reasons.push("5·10·20일선 정배열 우상향 + 연기금 누적 순매수 확인");
      } else if (aligned) {
        actionTiming = "정배열은 확인되나 연기금 매집 데이터 미확인 - 스크리닝 후보로만 관리";
      }
    }
  } else if (caseId === 9) {
    if (missing(snap.currentPrice, snap.ma60)) {
      warnings.push("현재가/60일선 데이터 미확보");
    } else {
      const above = snap.currentPrice! >= snap.ma60!;
      targetBasis = "스윙/중기 케이스 - 60일선 트레일링 관리 권장";
      exitPrice = Math.round(snap.ma60!);
      exitBasis = "60일선(종가 기준) 이탈 시 추세 훼손";
      if (above && (snap.pensionNetBuyCum20 ?? 0) > 0) {
        verdict = "적극매수";
        actionTiming = "스윙 관점 - 눌림목 발생 시 분할 진입";
        reasons.push("60일선 위 우상향 유지 + 연기금 누적 순매수 확인");
      } else if (above) {
        verdict = "매수";
        actionTiming = "60일선 우상향은 확인되나 연기금 매집 데이터 미확인";
      }
    }
  } else if (caseId === 10) {
    if (missing(snap.currentPrice, snap.high20d, snap.low20d)) {
      warnings.push("현재가/최근20일 고가·저가 데이터 미확보");
    } else {
      const pullback = snap.high20d ? (snap.high20d - snap.currentPrice!) / snap.high20d : 0;
      const nearFail = pullback >= 0.01 && pullback <= 0.08;
      targetPrice = Math.round(snap.high20d!);
      targetBasis = "직전 전고점 재돌파를 목표가로 설정";
      exitPrice = snap.low20d != null ? Math.round(snap.low20d) : null;
      exitBasis = "최근 저점 하회 시 저점 상향 구조 붕괴";
      const both =
        (snap.foreignNetBuy1d ?? 0) > 0 && (snap.instNetBuy1d ?? 0) > 0;
      if (nearFail && both) {
        verdict = "매수";
        actionTiming = "종가 확정 후 기관·외인 동반 순매수 최종 확정치 재확인";
        reasons.push("전고점 -1%~-8% 구간 + 기관·외국인 동반 순매수 확인");
      }
    }
  } else if (caseId === 11) {
    if (missing(snap.currentPrice, snap.high60d, snap.low60d, snap.ma120, snap.volume, snap.prevVolume)) {
      warnings.push("현재가/60일 고저/120일선/거래량 데이터 일부 미확보");
    } else {
      const boxHeight = snap.high60d! - snap.low60d!;
      const boxTop = snap.high60d!;
      const volRatio = snap.prevVolume ? snap.volume! / snap.prevVolume : null;
      targetPrice = Math.round(boxTop + boxHeight);
      targetBasis = "박스권 상단 돌파 + 박스 높이만큼 추가 상승(박스권 폭 이론) 근사 목표";
      exitPrice = snap.ma60 != null ? Math.round(snap.ma60) : Math.round(boxTop * 0.97);
      exitBasis = "60일선 이탈 시 박스권 지지 붕괴";
      if (snap.currentPrice! >= boxTop * 0.98 && volRatio && volRatio >= 1.5) {
        verdict = "매수";
        actionTiming = "즉시(오전 우선 확인, 종가 재확인)";
        reasons.push("박스권 상단 근접/돌파 + 거래량 전일比 150% 이상");
      }
    }
  }

  let dataConfidence: string;
  if (warnings.length) {
    dataConfidence = reasons.length || targetPrice != null ? "일부 미확보" : "판단불가(데이터 부족)";
    if (!reasons.length && targetPrice == null) {
      verdict = "판단불가";
      actionTiming = "데이터 미확보로 판단 보류 - 재조회 필요";
    }
  } else {
    dataConfidence = "실측";
  }

  return {
    caseId,
    caseTitle: CASE_TITLES[caseId] ?? `CASE ${caseId}`,
    probabilityLabel: CASE_PROBABILITY_LABEL[caseId] ?? "",
    stockCode: snap.stockCode,
    stockName: snap.stockName,
    verdict,
    actionTiming,
    currentPrice: snap.currentPrice,
    targetPrice,
    targetBasis,
    exitPrice,
    exitBasis,
    supplyDemandNote,
    reasons,
    warnings: [...warnings, ...snap.errors],
    prohibitedActions: [...COMMON_PROHIBITED],
    dataConfidence,
  };
}

export function rankTop5(verdictsByCase: Record<number, CaseVerdict[]>): CaseVerdict[] {
  const orderScore: Record<string, number> = { 적극매수: 2, 매수: 1 };
  const result: CaseVerdict[] = [];
  const seen = new Set<string>();
  for (const cid of CASE_PRIORITY_ORDER) {
    const candidates = (verdictsByCase[cid] ?? [])
      .filter((v) => v.verdict in orderScore)
      .sort((a, b) => (orderScore[b.verdict] ?? 0) - (orderScore[a.verdict] ?? 0));
    for (const v of candidates) {
      if (seen.has(v.stockCode)) continue;
      result.push(v);
      seen.add(v.stockCode);
      if (result.length >= 5) return result;
    }
  }
  return result;
}
