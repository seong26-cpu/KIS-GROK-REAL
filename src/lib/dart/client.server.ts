import { readSecret } from "@/lib/secret-env.server";

import type { NewsItem } from "@/lib/scanner/types";

const BASE = "https://opendart.fss.or.kr/api";

export type DartFacts = {
  lines: string[];
  titles: NewsItem[];
  filled: string[];
  note: string;
};

type Acct = { sj: string; name: string; cur: number | null; prev: number | null };

let corpCache = new Map<string, string | null>();
const factCache = new Map<string, { until: number; facts: DartFacts }>();

function dartKey(): string | null {
  return readSecret("DART_API_KEY");
}

function numAmount(v: unknown): number | null {
  if (v == null || v === "" || v === "-") return null;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function eok(won: number | null): string {
  if (won == null) return "—";
  return `${Math.round(won / 100_000_000).toLocaleString("ko-KR")}억원`;
}

async function getJson(url: string): Promise<Record<string, unknown> | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const resp = await fetch(url, { signal: ctrl.signal, headers: { accept: "application/json" } });
    if (!resp.ok) return null;
    const json = (await resp.json()) as Record<string, unknown>;
    return json;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function corpCode(stockCode: string): Promise<string | null> {
  const code = stockCode.padStart(6, "0");
  if (corpCache.has(code)) return corpCache.get(code) ?? null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const resp = await fetch(
      `https://dart.fss.or.kr/corp/searchExistAll.ax?textCrpNm=${encodeURIComponent(code)}`,
      { signal: ctrl.signal, headers: { "user-agent": "Mozilla/5.0" } },
    );
    const text = (await resp.text()).trim();
    const found = /^\d{8}$/.test(text) ? text : null;
    corpCache.set(code, found);
    return found;
  } catch {
    corpCache.set(code, null);
    return null;
  } finally {
    clearTimeout(t);
  }
}

function pick(rows: Acct[], sj: string, names: string[]): Acct | null {
  for (const name of names) {
    const hit = rows.find((r) => r.sj === sj && r.name === name);
    if (hit && hit.cur != null) return hit;
  }
  for (const name of names) {
    const hit = rows.find((r) => r.sj === sj && r.name.includes(name));
    if (hit && hit.cur != null) return hit;
  }
  return null;
}

const REPORTS: [string, string, string][] = [
  ["2026", "11012", "2026 반기"],
  ["2026", "11013", "2026 1분기"],
  ["2025", "11011", "2025 사업"],
  ["2025", "11014", "2025 3분기"],
  ["2025", "11012", "2025 반기"],
];

async function loadStatement(key: string, corp: string): Promise<{ rows: Acct[]; label: string } | null> {
  for (const [year, code, label] of REPORTS) {
    const url = `${BASE}/fnlttSinglAcntAll.json?crtfc_key=${encodeURIComponent(key)}&corp_code=${corp}&bsns_year=${year}&reprt_code=${code}&fs_div=CFS`;
    const json = await getJson(url);
    if (!json || String(json.status) !== "000" || !Array.isArray(json.list)) continue;
    const rows: Acct[] = json.list.map((raw) => {
      const r = raw as Record<string, unknown>;
      const annual = code === "11011";
      const cur = numAmount(annual ? r.thstrm_amount : (r.thstrm_add_amount ?? r.thstrm_amount));
      const prev = numAmount(annual ? r.frmtrm_amount : (r.frmtrm_add_amount ?? r.frmtrm_amount));
      const sjRaw = String(r.sj_div ?? "");
      return {
        sj: sjRaw === "CIS" ? "IS" : sjRaw,
        name: String(r.account_nm ?? "").trim(),
        cur,
        prev,
      };
    });
    if (rows.some((r) => r.sj === "IS" && r.name.includes("매출") && r.cur != null)) return { rows, label };
  }
  return null;
}

async function loadDisclosures(key: string, corp: string, stockCode: string): Promise<NewsItem[]> {
  const end = new Date(Date.now() + 9 * 3600_000);
  const start = new Date(end.getTime() - 120 * 86400_000);
  const ymd = (d: Date) =>
    `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  const url = `${BASE}/list.json?crtfc_key=${encodeURIComponent(key)}&corp_code=${corp}&bgn_de=${ymd(start)}&end_de=${ymd(end)}&page_count=30&page_no=1`;
  const json = await getJson(url);
  if (!json || String(json.status) !== "000" || !Array.isArray(json.list)) return [];
  const items: NewsItem[] = [];
  for (const raw of json.list) {
    const r = raw as Record<string, unknown>;
    const title = String(r.report_nm ?? "").trim();
    const dt = String(r.rcept_dt ?? "");
    const rcept = String(r.rcept_no ?? "");
    if (!title) continue;
    items.push({
      title,
      pubDate: dt,
      source: "DART",
      code: stockCode,
      link: rcept ? `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${rcept}` : undefined,
    });
  }
  return items;
}

export async function fetchDartFacts(stockCode: string, price: number | null): Promise<DartFacts | null> {
  const key = dartKey();
  if (!key) return null;
  const cached = factCache.get(stockCode);
  if (cached && cached.until > Date.now()) return cached.facts;
  const corp = await corpCode(stockCode);
  if (!corp) {
    const empty: DartFacts = { lines: [], titles: [], filled: [], note: "DART에서 법인코드를 찾지 못했습니다." };
    factCache.set(stockCode, { until: Date.now() + 30 * 60_000, facts: empty });
    return empty;
  }
  const [stmt, titles] = await Promise.all([loadStatement(key, corp), loadDisclosures(key, corp, stockCode)]);
  const lines: string[] = [];
  const filled: string[] = [];
  if (stmt) {
    const sales = pick(stmt.rows, "IS", ["매출액", "수익(매출액)", "영업수익"]);
    const op = pick(stmt.rows, "IS", ["영업이익", "영업이익(손실)"]);
    const debt = pick(stmt.rows, "BS", ["부채총계"]);
    const equity = pick(stmt.rows, "BS", ["자본총계"]);
    const eps = pick(stmt.rows, "IS", ["기본주당이익", "기본주당순이익"]);
    const ocf = pick(stmt.rows, "CF", ["영업활동현금흐름"]);
    const capex = pick(stmt.rows, "CF", ["유형자산의 취득"]);
    const rnd = pick(stmt.rows, "IS", ["경상연구개발비", "연구개발비"]) ?? stmt.rows.find((r) => r.name.includes("연구개발") && r.cur != null) ?? null;
    if (sales?.cur != null) {
      let yoy = "";
      if (sales.prev != null && sales.prev !== 0) {
        const pct = ((sales.cur - sales.prev) / Math.abs(sales.prev)) * 100;
        yoy = ` (전년 대비 ${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%)`;
        filled.push("매출 YoY");
      }
      lines.push(`매출 ${eok(sales.cur)}${yoy} · ${stmt.label}`);
    }
    if (op?.cur != null) {
      const margin = sales?.cur ? ` · 마진 ${((op.cur / sales.cur) * 100).toFixed(1)}%` : "";
      lines.push(`영업이익 ${eok(op.cur)}${margin}`);
      filled.push("영업이익·마진");
    }
    if (debt?.cur != null && equity?.cur != null && equity.cur !== 0) {
      lines.push(`부채비율 ${((debt.cur / equity.cur) * 100).toFixed(1)}%`);
      filled.push("부채비율");
    }
    if (ocf?.cur != null && capex?.cur != null) {
      const fcf = capex.cur > 0 ? ocf.cur - capex.cur : ocf.cur + capex.cur;
      lines.push(`FCF(영업현금-유형자산취득) ${eok(fcf)}`);
      filled.push("FCF");
    }
    if (rnd?.cur != null && sales?.cur) {
      lines.push(`R&D ${eok(rnd.cur)} · 매출 대비 ${((rnd.cur / sales.cur) * 100).toFixed(1)}%`);
      filled.push("R&D 비중");
    }
    if (eps?.cur != null) {
      const annual = stmt.label.includes("사업");
      const per = annual && price != null && eps.cur > 0 ? ` · PER ${(price / eps.cur).toFixed(1)}배` : " · 연환산 안 함";
      lines.push(`EPS ${Math.round(eps.cur).toLocaleString("ko-KR")}원${per}`);
      if (annual && price != null && eps.cur > 0) filled.push("PER·EPS");
    }
  }
  const facts: DartFacts = {
    lines,
    titles,
    filled,
    note: lines.length
      ? `재무 숫자는 DART ${stmt?.label ?? ""} 연결 재무제표입니다. 공시 본문의 매수·매도 수량은 제목에 없으면 적지 않습니다.`
      : "DART 재무제표 숫자를 가져오지 못했습니다.",
  };
  factCache.set(stockCode, { until: Date.now() + 6 * 3600_000, facts });
  return facts;
}
