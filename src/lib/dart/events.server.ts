import { readSecret } from "@/lib/secret-env.server";
import { isEtfName, isSpacName } from "@/lib/kis/exclude";
import { industryOf, matchDisclosure, type DartEventHit } from "@/lib/dart/events";

type Row = {
  corp_name?: string;
  stock_code?: string;
  report_nm?: string;
  rcept_dt?: string;
  rcept_no?: string;
  corp_cls?: string;
};

function ymd(offset: number): string {
  const d = new Date(Date.now() + 9 * 3600_000 + offset * 86400_000);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
}

async function page(ty: string, pageNo: number, begin: string, end: string): Promise<{ rows: Row[]; pages: number } | null> {
  const key = readSecret("DART_API_KEY");
  if (!key) return null;
  const url = `https://opendart.fss.or.kr/api/list.json?crtfc_key=${encodeURIComponent(key)}&bgn_de=${begin}&end_de=${end}&page_count=100&page_no=${pageNo}&pblntf_ty=${ty}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const resp = await fetch(url, { signal: ctrl.signal });
    if (!resp.ok) return null;
    const json = (await resp.json()) as { status?: string; total_page?: number; list?: Row[] };
    if (json.status !== "000") return { rows: [], pages: 0 };
    return { rows: json.list ?? [], pages: Number(json.total_page ?? 1) };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export async function scanDartEvents(): Promise<{ events: DartEventHit[]; scanned: number; note: string }> {
  if (!readSecret("DART_API_KEY")) {
    return { events: [], scanned: 0, note: "DART_API_KEY 가 없어 공시를 검색하지 못했습니다." };
  }
  const begin = ymd(-21);
  const end = ymd(0);
  const plan: { ty: string; maxPages: number }[] = [
    { ty: "B", maxPages: 8 },
    { ty: "I", maxPages: 6 },
    { ty: "E", maxPages: 2 },
  ];
  const events: DartEventHit[] = [];
  const seen = new Set<string>();
  let scanned = 0;
  for (const job of plan) {
    let pages = 1;
    for (let n = 1; n <= pages && n <= job.maxPages; n++) {
      const got = await page(job.ty, n, begin, end);
      if (!got) continue;
      pages = got.pages || 1;
      scanned += got.rows.length;
      for (const row of got.rows) {
        const code = String(row.stock_code ?? "").trim();
        const name = String(row.corp_name ?? "").trim();
        const title = String(row.report_nm ?? "").replace(/\s+/g, " ").trim();
        if (!/^\d{6}$/.test(code) || !name || !title) continue;
        if (row.corp_cls && row.corp_cls !== "Y" && row.corp_cls !== "K") continue;
        if (isEtfName(name) || isSpacName(name)) continue;
        const matched = matchDisclosure(title);
        if (!matched) continue;
        const key = `${code}:${matched.category}:${title}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const rcept = String(row.rcept_no ?? "");
        events.push({
          code,
          name,
          theme: industryOf(name, title),
          category: matched.category,
          title,
          filedOn: String(row.rcept_dt ?? ""),
          link: rcept ? `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${rcept}` : undefined,
          note: matched.note,
        });
      }
    }
  }
  const order = ["전력", "에너지", "지주사", "조선", "방산", "2차전지", "바이오", "로봇", "반도체", "AI", "기타"];
  events.sort((a, b) => order.indexOf(a.theme) - order.indexOf(b.theme) || b.filedOn.localeCompare(a.filedOn));
  return {
    events: events.slice(0, 80),
    scanned,
    note: `DART 주요사항·거래소·기타공시 ${begin}~${end} 중 ${scanned}건을 제목으로 걸렀습니다. 거래대금 상위는 쓰지 않습니다.`,
  };
}
