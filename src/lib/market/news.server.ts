import type { NewsItem } from "@/lib/scanner/types";
import { ymdOnly } from "@/lib/scanner/asof";

const UA = "Mozilla/5.0 (compatible; kis-case-scanner/1.0)";
const newsCache = new Map<string, { until: number; items: NewsItem[] | null }>();
const TTL_MS = 5 * 60 * 1000;

function stripHtml(s: string): string {
  return s
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&/g, "&")
    .replace(/"/g, '"')
    .replace(/&#39;|'/g, "'")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pubYmd(pub: string): string {
  const digits = pub.replace(/\D/g, "");
  if (/^20\d{6}/.test(digits)) return digits.slice(0, 8);
  const t = Date.parse(pub);
  if (Number.isNaN(t)) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(t));
  return parts.replace(/\D/g, "").slice(0, 8);
}

function shiftYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function isoDay(ymd: string): string {
  return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
}

function selectDated(items: NewsItem[], asOf?: string): NewsItem[] {
  const ymd = ymdOnly(asOf);
  if (!ymd) return items;
  const start = shiftYmd(ymd, -21);
  const recent = items.filter((n) => {
    const y = pubYmd(n.pubDate);
    return !y || (y <= ymd && y >= start);
  });
  if (recent.length) return recent;
  return items.filter((n) => {
    const y = pubYmd(n.pubDate);
    return !y || y <= ymd;
  });
}

function tag(block: string, name: string): string {
  const m = block.match(new RegExp(`<${name}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${name}>|<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return stripHtml(m?.[1] ?? m?.[2] ?? "");
}

async function googleRss(query: string, display = 6, asOf?: string): Promise<NewsItem[] | null> {
  try {
    const ymd = ymdOnly(asOf);
    const q = ymd ? `${query} after:${isoDay(shiftYmd(ymd, -7))} before:${isoDay(shiftYmd(ymd, 1))}` : query;
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=ko&gl=KR&ceid=KR:ko`;
    const resp = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(7000) });
    if (!resp.ok) return null;
    const xml = await resp.text();
    const items: NewsItem[] = [];
    for (const b of xml.split("<item>").slice(1, display + 1)) {
      let title = tag(b, "title");
      let src = tag(b, "source");
      if (!src && title.includes(" - ")) {
        const i = title.lastIndexOf(" - ");
        src = title.slice(i + 3).trim();
        title = title.slice(0, i).trim();
      }
      const link = (b.match(/<link>(.*?)<\/link>/s) ?? [])[1]?.trim() ?? "";
      const pub = (b.match(/<pubDate>(.*?)<\/pubDate>/s) ?? [])[1]?.trim() ?? "";
      if (!title) continue;
      items.push({ title, pubDate: pub, source: src || "Google 뉴스", link, summary: "" });
    }
    return items;
  } catch {
    return null;
  }
}

async function naverStock(code: string): Promise<NewsItem[] | null> {
  try {
    const resp = await fetch(`https://m.stock.naver.com/api/news/stock/${code}?pageSize=8&page=1`, {
      headers: { "user-agent": UA, accept: "application/json" },
      signal: AbortSignal.timeout(7000),
    });
    if (!resp.ok) return null;
    const raw: unknown = await resp.json();
    const buckets: unknown[] = Array.isArray(raw) ? raw : [raw];
    const list: NewsItem[] = [];
    for (const b of buckets) {
      if (!b || typeof b !== "object") continue;
      const rec = b as Record<string, unknown>;
      const arr = Array.isArray(rec.items) ? rec.items : rec.title ? [rec] : [];
      for (const row of arr) {
        if (!row || typeof row !== "object") continue;
        const r = row as Record<string, unknown>;
        const inner = (r.item && typeof r.item === "object" ? r.item : r) as Record<string, unknown>;
        const title = stripHtml(String(inner.titleFull ?? inner.title ?? ""));
        if (!title) continue;
        const dt = String(inner.datetime ?? inner.date ?? "");
        const pub = /^\d{12}$/.test(dt)
          ? `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)} ${dt.slice(8, 10)}:${dt.slice(10, 12)}`
          : dt;
        const summary = stripHtml(String(inner.body ?? inner.summary ?? ""));
        list.push({
          title,
          pubDate: pub,
          source: String(inner.officeName ?? "네이버증권"),
          code,
          link: String(inner.mobileNewsUrl ?? inner.link ?? "") || undefined,
          summary: summary && summary !== title ? summary.slice(0, 220) : "",
        });
      }
    }
    return list.slice(0, 8);
  } catch {
    return null;
  }
}

async function rssByName(url: string, source: string, query?: string): Promise<NewsItem[] | null> {
  try {
    const resp = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(7000) });
    if (!resp.ok) return null;
    const xml = await resp.text();
    const items: NewsItem[] = [];
    for (const b of xml.split("<item>").slice(1, 40)) {
      const title = tag(b, "title");
      const desc = tag(b, "description");
      const pub = (b.match(/<pubDate>(.*?)<\/pubDate>/s) ?? [])[1]?.trim() ?? "";
      const link = (b.match(/<link>(.*?)<\/link>/s) ?? [])[1]?.trim() ?? "";
      if (!title) continue;
      if (query && !`${title} ${desc}`.includes(query)) continue;
      const summary = desc && desc !== title ? desc.slice(0, 220) : "";
      items.push({ title, pubDate: pub, source, link, summary });
    }
    return items.slice(0, 6);
  } catch {
    return null;
  }
}

async function naverMainNews(): Promise<NewsItem[] | null> {
  try {
    const resp = await fetch("https://m.stock.naver.com/api/news/list?category=mainnews&pageSize=8&page=1", {
      headers: { "user-agent": UA, accept: "application/json" },
      signal: AbortSignal.timeout(7000),
    });
    if (!resp.ok) return null;
    const raw: unknown = await resp.json();
    const rows = Array.isArray(raw) ? raw : [];
    const items: NewsItem[] = [];
    for (const row of rows) {
      const r = row as Record<string, unknown>;
      const title = stripHtml(String(r.tit ?? ""));
      if (!title) continue;
      const summary = stripHtml(String(r.subcontent ?? ""));
      items.push({
        title,
        pubDate: String(r.dt ?? ""),
        source: String(r.ohnm ?? "네이버증권"),
        summary: summary && summary !== title ? summary.slice(0, 220) : "",
      });
    }
    return items.slice(0, 8);
  } catch {
    return null;
  }
}

function mergeNews(groups: (NewsItem[] | null | undefined)[], limit: number): NewsItem[] {
  const seen = new Set<string>();
  const queues = groups.map((group) => [...(group ?? [])]);
  const out: NewsItem[] = [];
  while (out.length < limit && queues.some((q) => q.length)) {
    for (const queue of queues) {
      while (queue.length) {
        const item = queue.shift();
        if (!item) break;
        const key = item.title.replace(/\s+/g, "").slice(0, 40);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(item);
        break;
      }
      if (out.length >= limit) break;
    }
  }
  return out;
}

export async function fetchStockNews(code: string, name?: string, asOf?: string): Promise<NewsItem[] | null> {
  const key = `${code}:${name ?? ""}:${ymdOnly(asOf)}`;
  const hit = newsCache.get(key);
  if (hit && Date.now() < hit.until) return hit.items;
  const q = name || code;
  const [naver, google, hankyung, yna] = await Promise.all([
    naverStock(code),
    googleRss(`${q} 주가`, 6, asOf),
    name ? rssByName("https://www.hankyung.com/feed/finance", "한국경제", name) : Promise.resolve(null),
    name ? rssByName("https://www.yna.co.kr/rss/economy.xml", "연합뉴스", name) : Promise.resolve(null),
  ]);
  const items = selectDated(mergeNews([naver, hankyung, yna, google], 8), asOf);
  const result = items.length ? items : null;
  newsCache.set(key, { until: Date.now() + TTL_MS, items: result });
  return result;
}

export async function fetchMarketNews(asOf?: string): Promise<NewsItem[] | null> {
  const key = `__market__:${ymdOnly(asOf)}`;
  const hit = newsCache.get(key);
  if (hit && Date.now() < hit.until) return hit.items;
  const [naver, google, yna] = await Promise.all([
    naverMainNews(),
    googleRss("코스피 코스닥 증시", 6, asOf),
    rssByName("https://www.yna.co.kr/rss/economy.xml", "연합뉴스"),
  ]);
  const items = selectDated(mergeNews([naver, yna, google], 10), asOf);
  const result = items.length ? items : null;
  newsCache.set(key, { until: Date.now() + TTL_MS, items: result });
  return result;
}
