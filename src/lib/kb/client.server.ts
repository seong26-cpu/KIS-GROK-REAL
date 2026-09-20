import type {
  DailyBar,
  InvestorRow,
  BrokerCreds,
  LiveSnapshot,
  MarketIndex,
  RankedStock,
  RankingSnapshot,
  TokenStatus,
} from "@/lib/scanner/types";
import {
  CHANGE_RATE_TOP_N_DEFAULT,
  MIN_PRICE,
  RANKING_CACHE_TTL_MS,
  TRADING_VALUE_TOP_N_DEFAULT,
} from "@/lib/scanner/types";
import {
  asRecord,
  CHG_KEYS,
  CLOSE_KEYS,
  CODE_KEYS,
  DATE_KEYS,
  extractRows,
  headerOk,
  HIGH_KEYS,
  LOW_KEYS,
  NAME_KEYS,
  OPEN_KEYS,
  pickNum,
  pickStockCode,
  pickStr,
  PREV_KEYS,
  PRICE_KEYS,
  RANK_KEYS,
  summarizeShape,
  toNum,
  TV_KEYS,
  VOL_KEYS,
} from "./parse";
import { fetchStockNews } from "@/lib/market/sihwang.server";
import { ymdKst } from "@/lib/scanner/indicators";

const BASE = "https://developer.kbsec.com:32484";

export class KbApiError extends Error {
  detail?: unknown;
  constructor(message: string, detail?: unknown) {
    super(message);
    this.name = "KbApiError";
    this.detail = detail;
  }
}

type TokenCache = { token: string; issuedAt: number; expiresAt: number };
const tokenCache = new Map<string, TokenCache>();
const rankingCache = new Map<string, { snap: RankingSnapshot; until: number }>();

let lastCallAt = 0;
const MIN_INTERVAL_MS = 140;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function throttle() {
  const wait = MIN_INTERVAL_MS - (Date.now() - lastCallAt);
  if (wait > 0) await sleep(wait);
  lastCallAt = Date.now();
}

function cacheId(creds: BrokerCreds) {
  return `kb:${creds.appKey.trim()}`;
}

function scaleTradingValue(tv: number | null, price: number | null, volume: number | null): { value: number | null; estimated: boolean } {
  if (tv == null && price != null && volume != null) return { value: price * volume, estimated: true };
  if (tv == null) return { value: null, estimated: false };
  if (price != null && volume != null) {
    const est = price * volume;
    if (est > 0 && tv > 0) {
      const ratio = est / tv;
      if (ratio > 50_000) return { value: tv * 1_000_000, estimated: false };
      if (ratio > 50) return { value: tv * 1_000, estimated: false };
    }
  }
  return { value: tv, estimated: false };
}

export class KbClient {
  lastRankShape = "";
  constructor(private creds: BrokerCreds) {}

  private get id() {
    return cacheId(this.creds);
  }

  getTokenStatus(): TokenStatus {
    const cached = tokenCache.get(this.id);
    const now = Date.now();
    if (!cached || now >= cached.expiresAt) return { hasToken: false };
    return {
      hasToken: true,
      issuedAt: cached.issuedAt,
      expiresAt: cached.expiresAt,
      secondsRemaining: Math.round(Math.max(0, cached.expiresAt - now) / 1000),
      totalSeconds: Math.round((cached.expiresAt - cached.issuedAt) / 1000),
    };
  }

  async ensureToken(force = false): Promise<string> {
    const now = Date.now();
    const cached = tokenCache.get(this.id);
    const valid = cached && now < cached.expiresAt - 60_000;
    if (!force && valid && cached) return cached.token;
    try {
      return await this.issueToken();
    } catch (err) {
      if (!force && valid && cached) return cached.token;
      throw err;
    }
  }

  async forceRefresh(): Promise<{ success: boolean; fellBack: boolean; error?: string }> {
    try {
      await this.issueToken();
      return { success: true, fellBack: false };
    } catch (err) {
      const cached = tokenCache.get(this.id);
      if (cached && Date.now() < cached.expiresAt - 60_000) {
        return { success: false, fellBack: true, error: err instanceof Error ? err.message : String(err) };
      }
      throw err;
    }
  }

  private async issueToken(): Promise<string> {
    if (!this.creds.appKey?.trim() || !this.creds.appSecret?.trim()) {
      throw new KbApiError("APP_KEY / SECRET_KEY 가 없습니다. KB증권 Open API 포털에서 발급한 실전 키를 등록하세요.");
    }
    await throttle();
    let resp: Response;
    try {
      resp = await fetch(`${BASE}/oauth2/token`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          dataHeader: { ipAddr: "", macAddr: "" },
          dataBody: {
            appKey: this.creds.appKey.trim(),
            appSecret: this.creds.appSecret.trim(),
            grantType: "client_credentials",
          },
        }),
      });
    } catch (e) {
      throw new KbApiError(`토큰 발급 네트워크 오류: ${e instanceof Error ? e.message : String(e)}`);
    }
    const text = await resp.text();
    if (resp.status !== 200) {
      throw new KbApiError(
        `토큰 발급 실패 (HTTP ${resp.status}). KB증권 실전 APP_KEY/SECRET_KEY인지, 포털에서 Open API 사용 신청이 완료됐는지 확인하세요.`,
        { body: text.slice(0, 500) },
      );
    }
    let payload: unknown;
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      throw new KbApiError("토큰 응답을 해석할 수 없습니다.", { body: text.slice(0, 300) });
    }
    const check = headerOk(payload);
    const body = asRecord(asRecord(payload)?.dataBody) ?? asRecord(payload) ?? {};
    const token = String(body.access_token ?? body.accessToken ?? body.token ?? "").trim();
    if (!token) {
      throw new KbApiError(
        check.message
          ? `토큰 발급 실패: ${check.message}`
          : "응답에 access_token이 없습니다. 실전 키와 권한을 확인하세요.",
        payload,
      );
    }
    const expiresIn = toNum(body.expires_in ?? body.expireIn ?? body.expiresIn ?? body.expire_in) ?? 43200;
    const issuedAt = Date.now();
    tokenCache.set(this.id, { token, issuedAt, expiresAt: issuedAt + expiresIn * 1000 });
    return token;
  }

  private async post(path: string, dataBody: Record<string, string>, retry = true): Promise<unknown> {
    await throttle();
    const token = await this.ensureToken();
    let resp: Response;
    try {
      resp = await fetch(`${BASE}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          appKey: this.creds.appKey.trim(),
          Authorization: `bearer ${token}`,
        },
        body: JSON.stringify({ dataHeader: { ipAddr: "", macAddr: "" }, dataBody }),
      });
    } catch (e) {
      throw new KbApiError(`API 네트워크 오류 ${path}: ${e instanceof Error ? e.message : String(e)}`);
    }
    const text = await resp.text();
    if (resp.status === 401 && retry) {
      await this.ensureToken(true);
      return this.post(path, dataBody, false);
    }
    if (resp.status !== 200) {
      throw new KbApiError(`API 호출 실패 (HTTP ${resp.status}) ${path}`, { body: text.slice(0, 800) });
    }
    let payload: unknown;
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      throw new KbApiError(`JSON 해석 실패 ${path}`, { body: text.slice(0, 300) });
    }
    const check = headerOk(payload);
    if (!check.ok) {
      const msg = check.message;
      if (retry && /만료|유효하지|token|인증/i.test(msg)) {
        await this.ensureToken(true);
        return this.post(path, dataBody, false);
      }
      // KB often returns HTTP 200 + resultMessage "성공" with a non-numeric resultCode
      // (SUCCESS / APWKxxxx). If the body actually has rows, use that data.
      if (extractRows(payload).length) return payload;
      throw new KbApiError(
        `KB API 오류(${path}): ${msg || check.code || "업무 처리 실패"}`,
        payload,
      );
    }
    return payload;
  }

  async getCurrentPrice(code: string): Promise<Record<string, unknown>> {
    const payload = await this.post("/api/v1/ivu10140", { excg_clsf: "1", shrt_cd: code });
    const rows = extractRows(payload);
    return rows[0] ?? asRecord(asRecord(payload)?.dataBody) ?? {};
  }

  async getDailyChart(code: string, count = 130): Promise<DailyBar[]> {
    const payload = await this.post("/api/v1/ivs11560", {
      info_ccd: "1",
      mkt_clsf: "1",
      chrt_clsf: "D",
      minute_tck_indx: "",
      is_cd: code,
      inq_clsf: "1",
      strt_dy: "",
      inq_cnt: String(count),
    });
    const rows = extractRows(payload);
    const bars: DailyBar[] = rows.map((row) => ({
      date: pickStr(row, DATE_KEYS),
      stck_clpr: pickNum(row, CLOSE_KEYS) ?? undefined,
      stck_oprc: pickNum(row, OPEN_KEYS) ?? undefined,
      stck_hgpr: pickNum(row, HIGH_KEYS) ?? undefined,
      stck_lwpr: pickNum(row, LOW_KEYS) ?? undefined,
      acml_vol: pickNum(row, VOL_KEYS) ?? undefined,
      acml_tr_pbmn: pickNum(row, TV_KEYS) ?? undefined,
    }));
    bars.sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));
    return bars.slice(0, count);
  }

  async getInvestorTrend(code: string): Promise<InvestorRow[]> {
    const end = ymdKst(0);
    const start = ymdKst(-40);
    const attempts: Record<string, string>[] = [
      {
        excg_clsf: "1",
        is_cd: code,
        strt_dt: start,
        end_dt: end,
        amt_q_clsf: "2",
        trd_clsf: "1",
        acml_clsf: "0",
      },
      {
        excg_clsf: "1",
        is_cd: code,
        strt_dt: start,
        end_dt: end,
        amt_q_clsf: "1",
        trd_clsf: "1",
        acml_clsf: "0",
      },
    ];
    for (const body of attempts) {
      try {
        const payload = await this.post("/api/v1/ivu10430", body);
        const rows = extractRows(payload).map((row) => normalizeInvestor(row, body.amt_q_clsf === "1"));
        if (rows.length) return rows;
      } catch {
        /* try next */
      }
    }
    return [];
  }

  async getTradingValueTop(limit: number): Promise<RankedStock[]> {
    const attempts: Record<string, string>[] = [
      { excg_clsf: "1", mkt_clsf: "1", thdy_bdy_clsf: "1", inq_cnt: "10", srt_clsf: "1" },
      { excg_clsf: "0", mkt_clsf: "1", thdy_bdy_clsf: "1", inq_cnt: "10", srt_clsf: "1" },
      { excg_clsf: "1", mkt_clsf: "1", thdy_bdy_clsf: "2", inq_cnt: "10", srt_clsf: "1" },
    ];
    return this.fetchRankedList("/api/v1/ivu10210", attempts, limit, "trading_value");
  }

  async getChangeRateTop(limit: number): Promise<RankedStock[]> {
    const attempts: Record<string, string>[] = [
      { excg_clsf: "1", mkt_clsf: "1", inq_cnt: "10", srt_clsf: "1" },
      { excg_clsf: "0", mkt_clsf: "1", inq_cnt: "10", srt_clsf: "1" },
    ];
    return this.fetchRankedList("/api/v1/ivu10240", attempts, limit, "change_rate");
  }

  private async fetchRankedList(
    path: string,
    attempts: Record<string, string>[],
    limit: number,
    source: RankedStock["source"],
  ): Promise<RankedStock[]> {
    const shapes: string[] = [];
    for (const body of attempts) {
      try {
        const payload = await this.post(path, body);
        const mapped = mapRanked(payload, limit, source);
        if (mapped.length) return mapped;
        shapes.push(`${body.excg_clsf}/${body.thdy_bdy_clsf ?? "-"}:${summarizeShape(payload)}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/종목코드/.test(msg)) throw e;
        shapes.push(`${body.excg_clsf}:${msg.slice(0, 120)}`);
      }
    }
    this.lastRankShape = shapes.join(" || ");
    return [];
  }

  async getMarketSummary(): Promise<MarketIndex[]> {
    try {
      const payload = await this.post("/api/v1/ivsa0070", {});
      return extractRows(payload)
        .map((row) => rowToIndex(row))
        .filter((x) => x.name);
    } catch {
      return [];
    }
  }

  async getWorldIndex(): Promise<MarketIndex[]> {
    try {
      const payload = await this.post("/api/v1/iva60140", { lnd_clsf: "1", prd_clsf: "1" });
      return extractRows(payload)
        .map((row) => rowToIndex(row))
        .filter((x) => x.name);
    } catch {
      return [];
    }
  }

  async getFxSummary(): Promise<MarketIndex[]> {
    try {
      const payload = await this.post("/api/v1/iva60190", {});
      return extractRows(payload)
        .map((row) => rowToIndex(row))
        .filter((x) => x.name)
        .slice(0, 6);
    } catch {
      return [];
    }
  }

  async getKbNews(code: string): Promise<import("@/lib/scanner/types").NewsItem[]> {
    const items: import("@/lib/scanner/types").NewsItem[] = [];
    try {
      const payload = await this.post("/api/v1/ivm10050", { is_cd: code });
      const rows = extractRows(payload);
      for (const row of rows) {
        const title = pickStr(row, [
          "news_titl",
          "titl",
          "title",
          "head",
          "ovrvw",
          "cntt",
          "biz_ovrvw",
          "corp_desc",
          "summ",
          "hngl_ovrvw",
          "main_prod",
          "biz_cntt",
          "prod_nm",
        ]);
        if (title.length >= 8) {
          items.push({
            title: title.slice(0, 180),
            pubDate: pickStr(row, DATE_KEYS),
            source: "KB 기업개요",
            code,
          });
        }
      }
    } catch {
      /* optional */
    }
    return items.slice(0, 4);
  }

  async fetchRankings(opts?: {
    tradingValueN?: number;
    changeRateN?: number;
    force?: boolean;
  }): Promise<RankingSnapshot> {
    const tvN = opts?.tradingValueN ?? TRADING_VALUE_TOP_N_DEFAULT;
    const crN = opts?.changeRateN ?? CHANGE_RATE_TOP_N_DEFAULT;
    const id = `${this.id}:${tvN}:${crN}`;
    const hit = rankingCache.get(id);
    if (!opts?.force && hit && Date.now() < hit.until) {
      return { ...hit.snap, cacheHit: true, ttlSec: Math.round((hit.until - Date.now()) / 1000) };
    }

    await this.ensureToken();

    const [tvRes, crRes, summary, world, fx] = await Promise.allSettled([
      this.getTradingValueTop(Math.min(30, tvN)),
      this.getChangeRateTop(Math.min(30, crN)),
      this.getMarketSummary(),
      this.getWorldIndex(),
      this.getFxSummary(),
    ]);

    if (tvRes.status === "rejected" && crRes.status === "rejected") {
      const a = tvRes.reason instanceof Error ? tvRes.reason.message : String(tvRes.reason);
      const b = crRes.reason instanceof Error ? crRes.reason.message : String(crRes.reason);
      throw new KbApiError(`순위 API 호출 실패. 거래대금: ${a} / 등락률: ${b}`);
    }

    const tradingValueTop =
      tvRes.status === "fulfilled" ? tvRes.value.filter((s) => s.price == null || s.price >= MIN_PRICE) : [];
    const changeRateTop =
      crRes.status === "fulfilled" ? crRes.value.filter((s) => s.price == null || s.price >= MIN_PRICE) : [];

    if (!tradingValueTop.length && !changeRateTop.length) {
      const tvNote = tvRes.status === "rejected" ? String(tvRes.reason) : `행 ${tvRes.value.length}건`;
      const crNote = crRes.status === "rejected" ? String(crRes.reason) : `행 ${crRes.value.length}건`;
      throw new KbApiError(
        `KB 순위 응답에서 종목코드를 읽지 못했습니다. 거래대금(${tvNote}) / 등락률(${crNote}). 응답형태: ${this.lastRankShape || "없음"}. 숫자를 지어내지 않습니다.`,
      );
    }

    const mergedMap = new Map<string, RankedStock>();
    for (const s of tradingValueTop) mergedMap.set(s.code, { ...s, source: "trading_value" });
    for (const s of changeRateTop) {
      const prev = mergedMap.get(s.code);
      if (prev) mergedMap.set(s.code, { ...prev, source: "both", name: prev.name || s.name });
      else mergedMap.set(s.code, { ...s, source: "change_rate" });
    }

    const merged = [...mergedMap.values()].sort((a, b) => {
      const sourceScore = (s: RankedStock) => (s.source === "both" ? 2 : s.source === "trading_value" ? 1 : 0);
      const ds = sourceScore(b) - sourceScore(a);
      if (ds !== 0) return ds;
      const dv = (b.tradingValue ?? 0) - (a.tradingValue ?? 0);
      if (dv !== 0) return dv;
      return a.code.localeCompare(b.code);
    });

    const indices: MarketIndex[] = [];
    for (const res of [summary, world, fx]) {
      if (res.status === "fulfilled") indices.push(...res.value);
    }

    const snap: RankingSnapshot = {
      fetchedAt: new Date().toISOString(),
      tradingValueTop,
      changeRateTop,
      merged,
      indices,
      cacheHit: false,
      ttlSec: Math.round(RANKING_CACHE_TTL_MS / 1000),
    };
    rankingCache.set(id, { snap, until: Date.now() + RANKING_CACHE_TTL_MS });
    return snap;
  }

  async selfTest(): Promise<Record<string, unknown>> {
    const report: Record<string, unknown> = {};
    try {
      await this.ensureToken();
      report.token = "OK (KB 실전)";
    } catch (e) {
      report.token = `FAIL: ${e instanceof Error ? e.message : String(e)}`;
      return report;
    }
    try {
      const sample = await this.getCurrentPrice("005930");
      report.current_price = {
        status: "OK",
        name: pickStr(sample, NAME_KEYS) || "삼성전자",
        price: pickNum(sample, PRICE_KEYS),
      };
    } catch (e) {
      report.current_price = { status: "FAIL", error: e instanceof Error ? e.message : String(e) };
    }
    try {
      const ranks = await this.getTradingValueTop(3);
      report.volume_rank = { status: "OK", sample: ranks.slice(0, 3).map((r) => `${r.name}(${r.code})`) };
    } catch (e) {
      report.volume_rank = { status: "FAIL", error: e instanceof Error ? e.message : String(e) };
    }
    try {
      const kbNews = await this.getKbNews("005930");
      report.kb_overview = {
        status: kbNews.length ? "OK" : "EMPTY",
        sample: kbNews.slice(0, 2).map((n) => n.title),
      };
    } catch (e) {
      report.kb_overview = { status: "FAIL", error: e instanceof Error ? e.message : String(e) };
    }
    try {
      const news = await fetchStockNews("005930", "삼성전자");
      report.news = {
        status: news == null ? "FAIL" : "OK",
        count: news?.length ?? 0,
        sample: news?.slice(0, 2).map((n) => n.title),
      };
    } catch (e) {
      report.news = { status: "FAIL", error: e instanceof Error ? e.message : String(e) };
    }
    return report;
  }
}

function mapRanked(payload: unknown, limit: number, source: RankedStock["source"]): RankedStock[] {
  const rows = extractRows(payload);
  const mapped = rows
    .map((row, i) => rowToRanked(row, i + 1, source))
    .filter((s) => s.code)
    .slice(0, limit);
  if (!mapped.length && rows.length) {
    const keys = Object.keys(rows[0] ?? {}).slice(0, 24).join(",");
    throw new KbApiError(
      `${source === "trading_value" ? "거래대금상위" : "등락률상위"} 응답 ${rows.length}건을 받았지만 종목코드를 찾지 못했습니다. 필드: ${keys}`,
    );
  }
  return mapped;
}

function rowToIndex(row: Record<string, unknown>): MarketIndex {
  const name =
    pickStr(row, [...NAME_KEYS, "idx_nm", "mkt_nm", "index_nm", "curr_nm", "fx_nm"]) ||
    pickStr(row, ["idx_cd", "curr_cd"]);
  const code = pickStr(row, ["idx_cd", "mkt_cd", "curr_cd", ...CODE_KEYS]) || name;
  return {
    code,
    name: name || code,
    price: pickNum(row, [...PRICE_KEYS, "idx_prc", "now_idx", "fx_prc", "deal_bas_r"]),
    changeRatePct: pickNum(row, CHG_KEYS),
  };
}

function rowToRanked(row: Record<string, unknown>, rank: number, source: RankedStock["source"]): RankedStock {
  const code = pickStockCode(row);
  const name = pickStr(row, NAME_KEYS);
  const price = pickNum(row, PRICE_KEYS);
  const changeRatePct = pickNum(row, CHG_KEYS);
  const volume = pickNum(row, VOL_KEYS);
  const rawTv = pickNum(row, TV_KEYS);
  const scaled = scaleTradingValue(rawTv, price, volume);
  return {
    code,
    name,
    rank: pickNum(row, RANK_KEYS) ?? rank,
    price,
    changeRatePct,
    volume,
    tradingValue: scaled.value,
    tradingValueEstimated: scaled.estimated,
    source,
  };
}

function normalizeInvestor(row: Record<string, unknown>, byAmount: boolean): InvestorRow {
  const frgn = pickNum(row, ["frgn_ntby_qty", "frgn_ntby", "fogn_ntby_qty", "frgn_net", "forn_ntby_qty", "frgn_ntby_amt"]);
  const inst = pickNum(row, ["orgn_ntby_qty", "orgn_ntby", "inst_ntby", "inst_net", "orgn_ntby_amt", "inst_ntby_qty"]);
  const out: InvestorRow = {
    date: pickStr(row, DATE_KEYS),
    frgn_ntby_qty: byAmount ? undefined : (frgn ?? undefined),
    orgn_ntby_qty: byAmount ? undefined : (inst ?? undefined),
    frgn_ntby_tr_pbmn: byAmount ? (frgn ?? undefined) : pickNum(row, ["frgn_ntby_tr_pbmn", "frgn_ntby_amt"]) ?? undefined,
    orgn_ntby_tr_pbmn: byAmount ? (inst ?? undefined) : pickNum(row, ["orgn_ntby_tr_pbmn", "orgn_ntby_amt"]) ?? undefined,
  };
  if (!byAmount && frgn != null) out.frgn_ntby_qty = frgn;
  if (!byAmount && inst != null) out.orgn_ntby_qty = inst;
  return out;
}

export function emptySnapshot(code: string): LiveSnapshot {
  return {
    stockCode: code,
    stockName: null,
    currentPrice: null,
    prevClose: null,
    openPrice: null,
    highPrice: null,
    lowPrice: null,
    volume: null,
    prevVolume: null,
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
    changeRatePct: null,
    tradingValueToday: null,
    tradingValueIsEstimated: false,
    avgTradingValue5d: null,
    dailyPrices: [],
    investorRows: [],
    foreignNetBuyAmount1d: null,
    instNetBuyAmount1d: null,
    newsItems: null,
    errors: [],
  };
}

export async function buildSnapshot(
  client: KbClient,
  code: string,
  seed?: Partial<{
    name: string;
    price: number | null;
    changeRatePct: number | null;
    volume: number | null;
    tradingValue: number | null;
    tradingValueEstimated: boolean;
  }>,
): Promise<LiveSnapshot> {
  const snap = emptySnapshot(code);
  snap.stockName = seed?.name ?? null;
  snap.currentPrice = seed?.price ?? null;
  snap.changeRatePct = seed?.changeRatePct ?? null;
  snap.volume = seed?.volume ?? null;
  if (seed?.tradingValue != null) {
    snap.tradingValueToday = seed.tradingValue;
    snap.tradingValueIsEstimated = Boolean(seed.tradingValueEstimated);
  }

  try {
    const cur = await client.getCurrentPrice(code);
    snap.stockName = pickStr(cur, NAME_KEYS) || snap.stockName;
    snap.currentPrice = pickNum(cur, PRICE_KEYS) ?? snap.currentPrice;
    snap.prevClose = pickNum(cur, PREV_KEYS);
    snap.openPrice = pickNum(cur, OPEN_KEYS);
    snap.highPrice = pickNum(cur, HIGH_KEYS);
    snap.lowPrice = pickNum(cur, LOW_KEYS);
    snap.volume = pickNum(cur, VOL_KEYS) ?? snap.volume;
    snap.changeRatePct = pickNum(cur, CHG_KEYS) ?? snap.changeRatePct;
    const tv = pickNum(cur, TV_KEYS);
    const scaled = scaleTradingValue(tv, snap.currentPrice, snap.volume);
    if (scaled.value != null) {
      snap.tradingValueToday = scaled.value;
      snap.tradingValueIsEstimated = scaled.estimated;
    }
  } catch (e) {
    snap.errors.push(`현재가 조회 실패: ${e instanceof Error ? e.message : String(e)}`);
  }

  try {
    const daily = await client.getDailyChart(code, 130);
    snap.dailyPrices = daily;
    const { computeMa, computeHighLow } = await import("@/lib/scanner/indicators");
    snap.ma5 = computeMa(daily, 5);
    snap.ma10 = computeMa(daily, 10);
    snap.ma20 = computeMa(daily, 20);
    snap.ma60 = computeMa(daily, 60);
    snap.ma120 = computeMa(daily, 120);
    const [h20, l20] = computeHighLow(daily, 20);
    const [h60, l60] = computeHighLow(daily, 60);
    snap.high20d = h20;
    snap.low20d = l20;
    snap.high60d = h60;
    snap.low60d = l60;
    if (daily.length >= 2) snap.prevVolume = toNum(daily[1]?.acml_vol);
    const vals: number[] = [];
    for (const row of daily.slice(0, 5)) {
      let v = toNum(row.acml_tr_pbmn);
      if (v == null) {
        const c = toNum(row.stck_clpr);
        const vol = toNum(row.acml_vol);
        if (c != null && vol != null) v = c * vol;
      }
      if (v != null) vals.push(v);
    }
    if (vals.length) snap.avgTradingValue5d = vals.reduce((a, b) => a + b, 0) / vals.length;
  } catch (e) {
    snap.errors.push(`일봉 조회 실패: ${e instanceof Error ? e.message : String(e)}`);
  }

  try {
    const inv = await client.getInvestorTrend(code);
    snap.investorRows = inv;
    if (inv.length) {
      const latest = inv[0]!;
      snap.foreignNetBuy1d = toNum(latest.frgn_ntby_qty);
      snap.instNetBuy1d = toNum(latest.orgn_ntby_qty);
      snap.foreignNetBuyAmount1d = toNum(latest.frgn_ntby_tr_pbmn);
      snap.instNetBuyAmount1d = toNum(latest.orgn_ntby_tr_pbmn);
      if (inv.length > 1) snap.foreignNetBuy2d = toNum(inv[1]!.frgn_ntby_qty);
      let cum = 0;
      let got = false;
      for (const row of inv.slice(0, 20)) {
        const v = toNum(row.orgn_ntby_qty);
        if (v != null) {
          cum += v;
          got = true;
        }
      }
      snap.instNetBuyCum20 = got ? cum : null;
    }
  } catch (e) {
    snap.errors.push(`수급 조회 실패: ${e instanceof Error ? e.message : String(e)}`);
  }

  try {
    const [publicNews, kbNews] = await Promise.all([
      fetchStockNews(code, snap.stockName ?? undefined).catch(() => null),
      client.getKbNews(code).catch(() => [] as import("@/lib/scanner/types").NewsItem[]),
    ]);
    if (publicNews == null && !kbNews.length) {
      snap.newsItems = null;
    } else {
      const seen = new Set<string>();
      const merged: import("@/lib/scanner/types").NewsItem[] = [];
      for (const n of [...kbNews, ...(publicNews ?? [])]) {
        const key = n.title.slice(0, 40);
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(n);
      }
      snap.newsItems = merged.slice(0, 8);
    }
  } catch (e) {
    snap.errors.push(`뉴스 조회 실패: ${e instanceof Error ? e.message : String(e)}`);
    snap.newsItems = null;
  }

  return snap;
}
