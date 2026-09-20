import type { BrokerCreds, DailyBar, InvestorRow, TokenStatus } from "@/lib/scanner/types";
import { toNum, ymdKst } from "@/lib/scanner/indicators";

const BASE = "https://openapi.koreainvestment.com:9443";

export class KisApiError extends Error {
  detail?: unknown;
  constructor(message: string, detail?: unknown) {
    super(message);
    this.name = "KisApiError";
    this.detail = detail;
  }
}

type TokenCache = { token: string; issuedAt: number; expiresAt: number };
const tokenCache = new Map<string, TokenCache>();
let lastCallAt = 0;
const MIN_INTERVAL_MS = 120;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function throttle() {
  const wait = MIN_INTERVAL_MS - (Date.now() - lastCallAt);
  if (wait > 0) await sleep(wait);
  lastCallAt = Date.now();
}

function cacheId(creds: BrokerCreds) {
  return `kis:${creds.appKey.trim()}`;
}

function asRec(v: unknown): Record<string, unknown> | null {
  return v != null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function asRows(v: unknown): Record<string, unknown>[] {
  if (Array.isArray(v)) return v.filter((x): x is Record<string, unknown> => Boolean(asRec(x)));
  const rec = asRec(v);
  return rec ? [rec] : [];
}

export type VolumeRankRow = {
  code: string;
  name: string;
  rank: number;
  price: number | null;
  changeRatePct: number | null;
  volume: number | null;
  prevVolume: number | null;
  tradingValue: number | null;
  avgTradingValue: number | null;
  listedShares: number | null;
};

export class KisClient {
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
    const valid = Boolean(cached && now < cached.expiresAt - 60_000);
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
    const appkey = this.creds.appKey.trim();
    const appsecret = this.creds.appSecret.trim();
    if (!appkey || !appsecret) {
      throw new KisApiError("KIS 실전 APP_KEY / SECRET_KEY가 없습니다.");
    }
    await throttle();
    let resp: Response;
    try {
      resp = await fetch(`${BASE}/oauth2/tokenP`, {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({ grant_type: "client_credentials", appkey, appsecret }),
      });
    } catch (e) {
      throw new KisApiError(`토큰 발급 네트워크 오류: ${e instanceof Error ? e.message : String(e)}`);
    }
    const text = await resp.text();
    if (resp.status !== 200) {
      throw new KisApiError(
        `토큰 발급 실패 (HTTP ${resp.status}). 한국투자증권 포털의 실전투자 APP_KEY/SECRET_KEY인지 확인하세요. 모의투자 키는 거래대금이 비어 이 스캐너에 쓰지 않습니다.`,
        { body: text.slice(0, 400) },
      );
    }
    let payload: unknown;
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      throw new KisApiError("토큰 응답을 해석할 수 없습니다.", { body: text.slice(0, 300) });
    }
    const rec = asRec(payload) ?? {};
    const token = String(rec.access_token ?? "").trim();
    if (!token) {
      throw new KisApiError(`토큰 발급 실패: ${String(rec.msg1 ?? rec.error_description ?? "access_token 없음")}`, payload);
    }
    const expiresIn = toNum(rec.expires_in) ?? 43200;
    const issuedAt = Date.now();
    tokenCache.set(this.id, { token, issuedAt, expiresAt: issuedAt + expiresIn * 1000 });
    return token;
  }

  private async get(path: string, trId: string, params: Record<string, string>, retry = true): Promise<Record<string, unknown>> {
    await throttle();
    const token = await this.ensureToken();
    const url = new URL(`${BASE}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    let resp: Response;
    try {
      resp = await fetch(url.toString(), {
        method: "GET",
        headers: {
          "content-type": "application/json; charset=utf-8",
          authorization: `Bearer ${token}`,
          appkey: this.creds.appKey.trim(),
          appsecret: this.creds.appSecret.trim(),
          tr_id: trId,
          custtype: "P",
        },
      });
    } catch (e) {
      throw new KisApiError(`API 네트워크 오류 ${path}: ${e instanceof Error ? e.message : String(e)}`);
    }
    const text = await resp.text();
    if (resp.status === 401 && retry) {
      await this.ensureToken(true);
      return this.get(path, trId, params, false);
    }
    if (resp.status !== 200) {
      throw new KisApiError(`API 호출 실패 (HTTP ${resp.status}) ${path}`, { body: text.slice(0, 600) });
    }
    let payload: unknown;
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      throw new KisApiError(`JSON 해석 실패 ${path}`, { body: text.slice(0, 300) });
    }
    const rec = asRec(payload) ?? {};
    const rt = String(rec.rt_cd ?? "");
    if (rt && rt !== "0") {
      const msg = String(rec.msg1 ?? rec.msg_cd ?? "업무 실패");
      if (retry && /만료|유효하지|token/i.test(msg)) {
        await this.ensureToken(true);
        return this.get(path, trId, params, false);
      }
      throw new KisApiError(`KIS API 오류(${trId}): ${msg}`, payload);
    }
    return rec;
  }

  async selfTest(): Promise<Record<string, unknown>> {
    const report: Record<string, unknown> = {};
    try {
      await this.ensureToken();
      report.token = "OK";
    } catch (e) {
      report.token = `FAIL: ${e instanceof Error ? e.message : String(e)}`;
      return report;
    }
    try {
      const p = await this.getCurrentPrice("005930");
      report.current_price = { status: "OK", name: p.hts_kor_isnm, price: p.stck_prpr };
    } catch (e) {
      report.current_price = { status: "FAIL", error: e instanceof Error ? e.message : String(e) };
    }
    try {
      const rows = await this.getVolumeRank("3");
      report.volume_rank = { status: "OK", count: rows.length, sample: rows[0] };
    } catch (e) {
      report.volume_rank = { status: "FAIL", error: e instanceof Error ? e.message : String(e) };
    }
    return report;
  }

  async getCurrentPrice(code: string): Promise<Record<string, unknown>> {
    const data = await this.get("/uapi/domestic-stock/v1/quotations/inquire-price", "FHKST01010100", {
      FID_COND_MRKT_DIV_CODE: "J",
      FID_INPUT_ISCD: code,
    });
    return asRec(data.output) ?? {};
  }

  async getDailyPrices(code: string, period = 130): Promise<DailyBar[]> {
    const end = ymdKst(0);
    const start = ymdKst(-400);
    try {
      const data = await this.get("/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice", "FHKST03010100", {
        FID_COND_MRKT_DIV_CODE: "J",
        FID_INPUT_ISCD: code,
        FID_INPUT_DATE_1: start,
        FID_INPUT_DATE_2: end,
        FID_PERIOD_DIV_CODE: "D",
        FID_ORG_ADJ_PRC: "0",
      });
      const rows = asRows(data.output2 ?? data.output);
      if (rows.length) {
        return rows.slice(0, period).map(rowToBar);
      }
    } catch {
      /* fall through to 30-day endpoint */
    }
    const data = await this.get("/uapi/domestic-stock/v1/quotations/inquire-daily-price", "FHKST01010400", {
      FID_COND_MRKT_DIV_CODE: "J",
      FID_INPUT_ISCD: code,
      FID_PERIOD_DIV_CODE: "D",
      FID_ORG_ADJ_PRC: "0",
    });
    return asRows(data.output).slice(0, period).map(rowToBar);
  }

  async getInvestorTrend(code: string): Promise<InvestorRow[]> {
    const data = await this.get("/uapi/domestic-stock/v1/quotations/inquire-investor", "FHKST01010900", {
      FID_COND_MRKT_DIV_CODE: "J",
      FID_INPUT_ISCD: code,
    });
    return asRows(data.output) as InvestorRow[];
  }

  /**
   * 국내주식 거래량순위 FHPST01710000.
   * blng: 0 평균거래량 · 3 거래금액순
   * date: YYYYMMDD, 공란이면 당일
   */
  async getVolumeRank(blng: "0" | "3", date = ""): Promise<VolumeRankRow[]> {
    const data = await this.get("/uapi/domestic-stock/v1/quotations/volume-rank", "FHPST01710000", {
      FID_COND_MRKT_DIV_CODE: "J",
      FID_COND_SCR_DIV_CODE: "20171",
      FID_INPUT_ISCD: "0000",
      FID_DIV_CLS_CODE: "0",
      FID_BLNG_CLS_CODE: blng,
      FID_TRGT_CLS_CODE: "111111111",
      FID_TRGT_EXLS_CLS_CODE: "0000000000",
      FID_INPUT_PRICE_1: "",
      FID_INPUT_PRICE_2: "",
      FID_VOL_CNT: "",
      FID_INPUT_DATE_1: date,
    });
    return asRows(data.output).map(mapVolumeRank).filter((r) => r.code);
  }

  async getFluctuationRank(): Promise<VolumeRankRow[]> {
    const data = await this.get("/uapi/domestic-stock/v1/ranking/fluctuation", "FHPST01700000", {
      fid_cond_mrkt_div_code: "J",
      fid_cond_scr_div_code: "20170",
      fid_input_iscd: "0000",
      fid_div_cls_code: "0",
      fid_blng_cls_code: "0",
      fid_trgt_cls_code: "111111111",
      fid_trgt_exls_cls_code: "0000000000",
      fid_input_price_1: "",
      fid_input_price_2: "",
      fid_vol_cnt: "",
      fid_input_date_1: "",
    });
    return asRows(data.output).map(mapVolumeRank).filter((r) => r.code);
  }
}

function rowToBar(row: Record<string, unknown>): DailyBar {
  return {
    date: String(row.stck_bsop_date ?? row.date ?? ""),
    stck_clpr: toNum(row.stck_clpr) ?? undefined,
    stck_oprc: toNum(row.stck_oprc) ?? undefined,
    stck_hgpr: toNum(row.stck_hgpr) ?? undefined,
    stck_lwpr: toNum(row.stck_lwpr) ?? undefined,
    acml_vol: toNum(row.acml_vol) ?? undefined,
    acml_tr_pbmn: toNum(row.acml_tr_pbmn) ?? undefined,
  };
}

function padCode(raw: unknown): string {
  const s = String(raw ?? "")
    .trim()
    .replace(/^A/, "");
  if (!/^\d{1,6}$/.test(s)) return "";
  return s.padStart(6, "0");
}

function mapVolumeRank(row: Record<string, unknown>, i: number): VolumeRankRow {
  const price = toNum(row.stck_prpr);
  const volume = toNum(row.acml_vol);
  let tradingValue = toNum(row.acml_tr_pbmn ?? row.tr_pbmn);
  if (tradingValue == null && price != null && volume != null) tradingValue = price * volume;
  return {
    code: padCode(row.mksc_shrn_iscd ?? row.stck_shrn_iscd ?? row.stck_bsop_iscd),
    name: String(row.hts_kor_isnm ?? row.hts_kor_isnm ?? "").trim(),
    rank: toNum(row.data_rank) ?? i + 1,
    price,
    changeRatePct: toNum(row.prdy_ctrt),
    volume,
    prevVolume: toNum(row.prdy_vol),
    tradingValue,
    avgTradingValue: toNum(row.avrg_tr_pbmn),
    listedShares: toNum(row.lstn_stcn),
  };
}
