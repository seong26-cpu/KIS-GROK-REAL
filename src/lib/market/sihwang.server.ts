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
  const [kospi, kosdaq, usd, spx, nasdaq, nikkei, tnx] = await Promise.all([
    naverIndex("KOSPI"),
    naverIndex("KOSDAQ"),
    naverUsdKrw(),
    yahooQuote("^GSPC", "S&P 500"),
    yahooQuote("^IXIC", "NASDAQ"),
    yahooQuote("^N225", "Nikkei 225"),
    yahooQuote("^TNX", "미 10년물"),
  ]);

  const korean = [kospi, kosdaq, usd];
  const global = [spx, nasdaq, nikkei, tnx];
  const [ksHist, kqHist] = await Promise.all([yahooQuote("^KS11", "코스피"), yahooQuote("^KQ11", "코스닥")]);
  if (ksHist.history?.length) kospi.history = ksHist.history;
  if (kqHist.history?.length) kosdaq.history = kqHist.history;
  if (korean.every((t) => t.price == null)) notes.push("국내 지수 시황을 불러오지 못했습니다.");
  if (global.every((t) => t.price == null)) notes.push("해외 지수 시황을 불러오지 못했습니다.");
  if (!notes.length) notes.push("국내 시황은 FinanceDataReader 계열(네이버 증권 공개), 해외는 yfinance 계열(Yahoo Finance)입니다.");

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
