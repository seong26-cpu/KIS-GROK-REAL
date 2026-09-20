import type { NewsItem } from "@/lib/scanner/types";

const UA = "Mozilla/5.0 (compatible; kis-case-scanner/1.0)";
const newsCache = new Map<string, { until: number; items: NewsItem[] | null }>();
const TTL_MS = 5 * 60 * 1000;

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/"/g, '"')
    .replace(/&/g, "&")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/&#39;/g, "'")
    .trim();
}

async function googleRss(query: string, display = 6): Promise<NewsItem[] | null> {
  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=ko&gl=KR&ceid=KR:ko`;
    const resp = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(7000) });
    if (!resp.ok) return null;
    const xml = await resp.text();
    const items: NewsItem[] = [];
    const blocks = xml.split("<item>").slice(1);
    for (const b of blocks.slice(0, display)) {
      const title = stripHtml((b.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/s) ?? [])[1] ?? (b.match(/<title>(.*?)<\/title>/s) ?? [])[1] ?? "");
      const link = (b.match(/<link>(.*?)<\/link>/s) ?? [])[1]?.trim() ?? "";
      const pub = (b.match(/<pubDate>(.*?)<\/pubDate>/s) ?? [])[1]?.trim() ?? "";
      const src = stripHtml((b.match(/<source[^>]*>(.*?)<\/source>/s) ?? [])[1] ?? "Google 뉴스");
      if (title) items.push({ title, pubDate: pub, source: src || "Google 뉴스", link });
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
        list.push({
          title,
          pubDate: pub,
          source: String(inner.officeName ?? "네이버증권"),
          code,
          link: String(inner.mobileNewsUrl ?? inner.link ?? "") || undefined,
        });
      }
    }
    return list.slice(0, 8);
  } catch {
    return null;
  }
}

export async function fetchStockNews(code: string, name?: string): Promise<NewsItem[] | null> {
  const key = `${code}:${name ?? ""}`;
  const hit = newsCache.get(key);
  if (hit && Date.now() < hit.until) return hit.items;
  const naver = await naverStock(code);
  let items = naver && naver.length ? naver : null;
  if (!items) {
    const q = name ? `${name} 주식` : code;
    items = await googleRss(q, 6);
  }
  newsCache.set(key, { until: Date.now() + TTL_MS, items });
  return items;
}

export async function fetchMarketNews(): Promise<NewsItem[] | null> {
  const key = "__market__";
  const hit = newsCache.get(key);
  if (hit && Date.now() < hit.until) return hit.items;
  const items = await googleRss("코스피 코스닥 금리 환율 증시", 8);
  newsCache.set(key, { until: Date.now() + TTL_MS, items });
  return items;
}
