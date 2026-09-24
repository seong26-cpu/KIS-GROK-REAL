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
  workflow: string[];
  body: string;
  cheap?: SkillCheapRow[];
  report?: AnalysisReport;
  market?: MarketBrief;
};

export const SKILL_PROMPTS = [
  {
    label: "저가 종목 추천",
    query: "저가매수 후보를 korean-stock-picks 원칙으로 추천해줘. 함정 초저PER 소형은 제외.",
  },
  {
    label: "종목 분석",
    query: "005930 삼성전자를 스킬 4단계(펀더멘털·촉매·컨센서스·리스크)로 분석해줘.",
  },
  {
    label: "시황",
    query: "오늘 코스피 시황과 수급, 시총 상위를 브리핑해줘.",
  },
  {
    label: "9.21 시황",
    query: "코스피 시황을 기준으로 최근 수급과 지수 흐름을 정리해줘.",
  },
  {
    label: "반도체 vs 자동차",
    query: "삼성전자와 현대차를 코어/위성 관점에서 비교 분석해줘.",
  },
] as const;

export function classifySkillQuery(q: string): SkillPicksResult["mode"] {
  const s = q.replace(/\s+/g, "").toLowerCase();
  if (/저가|추천|dip|싸게|눌림/.test(s) && !/^\d{6}/.test(q.trim())) return "cheap";
  if (/코스피|코스닥|kospi|kosdaq|시황|9\.21|9\/21/.test(s) && !/\d{6}/.test(q)) return "market";
  if (/\d{1,6}/.test(q) || /전자|하이닉스|현대차|기아|스퀘어/.test(q)) return "ticker";
  return "free";
}

export const SKILL_STEPS = [
  "요구 명확화 (섹터·기간·리스크)",
  "매크로·수급 (코스피/외인/금리·환율)",
  "후보 선정 (유동성·컨센서스)",
  "딥다이브 (PER/PBR, 촉매, 목표가, 리스크)",
  "랭킹 (코어 vs 위성)",
  "면책 — 투자 조언 아님",
];
