export type EventCategory = "실적" | "설명회" | "신제품" | "임상" | "계약" | "산업";

export type DartEventHit = {
  code: string;
  name: string;
  theme: string;
  category: EventCategory;
  title: string;
  filedOn: string;
  link?: string;
  note: string;
};

const RULES: { category: EventCategory; re: RegExp }[] = [
  { category: "임상", re: /임상|탑라인|품목허가|식약처|적응증/ },
  { category: "계약", re: /공급계약|단일판매|수주|양해각서|업무협약|판매계약|신규계약|기술이전/ },
  { category: "신제품", re: /신제품|신기술|양산|개발성공|개발완료|상용화|출시/ },
  { category: "설명회", re: /기업설명회|IR개최|컨퍼런스콜|실적설명/ },
  { category: "실적", re: /잠정.?실적|영업.?실적|실적발표/ },
  { category: "산업", re: /시설투자|증설|생산능력|캐파|CAPA/i },
];

const INDUSTRIES: { name: string; re: RegExp }[] = [
  { name: "2차전지", re: /전지|배터리|에코프로|에너지솔루션|엔솔/ },
  { name: "방산", re: /방산|방위|에어로스페이스|넥스원|한화시스템|풍산|로템/ },
  { name: "조선", re: /조선|오션|중공업|마린|해운/ },
  { name: "전력", re: /전력|변압|전선|일렉트릭|산일|제룡|효성중/ },
  { name: "에너지", re: /에너지|태양광|풍력|정유|가스|LNG|원전|원자력|수소|연료전지/ },
  { name: "지주사", re: /홀딩스|홀딩|지주/ },
  { name: "바이오", re: /바이오|제약|약품|셀트리온|알테오젠/ },
  { name: "로봇", re: /로봇|로보/ },
  { name: "반도체", re: /반도체|하이닉스|주성|원익|솔브레인|한미반도체/ },
  { name: "AI", re: /인공지능|\bAI\b|데이터센터/i },
];

function ymd(offset: number): string {
  const d = new Date(Date.now() + 9 * 3600_000 + offset * 86400_000);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
}

function upcomingNote(title: string, category: EventCategory): string {
  if (category !== "실적" && category !== "설명회") {
    return category === "산업"
      ? "투자·증설 공시입니다. 금리 인하나 AI 수요는 이 제목에 없으면 붙이지 않습니다."
      : "제목에 적힌 사실만 사용합니다. 향후 일정이 제목에 없으면 날짜를 만들지 않습니다.";
  }
  const today = ymd(0);
  const limit = ymd(28);
  const found: string[] = [];
  for (const m of title.matchAll(/(20\d{2})[.\-/년\s]*(\d{1,2})[.\-/월\s]*(\d{1,2})/g)) {
    const ymdHit = `${m[1]}${m[2]!.padStart(2, "0")}${m[3]!.padStart(2, "0")}`;
    found.push(ymdHit);
  }
  const soon = found.find((d) => d >= today && d <= limit);
  if (soon) return `제목 속 일정이 ${soon.slice(0, 4)}-${soon.slice(4, 6)}-${soon.slice(6, 8)} 로, 오늘부터 4주 안입니다.`;
  return "이미 접수된 실적 공시입니다. 제목에 향후 4주 발표일이 없어 예정 일정으로 보지 않습니다.";
}

export function matchDisclosure(title: string): { category: EventCategory; note: string } | null {
  const compact = title.replace(/\s+/g, "");
  if (/거래정지|상장폐지|관리종목|투자경고|횡령|배임|감사범위제한|의견거절/.test(compact)) return null;
  for (const rule of RULES) {
    if (rule.re.test(compact) || rule.re.test(title)) {
      if (rule.category === "계약" && /유동성공급|자기주식|사채권|전환사채/.test(compact)) continue;
      if (rule.category === "산업" && !/AI|인공지능|전력|에너지|방산|조선|전지|배터리|원전|반도체|로봇/.test(title)) {
        continue;
      }
      return { category: rule.category, note: upcomingNote(title, rule.category) };
    }
  }
  return null;
}

export function industryOf(name: string, title: string): string {
  const hay = `${name} ${title}`;
  for (const ind of INDUSTRIES) {
    if (ind.re.test(hay)) return ind.name;
  }
  return "기타";
}
