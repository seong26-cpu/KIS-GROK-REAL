import type { BoardStock, CaseVerdict, ThemeCard } from "./types";

export type ThemeDef = {
  id: string;
  name: string;
  keywords: string[];
};

/** 국내 주도 테마 — 종목명·뉴스 키워드로만 분류. 없는 테마는 만들지 않는다. */
export const THEME_DEFS: ThemeDef[] = [
  { id: "semi-eqp", name: "반도체 장비", keywords: ["반도체", "장비", "에칭", "증착", "원익", "주성", "테스", "유진테크", "파크시스템", "한미반도체", "리노", "인텍플러스", "유니테스트", "기가레인", "피에스케이"] },
  { id: "semi-mat", name: "반도체 재료/부품", keywords: ["반도체", "소재", "웨이퍼", "후성", "솔브레인", "이엔에프", "동진쎄미켐", "덕산네오룩스", "원익QnC", "하나머티리얼즈", "삼성전기"] },
  { id: "ai", name: "AI / 데이터센터", keywords: ["AI", "인공지능", "엔비디아", "HBM", "데이터센터", "전력", "변압", "가온전선", "LS전선", "대한전선", "HD현대일렉트릭"] },
  { id: "5g", name: "5G", keywords: ["5G", "통신", "RF", "안테나", "에이스테크", "센서뷰", "케이엠더블유", "RFHIC", "와이팜"] },
  { id: "defense", name: "방위산업", keywords: ["방산", "방위", "미사일", "무기", "한화에어로", "한화시스템", "LIG넥스원", "풍산", "현대로템", "대한광통신", "쎄크", "센서뷰"] },
  { id: "robot", name: "로봇", keywords: ["로봇", "로보", "두산로보틱스", "로보티즈", "레인보우로보틱스", "하이젠알앤엠", "에스피지"] },
  { id: "auto", name: "자율주행차", keywords: ["자율주행", "전장", "라이다", "현대모비스", "HL만도", "카메라", "라이콤", "퀄리타스"] },
  { id: "battery", name: "2차전지", keywords: ["전지", "배터리", "양극", "음극", "전해액", "에코프로", "엘앤에프", "포스코퓨처엠", "LG에너지", "삼성SDI", "천보"] },
  { id: "energy", name: "에너지", keywords: ["에너지", "태양광", "풍력", "정유", "LNG", "가스공사"] },
  { id: "holdco", name: "지주사", keywords: ["홀딩스", "홀딩", "지주"] },
  { id: "sofc", name: "고체산화물 연료전지", keywords: ["연료전지", "SOFC", "수소", "두산퓨얼셀", "에스퓨얼셀", "범한퓨얼셀"] },
  { id: "bio", name: "바이오", keywords: ["바이오", "셀트리온", "삼성바이오로직스", "알테오젠", "에이비엘바이오", "유한양행", "한미약품", "리제네론"] },
  { id: "ship", name: "조선/해운", keywords: ["조선", "해운", "HD한국조선", "삼성중공업", "한화오션", "현대중공업", "HMM", "팬오션"] },
  { id: "nuclear", name: "원전/SMR", keywords: ["원전", "SMR", "원자력", "두산에너빌리티", "한전기술", "우진엔텍", "비에이치아이"] },
  { id: "power", name: "전력기기", keywords: ["변압기", "전력", "전선", "일진전기", "제룡전기", "산일전기", "효성중공업"] },
  { id: "display", name: "디스플레이", keywords: ["디스플레이", "OLED", "LG디스플레이", "삼성디스플레이", "덕산네오룩스", "이녹스"] },
  { id: "game", name: "게임/콘텐츠", keywords: ["게임", "엔씨", "크래프톤", "넷마블", "카카오게임", "위메이드"] },
];

function haystack(stock: Pick<BoardStock, "name" | "newsTitles">): string {
  return `${stock.name} ${(stock.newsTitles ?? []).join(" ")}`.toLowerCase();
}

export function classifyTheme(stock: Pick<BoardStock, "name" | "newsTitles">): { id: string; name: string } {
  const h = haystack(stock);
  let best: { id: string; name: string; hits: number } | null = null;
  for (const def of THEME_DEFS) {
    let hits = 0;
    for (const kw of def.keywords) {
      if (h.includes(kw.toLowerCase())) hits += kw.length >= 4 ? 2 : 1;
    }
    if (hits && (!best || hits > best.hits)) best = { id: def.id, name: def.name, hits };
  }
  if (best) return { id: best.id, name: best.name };
  return { id: "flow", name: "수급 집중" };
}

export function assignRelativeStrength(rows: BoardStock[]): BoardStock[] {
  const scored = rows
    .map((r) => ({ code: r.code, ret: r.ret20Pct ?? r.changeRatePct ?? Number.NEGATIVE_INFINITY }))
    .sort((a, b) => a.ret - b.ret);
  const n = Math.max(1, scored.length - 1);
  const rs = new Map(scored.map((s, i) => [s.code, Math.round((i / n) * 98) + 1]));
  return rows.map((r) => ({ ...r, rs: rs.get(r.code) ?? null }));
}

export function buildThemeCards(
  rows: BoardStock[],
  sort: "change" | "prev" | "value",
  maxThemes = 8,
): ThemeCard[] {
  const groups = new Map<string, BoardStock[]>();
  for (const r of rows) {
    const t = r.themeId || "flow";
    const list = groups.get(t) ?? [];
    list.push(r);
    groups.set(t, list);
  }

  const metric = (s: BoardStock) => {
    if (sort === "prev") return s.prevVolPct ?? -Infinity;
    if (sort === "value") return s.tradingValueEok ?? -Infinity;
    return s.changeRatePct ?? -Infinity;
  };

  const cards: ThemeCard[] = [];
  for (const [id, members] of groups) {
    const sorted = [...members].sort((a, b) => metric(b) - metric(a));
    const chg = sorted.map((s) => s.changeRatePct).filter((n): n is number => n != null);
    const avgChange = chg.length ? chg.reduce((a, b) => a + b, 0) / chg.length : null;
    cards.push({
      id,
      name: sorted[0]?.themeName ?? id,
      avgChangePct: avgChange,
      stocks: sorted.slice(0, 6),
    });
  }

  cards.sort((a, b) => {
    const av = a.stocks.reduce((s, x) => s + (metric(x) === -Infinity ? 0 : metric(x)), 0);
    const bv = b.stocks.reduce((s, x) => s + (metric(x) === -Infinity ? 0 : metric(x)), 0);
    return bv - av;
  });
  return cards.slice(0, maxThemes).map((c, i) => ({ ...c, rank: i + 1 }));
}

export function attachCases(rows: BoardStock[], verdicts: CaseVerdict[]): BoardStock[] {
  const byCode = new Map<string, CaseVerdict[]>();
  for (const v of verdicts) {
    const list = byCode.get(v.stockCode) ?? [];
    list.push(v);
    byCode.set(v.stockCode, list);
  }
  return rows.map((r) => ({ ...r, cases: byCode.get(r.code) ?? [] }));
}
