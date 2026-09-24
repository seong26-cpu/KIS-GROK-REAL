import type { MarketIndex, NewsItem, TapeItem, SihwangSnapshot } from "@/lib/scanner/types";
import { toNum } from "@/lib/kb/parse";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

async function getJson(url: string, timeoutMs = 8000): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      headers: { "user-agent": UA, accept: "application/json,text/plain,*/*" },
      signal: ctrl.signal,
    });
    const text = await resp.text();
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error("JSON 아님");
    }
  } finally {
    clearTimeout(t);
  }
}

function asRec(v: unknown): Record<string, unknown> | null {
  return v != null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

async function yahooQuote(symbol: string, name: string): Promise<TapeItem> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
  try {
    const data = asRec(await getJson(url));
    const chart = asRec(data?.chart);
    const result = Array.isArray(chart?.result) ? asRec(chart.result[0]) : null;
    const meta = asRec(result?.meta) ?? {};
    const price = toNum(meta.regularMarketPrice);
    const prev = toNum(meta.chartPreviousClose ?? meta.previousClose);
    let changeRatePct: number | null = null;
    if (price != null && prev != null && prev !== 0) changeRatePct = ((price - prev) / prev) * 100;
    const history = extractHistory(result);
    return { symbol, name, price, changeRatePct, source: "yfinance", history };
  } catch {
    return { symbol, name, price: null, changeRatePct: null, source: "yfinance" };
  }
}

function extractHistory(result: Record<string, unknown> | null): TapeItem["history"] {
  if (!result) return [];
  const ts = Array.isArray(result.timestamp) ? (result.timestamp as unknown[]) : [];
  const indicators = asRec(result.indicators);
  const quoteArr = Array.isArray(indicators?.quote) ? indicators.quote : [];
  const quote = asRec(quoteArr[0]);
  const closes = Array.isArray(quote?.close) ? (quote.close as unknown[]) : [];
  const out: NonNullable<TapeItem["history"]> = [];
  for (let i = 0; i < ts.length; i++) {
    const close = toNum(closes[i]);
    const unix = toNum(ts[i]);
    if (close == null || unix == null) continue;
    const d = new Date(unix * 1000);
    const ymd = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    const prev = out.length ? out[out.length - 1]!.close : null;
    out.push({ date: ymd, close, changePct: prev ? ((close - prev) / prev) * 100 : null });
  }
  return out;
}

async function naverPollIndex(code: "KOSPI" | "KOSDAQ"): Promise<{ price: number | null; changeRatePct: number | null }> {
  try {
    const raw = asRec(await getJson(`https://polling.finance.naver.com/api/realtime?query=SERVICE_INDEX:${code}`));
    const result = asRec(raw?.result);
    const areas = Array.isArray(result?.areas) ? result.areas : [];
    const datas = areas.flatMap((a) => {
      const rec = asRec(a);
      return Array.isArray(rec?.datas) ? rec.datas : [];
    });
    const row = datas.map((d) => asRec(d)).find((d) => String(d?.cd ?? "") === code);
    const nv = toNum(row?.nv);
    const cr = toNum(row?.cr);
    const price = nv != null && nv > 10000 ? nv / 100 : nv;
    return { price, changeRatePct: cr };
  } catch {
    return { price: null, changeRatePct: null };
  }
}

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function reconcileIndex(
  symbol: string,
  name: string,
  quotes: { price: number | null; changeRatePct: number | null; source: string }[],
  notes: string[],
): TapeItem {
  const ok = quotes.filter((q) => q.price != null && q.price > 0);
  if (!ok.length) return { symbol, name, price: null, changeRatePct: null, source: "없음" };
  const mid = median(ok.map((q) => q.price!));
  const agree = ok.filter((q) => Math.abs(q.price! - mid) / mid <= 0.004);
  const used = agree.length >= 2 ? agree : ok;
  const price = Math.round(median(used.map((q) => q.price!)) * 100) / 100;
  const chgs = used.map((q) => q.changeRatePct).filter((n): n is number => n != null);
  const changeRatePct = chgs.length ? Math.round(median(chgs) * 100) / 100 : null;
  const label = used.map((q) => q.source).join(" · ");
  if (agree.length < 2 && ok.length >= 2) {
    const detail = ok.map((q) => `${q.source} ${q.price}`).join(", ");
    notes.push(`${name} 출처 불일치(${detail}). 중앙값 ${price}을 표시하고 단일 출처로 단정하지 않습니다.`);
  } else {
    notes.push(`${name} ${used.length}개 출처 일치(±0.4%): ${label}`);
  }
  return { symbol, name, price, changeRatePct, source: label };
}

async function naverIndex(code: "KOSPI" | "KOSDAQ"): Promise<TapeItem> {
  const urls = [`https://m.stock.naver.com/api/index/${code}/basic`];
  for (const url of urls) {
    try {
      const raw = await getJson(url);
      const rec = asRec(raw) ?? {};
      const price = toNum(rec.closePrice ?? rec.nowVal ?? rec.lastPrice ?? rec.nv ?? rec.now);
      const changeRatePct = toNum(rec.fluctuationsRatio ?? rec.changeRate ?? rec.cr ?? rec.diffRate);
      const name = String(rec.stockName ?? code);
      if (price != null) {
        return { symbol: code, name, price, changeRatePct, source: "FinanceDataReader" };
      }
    } catch {
      /* next */
    }
  }
  const yahoo = await yahooQuote(code === "KOSPI" ? "^KS11" : "^KQ11", code);
  return { ...yahoo, name: code === "KOSPI" ? "코스피" : "코스닥" };
}

async function naverUsdKrw(): Promise<TapeItem> {
  try {
    const raw = await getJson("https://m.stock.naver.com/front-api/marketIndex/productDetail?category=exchange&reutersCode=FX_USDKRW");
    const rec = asRec(raw);
    const result = asRec(rec?.result) ?? rec ?? {};
    const price = toNum(result.closePrice ?? result.nv ?? result.nowVal);
    const changeRatePct = toNum(result.fluctuationsRatio ?? result.cr ?? result.changeRate);
    if (price != null) {
      return { symbol: "USD/KRW", name: "원/달러", price, changeRatePct, source: "FinanceDataReader" };
    }
  } catch {
    /* fall through */
  }
  const y = await yahooQuote("KRW=X", "원/달러");
  return { ...y, name: "원/달러" };
}

export async function fetchSihwang(): Promise<SihwangSnapshot> {
  const notes: string[] = [];
  const [naverKs, naverKq, pollKs, pollKq, yahooKs, yahooKq, usd, spx, nasdaq, nikkei, tnx] = await Promise.all([
    naverIndex("KOSPI"),
    naverIndex("KOSDAQ"),
    naverPollIndex("KOSPI"),
    naverPollIndex("KOSDAQ"),
    yahooQuote("^KS11", "코스피"),
    yahooQuote("^KQ11", "코스닥"),
    naverUsdKrw(),
    yahooQuote("^GSPC", "S&P 500"),
    yahooQuote("^IXIC", "NASDAQ"),
    yahooQuote("^N225", "Nikkei 225"),
    yahooQuote("^TNX", "미 10년물"),
  ]);

  const kospi = reconcileIndex(
    "KOSPI",
    "코스피",
    [
      { price: naverKs.price, changeRatePct: naverKs.changeRatePct, source: "네이버" },
      { price: pollKs.price, changeRatePct: pollKs.changeRatePct, source: "네이버폴링" },
      { price: yahooKs.price, changeRatePct: yahooKs.changeRatePct, source: "Yahoo" },
    ],
    notes,
  );
  kospi.history = yahooKs.history;
  const kosdaq = reconcileIndex(
    "KOSDAQ",
    "코스닥",
    [
      { price: naverKq.price, changeRatePct: naverKq.changeRatePct, source: "네이버" },
      { price: pollKq.price, changeRatePct: pollKq.changeRatePct, source: "네이버폴링" },
      { price: yahooKq.price, changeRatePct: yahooKq.changeRatePct, source: "Yahoo" },
    ],
    notes,
  );
  kosdaq.history = yahooKq.history;

  const korean = [kospi, kosdaq, usd];
  const global = [spx, nasdaq, nikkei, tnx];
  if (korean.every((t) => t.price == null)) notes.push("국내 지수 시황을 불러오지 못했습니다.");
  if (global.every((t) => t.price == null)) notes.push("해외 지수 시황을 불러오지 못했습니다.");

  return {
    fetchedAt: new Date().toISOString(),
    korean,
    global,
    notes,
  };
}

export function tapeToIndices(tape: SihwangSnapshot): MarketIndex[] {
  const items = [...tape.korean, ...tape.global];
  return items.map((t) => ({
    code: t.symbol,
    name: t.name,
    price: t.price,
    changeRatePct: t.changeRatePct,
  }));
}

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

function toNews(title: string, pubDate: string, source: string, code: string, link?: string): NewsItem | null {
  const t = stripHtml(title);
  if (!t) return null;
  return { title: t, pubDate, source, code, link };
}

async function naverStockNews(code: string): Promise<NewsItem[] | null> {
  const urls = [`https://m.stock.naver.com/api/news/stock/${code}?pageSize=8&page=1`];
  for (const url of urls) {
    try {
      const raw = await getJson(url);
      const buckets: unknown[] = Array.isArray(raw) ? raw : [raw];
      const list: unknown[] = [];
      for (const b of buckets) {
        const rec = asRec(b);
        if (!rec) continue;
        if (Array.isArray(rec.items)) list.push(...rec.items);
        else if (rec.title) list.push(rec);
      }
      const items = list
        .map((row) => {
          const r = asRec(row) ?? {};
          const inner = asRec(r.item) ?? r;
          return toNews(
            String(inner.titleFull ?? inner.title ?? inner.tit ?? inner.headline ?? ""),
            formatNaverDt(String(inner.datetime ?? inner.date ?? inner.pubDate ?? inner.dt ?? "")),
            String(inner.officeName ?? inner.office ?? inner.press ?? "네이버증권"),
            code,
            String(inner.mobileNewsUrl ?? inner.link ?? inner.url ?? inner.endUrl ?? "") || undefined,
          );
        })
        .filter((n): n is NewsItem => Boolean(n));
      return items.slice(0, 8);
    } catch {
      /* next */
    }
  }
  return null;
}

function formatNaverDt(raw: string): string {
  const s = raw.trim();
  if (/^\d{12}$/.test(s)) {
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)} ${s.slice(8, 10)}:${s.slice(10, 12)}`;
  }
  return s;
}

async function yahooStockNews(code: string, name?: string): Promise<NewsItem[] | null> {
  const queries = [`${code}.KS`, `${code}.KQ`, name ?? "", code].filter(Boolean);
  for (const q of queries) {
    try {
      const raw = await getJson(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&newsCount=8&quotesCount=0`);
      const rec = asRec(raw);
      const news = Array.isArray(rec?.news) ? (rec.news as unknown[]) : [];
      const items = news
        .map((row) => {
          const r = asRec(row) ?? {};
          const ts = toNum(r.providerPublishTime);
          const pub = ts != null ? new Date(ts * 1000).toISOString() : "";
          return toNews(String(r.title ?? ""), pub, String(r.publisher ?? "Yahoo Finance"), code, String(r.link ?? "") || undefined);
        })
        .filter((n): n is NewsItem => Boolean(n));
      if (items.length) return items.slice(0, 8);
    } catch {
      /* next query */
    }
  }
  return null;
}

export async function fetchStockNews(code: string, name?: string): Promise<NewsItem[] | null> {
  const naver = await naverStockNews(code);
  if (naver && naver.length) return naver;
  const yahoo = await yahooStockNews(code, name);
  if (yahoo && yahoo.length) return yahoo;
  if (naver) return naver;
  if (yahoo) return yahoo;
  return null;
}
