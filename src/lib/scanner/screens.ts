import type { LiveSnapshot, NewsItem } from "./types";
import { computeMa, computeMacd, computeRsi, toNum } from "./indicators";
import { classifyTheme } from "./themes";

const GROWTH = new Set(["ai", "semi-eqp", "semi-mat", "robot", "bio"]);

export type SignHit = {
  code: string;
  name: string;
  kind: "급등" | "급락" | "공시";
  title: string;
  detail: string;
  evidence: string;
};

export type DipHit = {
  code: string;
  name: string;
  theme: string;
  price: number | null;
  windowDays: number;
  fromHighPct: number | null;
  fromLowPct: number | null;
  rsi: number | null;
  volRatio: number | null;
  techHits: string[];
  missing: string[];
  step1: number | null;
  step2: number | null;
  step3: number | null;
  stop: number | null;
  priority: 1 | 2 | 3;
  news: string[];
  dartLines?: string[];
  note: string;
};

function titles(news: NewsItem[] | null): string {
  return (news ?? []).map((n) => n.title).join(" ");
}

function hitNews(text: string, patterns: RegExp[]): string | null {
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[0];
  }
  return null;
}

export function detectSigns(env: LiveSnapshot): SignHit[] {
  const out: SignHit[] = [];
  const name = env.stockName ?? env.stockCode;
  const text = titles(env.newsItems);
  const push = (kind: SignHit["kind"], title: string, detail: string, evidence: string) => {
    out.push({ code: env.stockCode, name, kind, title, detail, evidence });
  };

  const audit = hitNews(text, [/감사보고서/, /감사인.?교체/, /감사의견/, /의견거절/, /한정.?의견/]);
  if (audit) push("급락", "감사 이슈", "기사 제목에 감사·의견 관련 표현이 있습니다. 발생 확률은 추정하지 않습니다.", audit);

  const cfo = hitNews(text, [/CFO.?사임/, /재무.?사임/, /대표이사.?사임/, /임원.?사임/]);
  if (cfo) push("급락", "임원 사임", "사임 관련 제목이 있습니다. 거래정지 여부는 공시로 확인하세요.", cfo);

  const pledge = hitNews(text, [/주식담보/, /담보대출/, /담보.?제공/]);
  if (pledge) push("급락", "주식담보", "담보 관련 제목만 확인했습니다. 과다 여부는 공시 잔액이 없어 판단하지 않습니다.", pledge);

  const insider = hitNews(text, [/최대주주.{0,12}(매수|취득)/, /임원.{0,8}(장내매수|매수|취득)/, /대표이사.{0,6}매수/, /임원ㆍ주요주주특정증권/, /임원·주요주주특정증권/, /최대주주등소유주식변동/]);
  if (insider) {
    const sell = /처분|매도|감소/.test(text);
    const buy = /취득|매수|증가/.test(text);
    push(
      sell && !buy ? "급락" : buy && !sell ? "급등" : "공시",
      "내부자 지분 공시",
      sell && !buy
        ? "처분·매도 표현이 있습니다. 수량은 공시 본문이 없으면 적지 않습니다."
        : buy && !sell
          ? "취득·매수 표현이 있습니다. 수량은 공시 본문이 없으면 적지 않습니다."
          : "임원·주요주주 소유 변동 공시입니다. 제목만으로는 매수인지 매도인지 단정하지 않습니다.",
      insider,
    );
  }

  const cb = hitNews(text, [/리픽싱/, /전환가액/, /전환사채/, /\bCB\b/, /\bBW\b/]);
  if (cb) push("급등", "CB/BW 언급", "전환사채·리픽싱 제목입니다. 최저 리픽싱 도달 여부는 공시 숫자 없이 단정하지 않습니다.", cb);

  const daily = env.dailyPrices;
  const vols = daily.slice(0, 21).map((b) => toNum(b.acml_vol)).filter((n): n is number => n != null && n > 0);
  const avg20 = vols.length >= 6 ? vols.slice(1, 21).reduce((a, b) => a + b, 0) / Math.max(1, vols.slice(1, 21).length) : null;
  const todayV = vols[0] ?? null;
  const price = env.currentPrice;
  const high20 = Math.max(
    ...daily
      .slice(0, 20)
      .map((b) => toNum(b.stck_hgpr) ?? 0)
      .filter((n) => n > 0),
    0,
  );
  const low20 = (() => {
    const lows = daily
      .slice(0, 20)
      .map((b) => toNum(b.stck_lwpr))
      .filter((n): n is number => n != null && n > 0);
    return lows.length ? Math.min(...lows) : null;
  })();
  const bar = daily[0];
  const o = toNum(bar?.stck_oprc);
  const h = toNum(bar?.stck_hgpr);
  const l = toNum(bar?.stck_lwpr);
  const c = toNum(bar?.stck_clpr) ?? price;

  if (o != null && h != null && l != null && c != null && todayV != null && avg20 != null && low20 != null) {
    const body = Math.abs(c - o);
    const upper = h - Math.max(c, o);
    if (upper > Math.max(body, c * 0.01) * 1.5 && c <= low20 * 1.15 && todayV >= avg20 * 2) {
      push(
        "급등",
        "바닥권 위꼬리",
        `당일 위꼬리 ${Math.round(upper).toLocaleString("ko-KR")}원, 거래량 ${Math.round(todayV / avg20 * 10) / 10}배. 매집 주체는 확인하지 않습니다.`,
        "일봉 고가·종가·거래량",
      );
    }
    if (c <= o && high20 > 0 && c >= high20 * 0.95 && todayV >= avg20 * 2) {
      push(
        "급락",
        "고점 대량 음봉",
        `20일 고가 ${Math.round(high20).toLocaleString("ko-KR")}원 근처 음봉, 거래량 ${Math.round((todayV / avg20) * 10) / 10}배.`,
        "일봉",
      );
    }
  }
  if (todayV != null && avg20 != null && todayV < avg20 * 0.4 && env.changeRatePct != null && Math.abs(env.changeRatePct) < 2) {
    push(
      "급등",
      "거래량 절벽",
      `당일 거래량이 20일 평균의 ${Math.round((todayV / avg20) * 100)}%이고 등락은 ${env.changeRatePct.toFixed(2)}%. 세력 의도 해석은 하지 않습니다.`,
      "거래량",
    );
  }

  return out;
}

export function scoreDip(env: LiveSnapshot): DipHit | null {
  return classifyDip(env).hit;
}

export function classifyDip(env: LiveSnapshot): { hit: DipHit | null; reason: string } {
  const theme = classifyTheme({ name: env.stockName ?? "", newsTitles: (env.newsItems ?? []).map((n) => n.title) });
  if (!GROWTH.has(theme.id)) return { hit: null, reason: "성장테마 아님(이름·뉴스에 AI/반도체/로봇/바이오 없음)" };
  const daily = env.dailyPrices;
  const window = Math.min(daily.length, 120);
  if (window < 40 || env.currentPrice == null) return { hit: null, reason: "일봉 40개 미만 또는 현재가 없음" };
  const slice = daily.slice(0, window);
  const highs = slice.map((b) => toNum(b.stck_hgpr)).filter((n): n is number => n != null);
  const lows = slice.map((b) => toNum(b.stck_lwpr)).filter((n): n is number => n != null);
  if (!highs.length || !lows.length) return { hit: null, reason: "고가·저가 없음" };
  const high = Math.max(...highs);
  const low = Math.min(...lows);
  const px = env.currentPrice;
  const fromHighPct = ((px - high) / high) * 100;
  const fromLowPct = ((px - low) / low) * 100;
  if (fromHighPct > -20 || fromHighPct < -40) return { hit: null, reason: "고점 대비 -20~-40% 밖" };
  if (fromLowPct < 5 || fromLowPct > 20) return { hit: null, reason: "저점 대비 +5~+20% 밖" };

  const v5 = slice.slice(0, 5).map((b) => toNum(b.acml_vol)).filter((n): n is number => n != null);
  const v20 = slice.slice(0, 20).map((b) => toNum(b.acml_vol)).filter((n): n is number => n != null);
  const volRatio = v5.length === 5 && v20.length === 20 ? v5.reduce((a, b) => a + b, 0) / 5 / (v20.reduce((a, b) => a + b, 0) / 20) : null;
  if (volRatio == null || volRatio < 1.2) return { hit: null, reason: "5일 거래량이 20일 평균의 1.2배 미만" };

  const rsi = computeRsi(slice);
  const macd = computeMacd(slice);
  const ma50 = computeMa(slice, 50);
  const techHits: string[] = [];
  if (rsi != null && rsi >= 30 && rsi <= 50) techHits.push(`RSI ${rsi}`);
  if (macd && (macd.goldenCross || (macd.macd < 0 && macd.macd > macd.signal))) techHits.push("MACD 전환/골든");
  if (ma50 != null && px > ma50) techHits.push(`현재가 > 50일 ${Math.round(ma50).toLocaleString("ko-KR")}`);
  const closes = slice.map((b) => toNum(b.stck_clpr)).filter((n): n is number => n != null);
  if (closes.length >= 20) {
    const mean = closes.slice(0, 20).reduce((a, b) => a + b, 0) / 20;
    const sd = Math.sqrt(closes.slice(0, 20).reduce((a, b) => a + (b - mean) ** 2, 0) / 20);
    const lower = mean - 2 * sd;
    const prev = closes[5];
    if (prev != null && prev <= lower * 1.02 && px > lower && px < mean) techHits.push("볼린저 하단에서 중심선 쪽");
  }
  const upVol = slice
    .slice(0, 10)
    .filter((b) => (toNum(b.stck_clpr) ?? 0) >= (toNum(b.stck_oprc) ?? 0))
    .map((b) => toNum(b.acml_vol) ?? 0)
    .reduce((a, b) => a + b, 0);
  const dnVol = slice
    .slice(0, 10)
    .filter((b) => (toNum(b.stck_clpr) ?? 0) < (toNum(b.stck_oprc) ?? 0))
    .map((b) => toNum(b.acml_vol) ?? 0)
    .reduce((a, b) => a + b, 0);
  if (dnVol > 0 && upVol > dnVol * 1.3) techHits.push("상승 거래량 > 하락 거래량 130%");
  if (techHits.length < 2) return { hit: null, reason: "기술 신호 2개 미만" };

  const missing = [
    "매출 YoY",
    "영업이익·마진",
    "FCF",
    "부채비율",
    "R&D 비중",
    "PER·EPS",
    "분석가 목표주가",
  ];
  const priority: 1 | 2 | 3 = techHits.length >= 3 ? 1 : 2;
  const hit: DipHit = {
    code: env.stockCode,
    name: env.stockName ?? env.stockCode,
    theme: theme.name,
    price: px,
    windowDays: window,
    fromHighPct: Math.round(fromHighPct * 10) / 10,
    fromLowPct: Math.round(fromLowPct * 10) / 10,
    rsi,
    volRatio: Math.round(volRatio * 100) / 100,
    techHits,
    missing,
    step1: Math.round(low * 1.1),
    step2: Math.round(low * 1.175),
    step3: Math.round(low * 1.25),
    stop: Math.round(low * 0.95),
    priority,
    news: (env.newsItems ?? []).slice(0, 3).map((n) => n.title),
    note: `고저 구간은 52주가 아니라 확보한 ${window}거래일 일봉입니다. 재무 항목은 DART 숫자가 없어 비워 둡니다.`,
  };
  return { hit, reason: "통과" };
}
