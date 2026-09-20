export function asRecord(v: unknown): Record<string, unknown> | null {
  return v != null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export function toNum(val: unknown): number | null {
  if (val == null || val === "") return null;
  if (typeof val === "number") return Number.isFinite(val) ? val : null;
  const s = String(val).replace(/,/g, "").replace(/%/g, "").replace(/\+/g, "").trim();
  if (!s || s === "-") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function pickStr(row: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (v == null) continue;
    const s = String(v).trim();
    if (s && s !== "null" && s !== "undefined") return s;
  }
  return "";
}

export function pickNum(row: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const n = toNum(row[k]);
    if (n != null) return n;
  }
  return null;
}

export function normalizeStockCode(raw: string): string {
  const s = raw.trim().toUpperCase().replace(/^A/, "").replace(/\.0+$/, "");
  if (!/^\d{1,6}$/.test(s)) return "";
  return s.padStart(6, "0");
}

export function pickStockCode(row: Record<string, unknown>): string {
  const direct = normalizeStockCode(pickStr(row, CODE_KEYS));
  if (direct) return direct;
  for (const [k, v] of Object.entries(row)) {
    if (v == null || typeof v === "object") continue;
    if (/result|message|msg_?cd|status|header|lngth|clsf/i.test(k) && !CODE_KEYS.includes(k)) continue;
    const code = normalizeStockCode(String(v));
    if (code) return code;
  }
  return "";
}

export function unwrapBody(payload: unknown): Record<string, unknown> | unknown[] | null {
  let current: unknown = payload;
  for (let i = 0; i < 6; i++) {
    current = parseMaybeJson(current);
    if (Array.isArray(current)) return current;
    const root = asRecord(current);
    if (!root) return null;
    const nested =
      root.dataBody ??
      root.data_body ??
      root.DataBody ??
      root.output ??
      root.output1 ??
      root.body ??
      root.result;
    if (nested == null) return root;
    const nestedParsed = parseMaybeJson(nested);
    if (Array.isArray(nestedParsed)) return nestedParsed;
    const rec = asRecord(nestedParsed);
    if (!rec) return root;
    if (rec.dataBody != null || rec.data_body != null || rec.DataBody != null) {
      current = rec;
      continue;
    }
    return rec;
  }
  return asRecord(current);
}

function parseMaybeJson(v: unknown): unknown {
  if (typeof v !== "string") return v;
  const t = v.trim();
  if (
    (t.startsWith("{") && t.endsWith("}")) ||
    (t.startsWith("[") && t.endsWith("]"))
  ) {
    try {
      return JSON.parse(t) as unknown;
    } catch {
      return v;
    }
  }
  return v;
}

const LIST_KEYS = [
  "OutBlock1",
  "OutBlock_1",
  "OutBlock2",
  "outBlock1",
  "outblock1",
  "outRec1",
  "outRecList",
  "recList",
  "rec",
  "grid",
  "Grid",
  "list",
  "rows",
  "items",
  "output",
  "output1",
  "output2",
];

function asRowArray(v: unknown): Record<string, unknown>[] {
  if (!Array.isArray(v) || !v.length) return [];
  return v.filter((x): x is Record<string, unknown> => Boolean(asRecord(x)));
}

function looksLikeDataRow(row: Record<string, unknown>): boolean {
  if (pickStockCode(row)) return true;
  if (pickStr(row, NAME_KEYS) && pickNum(row, PRICE_KEYS) != null) return true;
  if (pickStr(row, ["idx_cd", "idx_nm", "mkt_nm", "curr_cd", "fx_nm"])) return true;
  return false;
}

function isScalarArray(v: unknown): v is unknown[] {
  return Array.isArray(v) && v.length > 0 && v.every((x) => x == null || typeof x !== "object");
}

/** KB host XML TRs often serialize OCCURS as parallel arrays: { is_cd: ["005930",...], now_prc: [...] }. */
export function unzipParallel(rec: Record<string, unknown>): Record<string, unknown>[] {
  const arrays: [string, unknown[]][] = [];
  for (const [k, v] of Object.entries(rec)) {
    if (isScalarArray(v)) arrays.push([k, v]);
  }
  if (arrays.length < 2) return [];
  const codeEntry =
    arrays.find(([k]) => CODE_KEYS.includes(k)) ??
    arrays.find(([, arr]) => arr.some((x) => normalizeStockCode(String(x ?? ""))));
  if (!codeEntry) return [];
  const n = codeEntry[1].length;
  if (n < 1) return [];
  const usable = arrays.filter(([, arr]) => arr.length === n);
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < n; i++) {
    const row: Record<string, unknown> = {};
    for (const [k, arr] of usable) row[k] = arr[i];
    if (pickStockCode(row)) rows.push(row);
  }
  return rows;
}

export function extractRows(payload: unknown): Record<string, unknown>[] {
  return findRowsDeep(payload, 0);
}

function findRowsDeep(payload: unknown, depth: number): Record<string, unknown>[] {
  if (depth > 8) return [];
  const value = parseMaybeJson(payload);
  if (Array.isArray(value)) {
    const objs = asRowArray(value);
    if (objs.length) {
      const withCode = objs.filter((row) => looksLikeDataRow(row) || pickStockCode(row));
      return withCode.length ? withCode : objs;
    }
    for (const item of value) {
      const nested = findRowsDeep(item, depth + 1);
      if (nested.length) return nested;
    }
    return [];
  }

  const rec = asRecord(value);
  if (!rec) return [];

  const unzipped = unzipParallel(rec);
  if (unzipped.length) return unzipped;

  for (const k of LIST_KEYS) {
    const rows = asRowArray(parseMaybeJson(rec[k]));
    if (rows.length) return rows;
  }

  for (const child of Object.values(rec)) {
    const found = findRowsDeep(child, depth + 1);
    if (found.length) return found;
  }

  if (looksLikeDataRow(rec)) return [rec];
  return [];
}

export function summarizeShape(payload: unknown): string {
  return keyTree(payload, 0);
}

function keyTree(v: unknown, depth: number): string {
  if (depth > 3) return "...";
  const parsed = parseMaybeJson(v);
  if (Array.isArray(parsed)) {
    const inner = parsed.length ? keyTree(parsed[0], depth + 1) : "";
    return `arr(${parsed.length}${inner ? `:${inner}` : ""})`;
  }
  const rec = asRecord(parsed);
  if (!rec) return typeof parsed;
  const fields = Object.entries(rec)
    .slice(0, 16)
    .map(([k, val]) => `${k}:${keyTree(val, depth + 1)}`);
  return `{${fields.join(",")}}`;
}

const SUCCESS_CODE = /^(0+|1|200|ok|okay|success|succ|y|true)$/i;
const SUCCESS_MSG = /성공|정상처리|^success$|^ok$|^정상/;
const FAIL_MSG = /실패|오류|에러|error|fail|invalid|만료|권한없음|거부|미등록/;

export function headerOk(payload: unknown): { ok: boolean; message: string; code: string } {
  const root = asRecord(payload);
  if (!root) return { ok: false, message: "빈 응답", code: "" };
  const header =
    asRecord(root.dataHeader) ?? asRecord(root.data_header) ?? asRecord(root.header) ?? root;
  // msg_cd is a business message id (e.g. MCA00000) even on success — never treat it as resultCode.
  const rawCode = header.resultCode ?? header.result_code ?? header.rt_cd ?? header.errorCode ?? header.errCode ?? "";
  const code = String(rawCode).trim();
  const msg = String(
    header.resultMessage ?? header.result_message ?? header.msg1 ?? header.message ?? header.errMsg ?? "",
  ).trim();

  if (msg && SUCCESS_MSG.test(msg) && !FAIL_MSG.test(msg)) {
    return { ok: true, message: msg, code };
  }
  if (code && SUCCESS_CODE.test(code)) {
    return { ok: true, message: msg || "성공", code };
  }
  if (FAIL_MSG.test(msg)) {
    return { ok: false, message: msg, code };
  }
  if (!code) {
    return { ok: true, message: msg, code: "" };
  }
  return { ok: false, message: msg || `resultCode=${code}`, code };
}

export const CODE_KEYS = [
  "shrt_cd",
  "is_cd",
  "stnd_is_cd",
  "stk_cd",
  "isu_cd",
  "mksc_shrn_iscd",
  "stck_shrn_iscd",
  "code",
  "isuSrtCd",
  "isuCd",
  "shrtCd",
  "stkCd",
  "stockCode",
  "shcode",
  "jmcode",
  "xcode",
];
export const NAME_KEYS = [
  "is_nm",
  "kor_is_nm",
  "hts_kor_isnm",
  "isu_nm",
  "stk_nm",
  "name",
  "hngl_is_nm",
  "isuNm",
  "korIsNm",
  "htsKorIsnm",
  "hnglIsNm",
  "issueName",
  "isu_abbrv",
];
export const PRICE_KEYS = [
  "now_prc",
  "cur_prc",
  "stck_prpr",
  "clsn_prc",
  "last_prc",
  "prc",
  "close_prc",
  "nowPrc",
  "curPrc",
  "trdPrc",
  "prpr",
  "closePrc",
  "cls_prc_p2",
];
export const OPEN_KEYS = ["opn_prc", "open_prc", "stck_oprc", "oprc", "open", "openPrc", "opn_prc_p2"];
export const HIGH_KEYS = ["hgh_prc", "hg_prc", "stck_hgpr", "hgpr", "high", "high_prc", "hgPrc", "hgh_prc_p2"];
export const LOW_KEYS = ["lw_prc", "stck_lwpr", "lwpr", "low", "low_prc", "lwPrc", "lw_prc_p2"];
export const PREV_KEYS = ["bdy_cls_prc", "bdy_clsn_prc", "stck_sdpr", "prev_prc", "base_prc", "prdy_clpr", "sprc"];
export const CHG_KEYS = [
  "up_dwn_r_p2",
  "fluc_rt",
  "chg_rt",
  "prdy_ctrt",
  "updn_rt",
  "fluct_rt",
  "chg_pct",
  "flucRt",
  "chgRt",
  "updnRt",
  "diffRate",
  "rate",
];
export const VOL_KEYS = [
  "vlm",
  "acml_vlm",
  "acml_vol",
  "trd_qty",
  "acc_trd_qty",
  "vol",
  "acml_qty",
  "accTrdvol",
  "trdQty",
  "bdy_vlm",
];
export const TV_KEYS = [
  "dl_tw_amt",
  "bdy_dl_tw_amt",
  "acml_dl_tw_amt",
  "acml_tr_amt",
  "acml_tr_pbmn",
  "trd_amt",
  "acc_trd_amt",
  "tr_pbmn",
  "trd_pbmn",
  "accTrdval",
  "trdval",
  "trdVal",
  "deal_amt",
];
export const RANK_KEYS = ["rnk", "data_rank", "rank", "seq", "dataRank", "rankNo", "bdy_rnk"];
export const DATE_KEYS = ["dt", "trd_dt", "bsop_date", "stck_bsop_date", "date", "trd_dd", "deal_date"];
export const CLOSE_KEYS = ["cls_prc_p2", "clsn_prc", "stck_clpr", "clpr", "close", "now_prc", "closePrc"];
