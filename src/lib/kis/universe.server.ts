import type { KisClient, VolumeRankRow } from "./client.server";
import { ymdKst } from "@/lib/scanner/indicators";
import type { RankedStock } from "@/lib/scanner/types";

/** 종가베팅 유동성 하한: 시가총액 1,000억원 (필터 D가 아님 — 참고 표시용) */
export const MIN_MKTCAP_EOK = 1_000;
export const PREV_TV_TOP = 200;
export const AVG5_TV_TOP = 200;
export const TODAY_TV_TOP = 50;

export type UniverseStock = RankedStock & {
  prevTvRank: number | null;
  avg5TvRank: number | null;
  todayTvRank: number | null;
  marketCapEok: number | null;
  listedShares: number | null;
  avgTradingValue: number | null;
  leaderScore: number;
  filterNotes: string[];
  inA: boolean;
  inB: boolean;
  inC: boolean;
};

export type UniverseSnapshot = {
  fetchedAt: string;
  sources: string[];
  notes: string[];
  prevTv: RankedStock[];
  avg5Tv: RankedStock[];
  todayTv: RankedStock[];
  changeRate: RankedStock[];
  selected: UniverseStock[];
  rejectedCap: number;
};

function toRanked(row: VolumeRankRow, source: RankedStock["source"]): RankedStock {
  return {
    code: row.code,
    name: row.name,
    rank: row.rank,
    price: row.price,
    changeRatePct: row.changeRatePct,
    volume: row.volume,
    tradingValue: row.tradingValue,
    tradingValueEstimated: row.tradingValue == null && row.price != null && row.volume != null,
    source,
  };
}

function prevWeekdayYmd(): string {
  for (let i = 1; i <= 5; i++) {
    const ymd = ymdKst(-i);
    const y = Number(ymd.slice(0, 4));
    const m = Number(ymd.slice(4, 6)) - 1;
    const d = Number(ymd.slice(6, 8));
    const dt = new Date(Date.UTC(y, m, d));
    const day = dt.getUTCDay();
    if (day !== 0 && day !== 6) return ymd;
  }
  return ymdKst(-1);
}

type KrxRow = {
  code: string;
  name: string;
  close: number | null;
  tradingValue: number | null;
  marketCapEok: number | null;
  changeRatePct: number | null;
  volume: number | null;
};

async function fetchKrxDay(trdDd: string): Promise<KrxRow[]> {
  const body = new URLSearchParams({
    bld: "dbms/MDC/STAT/standard/MDCSTAT01501",
    locale: "ko_KR",
    mktId: "ALL",
    trdDd,
    share: "1",
    money: "1",
    csvxls_isNo: "false",
  });
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 9000);
  try {
    const resp = await fetch("https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        accept: "application/json,text/plain,*/*",
        "user-agent": "Mozilla/5.0",
        referer: "https://data.krx.co.kr/contents/MDC/MDI/mdiLoader/index.cmd?menuId=MDC0201020101",
      },
      body,
      signal: ctrl.signal,
    });
    if (!resp.ok) return [];
    const json = (await resp.json()) as { OutBlock_1?: Record<string, unknown>[]; output?: Record<string, unknown>[] };
    const rows = json.OutBlock_1 ?? json.output ?? [];
    return rows
      .map((r) => {
        const code = String(r.ISU_SRT_CD ?? r.ISU_CD ?? "").replace(/^A/, "").padStart(6, "0");
        const tv = num(r.ACC_TRDVAL);
        const cap = num(r.MKTCAP);
        return {
          code,
          name: String(r.ISU_ABBRV ?? r.ISU_NM ?? "").trim(),
          close: num(r.TDD_CLSPRC),
          tradingValue: tv,
          marketCapEok: cap != null ? cap / 100_000_000 : null,
          changeRatePct: num(r.FLUC_RT),
          volume: num(r.ACC_TRDVOL),
        } satisfies KrxRow;
      })
      .filter((r) => /^\d{6}$/.test(r.code));
  } catch {
    return [];
  } finally {
    clearTimeout(t);
  }
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function rankByTv(rows: KrxRow[], top: number): RankedStock[] {
  return [...rows]
    .filter((r) => r.tradingValue != null && r.tradingValue > 0)
    .sort((a, b) => (b.tradingValue ?? 0) - (a.tradingValue ?? 0))
    .slice(0, top)
    .map((r, i) => ({
      code: r.code,
      name: r.name,
      rank: i + 1,
      price: r.close,
      changeRatePct: r.changeRatePct,
      volume: r.volume,
      tradingValue: r.tradingValue,
      tradingValueEstimated: false,
      source: "trading_value" as const,
    }));
}

export function scoreLeader(opts: {
  todayTvRank: number | null;
  changeRatePct: number | null;
  changeRateRank: number | null;
  indexChangePct: number | null;
}): number {
  let s = 0;
  if (opts.todayTvRank != null && opts.todayTvRank <= 5) s += 4;
  else if (opts.todayTvRank != null && opts.todayTvRank <= 15) s += 2;
  else if (opts.todayTvRank != null && opts.todayTvRank <= 30) s += 1;
  if (opts.changeRateRank != null && opts.changeRateRank <= 10 && (opts.changeRatePct ?? 0) > 0) s += 2;
  if (opts.changeRatePct != null && opts.indexChangePct != null) {
    if (opts.indexChangePct < 0 && opts.changeRatePct > opts.indexChangePct) s += 1;
    if (opts.indexChangePct > 0 && opts.changeRatePct > opts.indexChangePct) s += 1;
  }
  return s;
}

export async function buildUniverse(
  client: KisClient,
  indexChangePct: number | null,
  todayTop = TODAY_TV_TOP,
): Promise<UniverseSnapshot> {
  const notes: string[] = [];
  const sources: string[] = [];
  const yday = prevWeekdayYmd();

  const [todayKis, avgKis, ydayKis, chgKis] = await Promise.allSettled([
    client.getVolumeRank("3"),
    client.getVolumeRank("0"),
    client.getVolumeRank("3", yday),
    client.getFluctuationRank(),
  ]);

  const todayRows = todayKis.status === "fulfilled" ? todayKis.value : [];
  const avgRows = avgKis.status === "fulfilled" ? avgKis.value : [];
  const ydayRows = ydayKis.status === "fulfilled" ? ydayKis.value : [];
  const chgRows = chgKis.status === "fulfilled" ? chgKis.value : [];

  if (todayKis.status === "rejected") notes.push(`KIS 당일 거래대금순위: ${todayKis.reason}`);
  else sources.push(`KIS 거래금액순 ${todayRows.length}건`);
  if (avgKis.status === "rejected") notes.push(`KIS 평균거래량순위: ${avgKis.reason}`);
  else sources.push(`KIS 평균거래량(평균거래대금 필드) ${avgRows.length}건`);
  if (ydayKis.status === "rejected") notes.push(`KIS 전일(${yday}) 거래대금순위: ${ydayKis.reason}`);
  else if (ydayRows.length) sources.push(`KIS 전일 거래금액순 ${ydayRows.length}건`);
  if (chgKis.status === "fulfilled") sources.push(`KIS 등락률순위 ${chgRows.length}건`);

  const [krxToday, krxYday, krx2, krx3, krx4] = await Promise.all([
    fetchKrxDay(ymdKst(0)),
    fetchKrxDay(yday),
    fetchKrxDay(ymdKst(-2)),
    fetchKrxDay(ymdKst(-3)),
    fetchKrxDay(ymdKst(-4)),
  ]);
  if (krxToday.length) sources.push(`KRX 당일 전종목 ${krxToday.length}건`);
  if (krxYday.length) sources.push(`KRX 전일 전종목 ${krxYday.length}건`);

  const todayTv = mergeRanked(
    rankByTv(krxToday, Math.max(todayTop, 80)),
    todayRows.map((r) => toRanked(r, "trading_value")),
    todayTop,
  );
  const prevTv = mergeRanked(
    rankByTv(krxYday.length ? krxYday : krxToday, PREV_TV_TOP),
    ydayRows.map((r) => toRanked(r, "trading_value")),
    PREV_TV_TOP,
  );

  const avgMap = new Map<string, number>();
  for (const day of [krxToday, krxYday, krx2, krx3, krx4]) {
    for (const r of day) {
      if (r.tradingValue == null) continue;
      avgMap.set(r.code, (avgMap.get(r.code) ?? 0) + r.tradingValue);
    }
  }
  const dayCount = [krxToday, krxYday, krx2, krx3, krx4].filter((d) => d.length).length || 1;
  const avgFromKrx: RankedStock[] = [...avgMap.entries()]
    .map(([code, sum]) => {
      const sample = krxToday.find((r) => r.code === code) ?? krxYday.find((r) => r.code === code);
      return {
        code,
        name: sample?.name ?? code,
        rank: 0,
        price: sample?.close ?? null,
        changeRatePct: sample?.changeRatePct ?? null,
        volume: sample?.volume ?? null,
        tradingValue: sum / dayCount,
        tradingValueEstimated: false,
        source: "trading_value" as const,
      };
    })
    .sort((a, b) => (b.tradingValue ?? 0) - (a.tradingValue ?? 0))
    .map((r, i) => ({ ...r, rank: i + 1 }))
    .slice(0, AVG5_TV_TOP);

  const avgFromKis: RankedStock[] = [...avgRows]
    .sort((a, b) => (b.avgTradingValue ?? b.tradingValue ?? 0) - (a.avgTradingValue ?? a.tradingValue ?? 0))
    .map((r, i) => ({ ...toRanked(r, "trading_value"), rank: i + 1, tradingValue: r.avgTradingValue ?? r.tradingValue }));

  const avg5Tv = mergeRanked(avgFromKrx, avgFromKis, AVG5_TV_TOP);

  const changeRate = chgRows.slice(0, 30).map((r) => toRanked(r, "change_rate"));

  const capByCode = new Map<string, number>();
  for (const r of krxToday) {
    if (r.marketCapEok != null) capByCode.set(r.code, r.marketCapEok);
  }

  const aSet = new Set(prevTv.map((r) => r.code));
  const bSet = new Set(avg5Tv.map((r) => r.code));
  const cSet = new Set(todayTv.map((r) => r.code));
  const crRank = new Map(changeRate.map((r) => [r.code, r.rank]));

  const pool = new Map<string, RankedStock>();
  for (const r of [...todayTv, ...prevTv, ...avg5Tv, ...changeRate]) {
    if (!pool.has(r.code)) pool.set(r.code, r);
    else {
      const prev = pool.get(r.code)!;
      pool.set(r.code, { ...prev, name: prev.name || r.name, tradingValue: prev.tradingValue ?? r.tradingValue });
    }
  }

  const selected: UniverseStock[] = [];
  for (const [code, base] of pool) {
    const inA = aSet.has(code);
    const inB = bSet.has(code);
    const inC = cSet.has(code);
    const cap = capByCode.get(code) ?? null;
    if (!(inA && inB && inC)) continue;
    const todayTvRank = todayTv.find((r) => r.code === code)?.rank ?? null;
    const leaderScore = scoreLeader({
      todayTvRank,
      changeRatePct: base.changeRatePct,
      changeRateRank: crRank.get(code) ?? null,
      indexChangePct,
    });
    const kisToday = todayRows.find((r) => r.code === code);
    selected.push({
      ...base,
      source: crRank.has(code) ? "both" : "trading_value",
      prevTvRank: prevTv.find((r) => r.code === code)?.rank ?? null,
      avg5TvRank: avg5Tv.find((r) => r.code === code)?.rank ?? null,
      todayTvRank,
      marketCapEok: cap,
      listedShares: kisToday?.listedShares ?? null,
      avgTradingValue: avg5Tv.find((r) => r.code === code)?.tradingValue ?? kisToday?.avgTradingValue ?? null,
      leaderScore,
      filterNotes: [
        `A 전일대금 ${prevTv.find((r) => r.code === code)?.rank ?? "-"}위`,
        `B 5일평균대금 ${avg5Tv.find((r) => r.code === code)?.rank ?? "-"}위`,
        `C 당일대금 ${todayTvRank ?? "-"}위`,
        cap != null ? `시총 ${Math.round(cap).toLocaleString("ko-KR")}억원` : "시총 미확보",
      ],
      inA,
      inB,
      inC,
    });
  }

  selected.sort((a, b) => {
    const ds = b.leaderScore - a.leaderScore;
    if (ds) return ds;
    const dt = (a.todayTvRank ?? 99) - (b.todayTvRank ?? 99);
    if (dt) return dt;
    return a.code.localeCompare(b.code);
  });

  if (!todayTv.length && !prevTv.length) {
    notes.push("거래대금 순위를 확보하지 못했습니다. KIS 실전 키와 시세조회 권한을 확인하세요.");
  } else if (!selected.length) {
    notes.push(
      `A∩B∩C 교집합이 비었습니다. 전일 ${prevTv.length} · 5일평균 ${avg5Tv.length} · 당일 ${todayTv.length}. 숫자를 지어내지 않습니다.`,
    );
  } else {
    notes.push(
      `A∩B∩C = ${selected.length}종목 (전일상위${PREV_TV_TOP} ∩ 5일평균상위${AVG5_TV_TOP} ∩ 당일상위${todayTop}). 시총 상한(D)은 적용하지 않습니다. 주도주 점수 순.`,
    );
  }

  return {
    fetchedAt: new Date().toISOString(),
    sources,
    notes,
    prevTv,
    avg5Tv,
    todayTv,
    changeRate,
    selected,
    rejectedCap: 0,
  };
}

function mergeRanked(primary: RankedStock[], secondary: RankedStock[], top: number): RankedStock[] {
  if (primary.length >= Math.min(top, 30)) {
    const extra = secondary.filter((s) => !primary.some((p) => p.code === s.code));
    return [...primary, ...extra].slice(0, top);
  }
  const map = new Map<string, RankedStock>();
  for (const r of [...primary, ...secondary]) {
    if (!map.has(r.code)) map.set(r.code, r);
  }
  return [...map.values()]
    .sort((a, b) => (b.tradingValue ?? 0) - (a.tradingValue ?? 0))
    .map((r, i) => ({ ...r, rank: i + 1 }))
    .slice(0, top);
}
