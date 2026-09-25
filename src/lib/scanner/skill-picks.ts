import type { AnalysisReport, MarketBrief } from "./types";

export type SkillCheapRow = {
  code: string;
  name: string;
  price: number | null;
  changePct: number | null;
  note: string;
};

export type SkillPicksResult = {
  ok: true;
  heading: "분석 STOCK";
  query: string;
  mode: "cheap" | "ticker" | "market" | "free";
  asOf: string | null;
  workflow: string[];
  body: string;
  cheap?: SkillCheapRow[];
  report?: AnalysisReport;
  reports?: AnalysisReport[];
  market?: MarketBrief;
};

export const SKILL_PROMPTS = [
  { label: "저가 종목 추천", query: "저가매수 후보를 조건이 겹치는 종목만 골라줘. 고점 근처는 빼." },
  { label: "종목 분석", query: "005930 삼성전자 펀더멘털, 촉매, 컨센서스, 리스크로 분석해줘." },
  { label: "시황", query: "오늘 코스피 시황과 외국인 수급, 시총 상위를 브리핑해줘." },
  { label: "9.21 시황", query: "2026-09-21 코스피 시황과 당시 뉴스를 정리해줘." },
  { label: "반도체 vs 자동차", query: "삼성전자와 현대차를 코어와 위성 관점에서 비교해줘." },
] as const;

export const SKILL_STEPS = [
  "요구 명확화 (섹터·기간·리스크)",
  "매크로·수급 (코스피/외인/금리·환율은 받아온 값만)",
  "후보 선정 (유동성 있는 이름, 조건 겹침)",
  "딥다이브 (시세, 이평, 뉴스, 네이버 컨센서스가 있을 때만)",
  "랭킹은 겹친 사실 수. 적중 확률은 만들지 않음",
  "면책 — 투자 조언 아님",
];

export const MAJOR_TICKERS: { code: string; name: string; aliases: string[]; sector: string }[] = [
  { code: "005930", name: "삼성전자", aliases: ["삼성전자", "삼전"], sector: "반도체" },
  { code: "000660", name: "SK하이닉스", aliases: ["SK하이닉스", "하이닉스"], sector: "반도체" },
  { code: "006400", name: "삼성SDI", aliases: ["삼성SDI", "SDI"], sector: "2차전지" },
  { code: "373220", name: "LG에너지솔루션", aliases: ["LG에너지솔루션", "엔솔"], sector: "2차전지" },
  { code: "005380", name: "현대차", aliases: ["현대차", "현대자동차"], sector: "자동차" },
  { code: "000270", name: "기아", aliases: ["기아"], sector: "자동차" },
  { code: "012330", name: "현대모비스", aliases: ["현대모비스", "모비스"], sector: "자동차" },
  { code: "329180", name: "HD현대중공업", aliases: ["HD현대중공업", "현대중공업"], sector: "조선" },
  { code: "010140", name: "삼성중공업", aliases: ["삼성중공업"], sector: "조선" },
  { code: "042660", name: "한화오션", aliases: ["한화오션"], sector: "조선" },
  { code: "012450", name: "한화에어로스페이스", aliases: ["한화에어로", "한화에어로스페이스"], sector: "방산" },
  { code: "005490", name: "POSCO홀딩스", aliases: ["POSCO홀딩스", "포스코홀딩스"], sector: "소재" },
  { code: "003670", name: "포스코퓨처엠", aliases: ["포스코퓨처엠"], sector: "2차전지" },
  { code: "051910", name: "LG화학", aliases: ["LG화학"], sector: "2차전지" },
  { code: "096770", name: "SK이노베이션", aliases: ["SK이노베이션"], sector: "에너지" },
  { code: "267260", name: "HD현대일렉트릭", aliases: ["HD현대일렉트릭", "현대일렉트릭"], sector: "전력" },
  { code: "105560", name: "KB금융", aliases: ["KB금융"], sector: "금융" },
  { code: "055550", name: "신한지주", aliases: ["신한지주"], sector: "금융" },
  { code: "086790", name: "하나금융지주", aliases: ["하나금융지주"], sector: "금융" },
  { code: "207940", name: "삼성바이오로직스", aliases: ["삼성바이오로직스", "삼바"], sector: "바이오" },
  { code: "068270", name: "셀트리온", aliases: ["셀트리온"], sector: "바이오" },
  { code: "036570", name: "엔씨소프트", aliases: ["엔씨소프트"], sector: "게임" },
  { code: "035720", name: "카카오", aliases: ["카카오"], sector: "플랫폼" },
  { code: "066570", name: "LG전자", aliases: ["LG전자"], sector: "IT" },
  { code: "402340", name: "SK스퀘어", aliases: ["SK스퀘어"], sector: "지주" },
];

export function extractAsOf(q: string): string | null {
  const full = q.match(/(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (full) return `${full[1]}-${full[2]!.padStart(2, "0")}-${full[3]!.padStart(2, "0")}`;
  const md = q.match(/(?:^|[^\d])(\d{1,2})[./](\d{1,2})(?!\d)/);
  if (!md) return null;
  const month = Number(md[1]);
  const day = Number(md[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${new Date().getFullYear()}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function mentionedTickers(q: string): { code: string; name: string; sector: string }[] {
  const out: { code: string; name: string; sector: string }[] = [];
  const seen = new Set<string>();
  const add = (row: (typeof MAJOR_TICKERS)[number]) => {
    if (seen.has(row.code)) return;
    seen.add(row.code);
    out.push({ code: row.code, name: row.name, sector: row.sector });
  };
  for (const code of q.match(/\d{6}/g) ?? []) {
    const known = MAJOR_TICKERS.find((t) => t.code === code);
    if (known) add(known);
    else if (!seen.has(code)) {
      seen.add(code);
      out.push({ code, name: code, sector: "미분류" });
    }
  }
  const compact = q.replace(/\s+/g, "");
  const byLen = [...MAJOR_TICKERS].sort((a, b) => Math.max(...b.aliases.map((x) => x.length)) - Math.max(...a.aliases.map((x) => x.length)));
  for (const row of byLen) {
    if (row.aliases.some((a) => compact.includes(a.replace(/\s+/g, "")))) add(row);
  }
  return out;
}

export function sectorPool(q: string): { code: string; name: string; sector: string }[] {
  const rules: { re: RegExp; sector: string }[] = [
    { re: /반도체|메모리|HBM|hbm/i, sector: "반도체" },
    { re: /2차전지|배터리|전지/, sector: "2차전지" },
    { re: /자동차|모빌리티/, sector: "자동차" },
    { re: /조선|해운/, sector: "조선" },
    { re: /방산|방위/, sector: "방산" },
    { re: /바이오|제약/, sector: "바이오" },
    { re: /금융|은행/, sector: "금융" },
    { re: /전력|에너지/, sector: "전력" },
    { re: /게임/, sector: "게임" },
  ];
  const hit = rules.find((r) => r.re.test(q));
  const rows = hit ? MAJOR_TICKERS.filter((t) => t.sector === hit.sector || (hit.sector === "전력" && t.sector === "에너지")) : MAJOR_TICKERS.slice(0, 8);
  return rows.map((t) => ({ code: t.code, name: t.name, sector: t.sector }));
}

export function classifySkillQuery(q: string): SkillPicksResult["mode"] {
  const s = q.replace(/\s+/g, "");
  const named = mentionedTickers(q);
  if (named.length && !/시황만|지수만/.test(s)) {
    if (/저가|추천/.test(s) && named.length > 3) return "cheap";
    return "ticker";
  }
  if (/저가|눌림|dip|싸게/.test(s)) return "cheap";
  if (/코스피|코스닥|KOSPI|KOSDAQ|시황|매크로/i.test(q) || extractAsOf(q)) return "market";
  if (/추천/.test(s)) return "cheap";
  return "free";
}
