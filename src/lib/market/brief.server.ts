import type { MarketBrief } from "@/lib/scanner/types";
import { fetchSihwang } from "@/lib/market/sihwang.server";
import { fetchMarketNews } from "@/lib/market/news.server";
import { classifyTheme } from "@/lib/scanner/themes";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

async function getJson(url: string): Promise<Record<string, unknown> | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  try {
    const resp = await fetch(url, { signal: ctrl.signal, headers: { "user-agent": UA, accept: "application/json" } });
    if (!resp.ok) return null;
    return (await resp.json()) as Record<string, unknown>;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function str(v: unknown): string {
  return v == null ? "" : String(v);
}

export function marketQuery(q: string): "KOSPI" | "KOSDAQ" | null {
  const s = q.trim().toUpperCase().replace(/\s+/g, "");
  if (s === "KOSPI" || s === "코스피" || s === "KS11") return "KOSPI";
  if (s === "KOSDAQ" || s === "코스닥" || s === "KQ11") return "KOSDAQ";
  return null;
}

export async function fetchNaverConsensus(code: string, price: number | null): Promise<{
  consensus: { date: string; score: string; target: string; upsidePct: number | null } | null;
  researches: { broker: string; title: string; date: string }[];
}> {
  const json = await getJson(`https://m.stock.naver.com/api/stock/${code}/integration`);
  if (!json) return { consensus: null, researches: [] };
  const c = (json.consensusInfo ?? null) as Record<string, unknown> | null;
  const researches = (Array.isArray(json.researches) ? json.researches : [])
    .slice(0, 4)
    .map((raw) => {
      const r = raw as Record<string, unknown>;
      return { broker: str(r.bnm), title: str(r.tit), date: str(r.wdt) };
    })
    .filter((r) => r.title);
  const targetNum = Number(str(c?.priceTargetMean).replace(/,/g, ""));
  if (!c || !Number.isFinite(targetNum)) return { consensus: null, researches };
  const upside = price != null && price > 0 ? Math.round(((targetNum - price) / price) * 1000) / 10 : null;
  return {
    consensus: {
      date: str(c.createDate),
      score: str(c.recommMean),
      target: str(c.priceTargetMean),
      upsidePct: upside,
    },
    researches,
  };
}

export async function buildMarketBrief(market: "KOSPI" | "KOSDAQ"): Promise<MarketBrief> {
  const [detail, tape, news] = await Promise.all([
    getJson(`https://m.stock.naver.com/api/index/${market}/integration`),
    fetchSihwang().catch(() => null),
    fetchMarketNews().catch(() => []),
  ]);
  const tapeItem = tape?.korean.find((t) => t.symbol === market);
  const infos = Array.isArray(detail?.totalInfos) ? (detail!.totalInfos as Record<string, unknown>[]) : [];
  const stat = (code: string) => {
    const row = infos.find((i) => i.code === code);
    return row ? `${str(row.key)} ${str(row.value)}` : "";
  };
  const stats = ["openPrice", "highPrice", "lowPrice", "accumulatedTradingVolume", "accumulatedTradingValue", "highPriceOf52Weeks", "lowPriceOf52Weeks"]
    .map(stat)
    .filter(Boolean)
    .map((line) => {
      const [label, ...rest] = line.split(" ");
      return { label: label ?? line, value: rest.join(" ") };
    });
  const usd = tape?.korean.find((t) => t.symbol === "USD/KRW");
  if (usd?.price != null) stats.push({ label: "원/달러", value: `${usd.price.toLocaleString("ko-KR")} (${usd.changeRatePct?.toFixed(2) ?? "—"}%)` });
  const deal = (detail?.dealTrendInfo ?? {}) as Record<string, unknown>;
  const program = (detail?.programTrendInfo ?? {}) as Record<string, unknown>;
  const flow = [
    { label: `개인 ${str(deal.bizdate)}`, value: `${str(deal.personalValue)}억원` },
    { label: "외국인", value: `${str(deal.foreignValue)}억원` },
    { label: "기관", value: `${str(deal.institutionalValue)}억원` },
    { label: "프로그램 차익", value: str(program.indexDifferenceReal) || "—" },
    { label: "프로그램 비차익", value: str(program.indexBiDifferenceReal) || "—" },
  ].filter((r) => r.value && r.value !== "억원");
  const up = (detail?.upDownStockInfo ?? {}) as Record<string, unknown>;
  const breadth = [
    { label: "상승", value: str(up.riseCount) },
    { label: "하락", value: str(up.fallCount) },
    { label: "보합", value: str(up.steadyCount) },
    { label: "상한", value: str(up.upperCount) },
    { label: "하한", value: str(up.lowerCount) },
  ].filter((r) => r.value);
  const leaders = (Array.isArray(detail?.enrollStocks) ? detail!.enrollStocks : [])
    .slice(0, 8)
    .map((raw) => {
      const s = raw as Record<string, unknown>;
      return {
        code: str(s.itemCode),
        name: str(s.stockName),
        price: str(s.closePrice),
        change: str(s.fluctuationsRatio || s.compareToPreviousClosePrice),
      };
    })
    .filter((s) => s.code && s.name);
  const groups = new Map<string, string[]>();
  for (const s of leaders) {
    const theme = classifyTheme({ name: s.name, newsTitles: [] }).name;
    const list = groups.get(theme) ?? [];
    list.push(s.name);
    groups.set(theme, list);
  }
  const chg = tapeItem?.changeRatePct;
  const foreign = str(deal.foreignValue);
  const rise = Number(str(up.riseCount).replace(/,/g, ""));
  const fall = Number(str(up.fallCount).replace(/,/g, ""));
  const tone = chg == null ? "지수 등락을 확인하지 못했습니다." : chg >= 0.4 ? "지수만 보면 상승입니다." : chg <= -0.4 ? "지수만 보면 하락입니다." : "지수만 보면 횡보입니다.";
  const breadthTone = Number.isFinite(rise) && Number.isFinite(fall) ? `상승 ${rise}종목, 하락 ${fall}종목입니다.` : "";
  const flowTone = foreign.startsWith("-") ? "외국인 수급 표기는 순매도입니다." : foreign.startsWith("+") ? "외국인 수급 표기는 순매수입니다." : "";
  const naverPx = str(infos.find((i) => i.code === "lastClosePrice")?.value);
  const cross =
    tapeItem?.price != null
      ? `교차확인 ${tapeItem.source} ${tapeItem.price.toLocaleString("ko-KR")} (${chg?.toFixed(2) ?? "—"}%). 네이버 전일종가 ${naverPx || "—"}.`
      : "교차확인 시세를 받지 못했습니다. 네이버 지수 화면만 표시합니다.";
  return {
    market,
    asOf: new Date().toISOString(),
    price: tapeItem?.price ?? null,
    changePct: chg ?? null,
    crossNote: cross,
    stats,
    flow,
    breadth,
    sectors: [...groups.entries()].map(([name, names]) => ({ name, names })),
    leaders,
    news: (news ?? []).slice(0, 8).map((n) => ({ title: n.title, source: n.source ?? "", date: n.pubDate ?? "" })),
    outlook: `${market} ${tone} ${breadthTone} ${flowTone} 환율·해외지수는 아래 수치만 참고하세요. 매수 추천이 아닙니다.`.replace(/\s+/g, " ").trim(),
    disclaimer: "투자 조언이 아닙니다. 시세·수급·뉴스는 조회 시점의 공개 자료이며, 목표주가나 수익률은 만들지 않았습니다. 투자 손실 책임은 본인에게 있습니다.",
  };
}
