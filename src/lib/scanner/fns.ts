import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type {
  AnalysisReport,
  BoardStock,
  BrokerCreds,
  CaseVerdict,
  ClosingBetCandidate,
  LiveSnapshot,
  NewsItem,
  SihwangSnapshot,
  TokenStatus,
  UniverseSnapshot,
} from "./types";
import { CASE_PRIORITY_ORDER, evaluateCase, isPennyStock, passesBlueChipFilter } from "./case-engine";
import { evaluateClosingBetCandidate } from "./closing-bet";
import { marketHoursNote, toNum } from "./indicators";
import { classifyTheme } from "./themes";
import { tapeToIndices } from "@/lib/market/sihwang.server";
import { resolveKisCreds } from "@/lib/secret-env.server";

const credsSchema = z.object({
  appKey: z.string().optional().default(""),
  appSecret: z.string().optional().default(""),
});

function creds(data: { appKey?: string; appSecret?: string }): BrokerCreds {
  return resolveKisCreds(data.appKey, data.appSecret);
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export const fetchDartEventsFn = createServerFn({ method: "POST" })
  .validator((_d: unknown) => ({}))
  .handler(async () => {
    try {
      const { scanDartEvents } = await import("@/lib/dart/events.server");
      const result = await scanDartEvents();
      return { ok: true as const, ...result };
    } catch (e) {
      return { ok: false as const, error: errMsg(e) };
    }
  });

export const serverKeyStatusFn = createServerFn({ method: "POST" })
  .validator((_d: unknown) => ({}))
  .handler(async () => {
    const { kisKeyStatus } = await import("@/lib/secret-env.server");
    return kisKeyStatus();
  });

export type ConnectResult =
  | { ok: true; token: TokenStatus; report: Record<string, string> }
  | { ok: false; error: string };

export const connectKis = createServerFn({ method: "POST" })
  .validator((d: unknown) => credsSchema.parse(d))
  .handler(async ({ data }): Promise<ConnectResult> => {
    const { KisClient } = await import("@/lib/kis/client.server");
    const client = new KisClient(creds(data));
    try {
      await client.ensureToken();
      const raw = await client.selfTest();
      const report: Record<string, string> = {};
      for (const [k, v] of Object.entries(raw)) {
        report[k] = typeof v === "string" ? v : JSON.stringify(v);
      }
      return { ok: true, token: client.getTokenStatus(), report };
    } catch (e) {
      return { ok: false, error: errMsg(e) };
    }
  });

export type TokenResult = { ok: true; token: TokenStatus };

export const getTokenStatusFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => credsSchema.parse(d))
  .handler(async ({ data }): Promise<TokenResult> => {
    const { KisClient } = await import("@/lib/kis/client.server");
    const client = new KisClient(creds(data));
    return { ok: true, token: client.getTokenStatus() };
  });

export type RefreshResult =
  | { ok: true; token: TokenStatus; success: boolean; fellBack: boolean; warning?: string }
  | { ok: false; error: string };

export const refreshToken = createServerFn({ method: "POST" })
  .validator((d: unknown) => credsSchema.parse(d))
  .handler(async ({ data }): Promise<RefreshResult> => {
    const { KisClient } = await import("@/lib/kis/client.server");
    const client = new KisClient(creds(data));
    try {
      const result = await client.forceRefresh();
      return {
        ok: true,
        token: client.getTokenStatus(),
        success: result.success,
        fellBack: result.fellBack,
        warning: result.error,
      };
    } catch (e) {
      return { ok: false, error: errMsg(e) };
    }
  });

export type UniverseResult =
  | {
      ok: true;
      universe: UniverseSnapshot;
      marketHours: ReturnType<typeof marketHoursNote>;
    }
  | { ok: false; error: string };

const universeCache = new Map<string, { until: number; snap: UniverseSnapshot }>();

export const fetchUniverseFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => credsSchema.extend({ force: z.boolean().optional(), todayTop: z.number().int().min(50).max(300).optional() }).parse(d))
  .handler(async ({ data }): Promise<UniverseResult> => {
    const resolved = creds(data);
    const { KisClient } = await import("@/lib/kis/client.server");
    const { buildUniverse } = await import("@/lib/kis/universe.server");
    const client = new KisClient(resolved);
    const todayTop = data.todayTop ?? 50;
    const id = `${resolved.appKey.trim()}:${todayTop}`;
    const hit = universeCache.get(id);
    if (!data.force && hit && Date.now() < hit.until) {
      return { ok: true, universe: hit.snap, marketHours: marketHoursNote() };
    }
    try {
      await client.ensureToken();
      let indexChange: number | null = null;
      try {
        const { fetchSihwang } = await import("@/lib/market/sihwang.server");
        const tape = await fetchSihwang();
        indexChange = tape.korean.find((t) => t.symbol === "KOSPI")?.changeRatePct ?? null;
      } catch {
        indexChange = null;
      }
      const snap = await buildUniverse(client, indexChange, todayTop);
      universeCache.set(id, { until: Date.now() + 5 * 60 * 1000, snap });
      return { ok: true, universe: snap, marketHours: marketHoursNote() };
    } catch (e) {
      return { ok: false, error: errMsg(e) };
    }
  });

export type SihwangResult = { ok: true; sihwang: SihwangSnapshot } | { ok: false; error: string };

export const fetchSihwangFn = createServerFn({ method: "POST" })
  .validator((_d: unknown) => ({}))
  .handler(async (): Promise<SihwangResult> => {
    try {
      const { fetchSihwang } = await import("@/lib/market/sihwang.server");
      return { ok: true, sihwang: await fetchSihwang() };
    } catch (e) {
      return { ok: false, error: errMsg(e) };
    }
  });

export type NewsResult = { ok: true; items: NewsItem[]; fetchedAt: string } | { ok: false; error: string };

export const fetchMarketNewsFn = createServerFn({ method: "POST" })
  .validator((_d: unknown) => ({}))
  .handler(async (): Promise<NewsResult> => {
    try {
      const { fetchMarketNews } = await import("@/lib/market/news.server");
      const items = (await fetchMarketNews()) ?? [];
      return { ok: true, items, fetchedAt: new Date().toISOString() };
    } catch (e) {
      return { ok: false, error: errMsg(e) };
    }
  });

const seedSchema = z.object({
  code: z.string(),
  name: z.string().optional(),
  price: z.number().nullable().optional(),
  changeRatePct: z.number().nullable().optional(),
  volume: z.number().nullable().optional(),
  tradingValue: z.number().nullable().optional(),
  tradingValueEstimated: z.boolean().optional(),
  marketCapEok: z.number().nullable().optional(),
  listedShares: z.number().nullable().optional(),
  avgTradingValue: z.number().nullable().optional(),
  leaderScore: z.number().optional(),
});

const evaluateInput = credsSchema.extend({
  codes: z.array(z.string().min(4).max(8)).min(1).max(8),
  tradingValueCodes: z.array(z.string()),
  changeRateCodes: z.array(z.string()),
  seed: z.array(seedSchema).optional(),
});

export type EvaluateResult =
  | {
      ok: true;
      closing: ClosingBetCandidate[];
      caseVerdicts: CaseVerdict[];
      board: BoardStock[];
      errors: string[];
      excludedPenny: number;
    }
  | { ok: false; error: string };

export const evaluateBatch = createServerFn({ method: "POST" })
  .validator((d: unknown) => evaluateInput.parse(d))
  .handler(async ({ data }): Promise<EvaluateResult> => {
    const { KisClient } = await import("@/lib/kis/client.server");
    const { buildSnapshot } = await import("@/lib/kis/snapshot.server");
    const client = new KisClient(creds(data));
    try {
      await client.ensureToken();
    } catch (e) {
      return { ok: false, error: errMsg(e) };
    }

    let indices: { code: string; name: string; price: number | null; changeRatePct: number | null }[] = [];
    try {
      const { fetchSihwang } = await import("@/lib/market/sihwang.server");
      indices = tapeToIndices(await fetchSihwang());
    } catch {
      indices = [];
    }

    const tvSet = new Set(data.tradingValueCodes);
    const crSet = new Set(data.changeRateCodes);
    const seedByCode = new Map((data.seed ?? []).map((s) => [s.code, s]));

    const closing: ClosingBetCandidate[] = [];
    const caseVerdicts: CaseVerdict[] = [];
    const board: BoardStock[] = [];
    const errors: string[] = [];
    let excludedPenny = 0;

    for (const code of data.codes) {
      const seed = seedByCode.get(code);
      try {
        const snap = await buildSnapshot(client, code, seed);
        if (snap.currentPrice == null) {
          errors.push(`${code} 시세 미확보`);
          continue;
        }
        if (isPennyStock(snap) || !passesBlueChipFilter(snap)) {
          excludedPenny += 1;
          continue;
        }
        const closingRow = evaluateClosingBetCandidate(snap, {
          isTradingValueTop: tvSet.has(code),
          isChangeRateTop: crSet.has(code),
          indices,
        });
        closing.push(closingRow);
        const evaluated: CaseVerdict[] = [];
        for (const cid of CASE_PRIORITY_ORDER) {
          const v = evaluateCase(cid, snap, indices);
          if (snap.errors.length && v.dataConfidence === "실측") v.dataConfidence = "일부 미확보";
          evaluated.push(v);
          if (v.verdict === "적극매수" || v.verdict === "매수") caseVerdicts.push(v);
        }
        board.push(snapshotToBoard(snap, evaluated, closingRow, seed?.leaderScore ?? 0));
      } catch (e) {
        errors.push(`${code} 평가 오류: ${errMsg(e)}`);
      }
    }

    return { ok: true, closing, caseVerdicts, board, errors, excludedPenny };
  });

function snapshotToBoard(
  snap: LiveSnapshot,
  cases: CaseVerdict[],
  closing: ClosingBetCandidate,
  leaderScore: number,
): BoardStock {
  const newsTitles = (snap.newsItems ?? []).map((n) => n.title).filter(Boolean);
  const theme = classifyTheme({ name: snap.stockName ?? snap.stockCode, newsTitles });
  const close20 = toNum(snap.dailyPrices[19]?.stck_clpr);
  const ret20Pct =
    snap.currentPrice != null && close20 && close20 > 0 ? ((snap.currentPrice / close20) - 1) * 100 : null;
  const highs = snap.dailyPrices
    .map((b) => toNum(b.stck_hgpr))
    .filter((n): n is number => n != null);
  const peak = highs.length ? Math.max(...highs) : snap.high60d;
  const highVsPeakPct =
    snap.currentPrice != null && peak && peak > 0 ? ((snap.currentPrice / peak) - 1) * 100 : null;
  const prevVolPct =
    snap.volume != null && snap.prevVolume && snap.prevVolume > 0
      ? ((snap.volume / snap.prevVolume) - 1) * 100
      : null;
  const buys = cases.filter((c) => c.verdict === "적극매수" || c.verdict === "매수");
  const bars = [...snap.dailyPrices]
    .slice(0, 20)
    .reverse()
    .map((b) => ({
      date: String(b.date ?? ""),
      close: toNum(b.stck_clpr) ?? 0,
      volume: toNum(b.acml_vol),
    }))
    .filter((b) => b.close > 0);
  const supply = snap.investorRows.slice(0, 5).map((row) => ({
    date: String(row.stck_bsop_date ?? row.bsop_date ?? ""),
    foreign: toNum(row.frgn_ntby_qty),
    inst: toNum(row.orgn_ntby_qty),
    individual: toNum(row.prsn_ntby_qty),
  }));
  return {
    code: snap.stockCode,
    name: snap.stockName ?? snap.stockCode,
    themeId: theme.id,
    themeName: theme.name,
    currentPrice: snap.currentPrice,
    changeRatePct: snap.changeRatePct,
    rs: null,
    highVsPeakPct,
    tradingValueEok: snap.tradingValueToday != null ? snap.tradingValueToday / 100_000_000 : null,
    prevVolPct,
    ret20Pct,
    isLimitUp: (snap.changeRatePct ?? 0) >= 29.5,
    isNearHigh: highVsPeakPct != null && highVsPeakPct >= -2,
    isLeader: leaderScore >= 4,
    newsTitles,
    cases: buys.length ? buys : cases.filter((c) => c.reasons.length).slice(0, 2),
    closingReasons: closing.conditions.filter((c) => c.status === "pass").map((c) => c.detail || c.label),
    closingConditions: closing.conditions,
    closingQuality: closing.qualityChecks,
    supplyDemandNote: buys[0]?.supplyDemandNote ?? closing.reasonSummary,
    targetPrice: buys[0]?.targetPrice ?? closing.targetPrice,
    stopLoss: buys[0]?.exitPrice ?? closing.stopLoss,
    bars,
    supply: supply.reverse(),
  };
}

const analysisInput = credsSchema.extend({
  query: z.string().min(1).max(40),
});

export type AnalysisResult = { ok: true; report: AnalysisReport } | { ok: false; error: string };

export const analyzeStockFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => analysisInput.parse(d))
  .handler(async ({ data }): Promise<AnalysisResult> => {
    const { KisClient } = await import("@/lib/kis/client.server");
    const { buildSnapshot } = await import("@/lib/kis/snapshot.server");
    const { buildAnalysis } = await import("@/lib/scanner/analysis");
    const client = new KisClient(creds(data));
    const q = data.query.trim();
    let code = /^\d{1,6}$/.test(q) ? q.padStart(6, "0") : "";
    if (!code) {
      const prefix = creds(data).appKey.trim();
      const hit = [...universeCache.entries()].find(([k]) => k === prefix || k.startsWith(`${prefix}:`))?.[1];
      const pool = hit?.snap.selected ?? [];
      const extra = [...(hit?.snap.todayTv ?? []), ...(hit?.snap.prevTv ?? [])];
      const found =
        pool.find((s) => s.name === q) ??
        extra.find((s) => s.name === q) ??
        pool.find((s) => s.name.includes(q)) ??
        extra.find((s) => s.name.includes(q));
      if (!found) {
        return {
          ok: false,
          error: `종목명 '${q}'을(를) 유니버스에서 찾지 못했습니다. 6자리 코드로 입력하거나 먼저 유니버스를 갱신하세요.`,
        };
      }
      code = found.code;
    }
    try {
      await client.ensureToken();
      const snap = await buildSnapshot(client, code);
      let sihwang: SihwangSnapshot | null = null;
      try {
        const { fetchSihwang } = await import("@/lib/market/sihwang.server");
        sihwang = await fetchSihwang();
      } catch {
        sihwang = null;
      }
      const report = await buildAnalysis(snap, sihwang);
      return { ok: true, report };
    } catch (e) {
      return { ok: false, error: errMsg(e) };
    }
  });

const screenItem = z.object({
  code: z.string().min(6).max(6),
  name: z.string(),
  price: z.number().nullable(),
  changeRatePct: z.number().nullable(),
  volume: z.number().nullable(),
});

export const screenChunkFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => credsSchema.extend({ items: z.array(screenItem).min(1).max(6) }).parse(d))
  .handler(async ({ data }) => {
    const { KisClient } = await import("@/lib/kis/client.server");
    const { toNum } = await import("@/lib/scanner/indicators");
    const { detectSigns, classifyDip } = await import("@/lib/scanner/screens");
    const { fetchStockNews } = await import("@/lib/market/news.server");
    const client = new KisClient(creds(data));
    try {
      await client.ensureToken();
      const signs = [];
      const dips = [];
      const reasons: string[] = [];
      const errors: string[] = [];
      for (const item of data.items) {
        try {
          const daily = await client.getDailyPrices(item.code, 100);
          const bar = daily[0];
          const price = item.price ?? toNum(bar?.stck_clpr);
          const { fetchDartFacts } = await import("@/lib/dart/client.server");
          const dart = await fetchDartFacts(item.code, price);
          let news = null;
          try {
            news = await fetchStockNews(item.code, item.name);
          } catch {
            news = null;
          }
          const mergedNews = [...(dart?.titles ?? []), ...(news ?? [])];
          const prev = toNum(daily[1]?.stck_clpr);
          const change =
            item.changeRatePct ??
            (price != null && prev != null && prev !== 0 ? ((price - prev) / prev) * 100 : null);
          const env = {
            stockCode: item.code,
            stockName: item.name,
            currentPrice: price,
            prevClose: prev,
            openPrice: toNum(bar?.stck_oprc),
            highPrice: toNum(bar?.stck_hgpr),
            lowPrice: toNum(bar?.stck_lwpr),
            volume: item.volume ?? toNum(bar?.acml_vol),
            prevVolume: toNum(daily[1]?.acml_vol),
            ma5: null,
            ma10: null,
            ma20: null,
            ma60: null,
            ma120: null,
            high20d: null,
            low20d: null,
            high60d: null,
            low60d: null,
            foreignNetBuy1d: null,
            foreignNetBuy2d: null,
            instNetBuy1d: null,
            instNetBuyCum20: null,
            pensionNetBuyCum20: null,
            programNetBuyToday: null,
            changeRatePct: change,
            tradingValueToday: null,
            tradingValueIsEstimated: false,
            avgTradingValue5d: null,
            dailyPrices: daily,
            investorRows: [],
            foreignNetBuyAmount1d: null,
            instNetBuyAmount1d: null,
            newsItems: mergedNews,
            errors: [],
          };
          signs.push(...detectSigns(env));
          const judged = classifyDip(env);
          reasons.push(judged.reason);
          if (judged.hit) {
            if (dart) {
              judged.hit.missing = judged.hit.missing.filter((m) => !dart.filled.includes(m));
              judged.hit.dartLines = dart.lines;
              judged.hit.news = mergedNews.slice(0, 4).map((n) => `${n.pubDate} ${n.title}`.trim());
              if (dart.note) judged.hit.note = dart.note;
            }
            dips.push(judged.hit);
          }
        } catch (e) {
          errors.push(`${item.name}: ${errMsg(e)}`);
          reasons.push("조회 실패");
        }
      }
      return { ok: true as const, signs, dips, reasons, errors };
    } catch (e) {
      return { ok: false as const, error: errMsg(e) };
    }
  });
