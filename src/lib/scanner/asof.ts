import { computeHighLow, computeMa, toNum } from "./indicators";
import type { DailyBar, LiveSnapshot } from "./types";

export type NextDay = {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  changePct: number | null;
};

export type HourBar = {
  hour: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
};

export type MinuteBar = {
  time: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
};

export function ymdOnly(input: string | undefined | null): string {
  const d = String(input ?? "").replace(/\D/g, "").slice(0, 8);
  return /^\d{8}$/.test(d) ? d : "";
}

export function barYmd(bar: DailyBar): string {
  return ymdOnly(String(bar.date ?? ""));
}

export function splitDaily(daily: DailyBar[], asOf: string): { known: DailyBar[]; next: NextDay | null } {
  const ymd = ymdOnly(asOf);
  const dated = daily
    .map((b) => ({ b, d: barYmd(b) }))
    .filter((x) => x.d);
  const known = dated.filter((x) => x.d <= ymd).map((x) => x.b);
  const nxt = dated
    .filter((x) => x.d > ymd)
    .sort((a, b) => a.d.localeCompare(b.d))[0];
  if (!nxt) return { known, next: null };
  const base = toNum(known[0]?.stck_clpr);
  const close = toNum(nxt.b.stck_clpr);
  return {
    known,
    next: {
      date: nxt.d,
      open: toNum(nxt.b.stck_oprc),
      high: toNum(nxt.b.stck_hgpr),
      low: toNum(nxt.b.stck_lwpr),
      close,
      changePct: base != null && close != null && base !== 0 ? Math.round(((close - base) / base) * 1000) / 10 : null,
    },
  };
}

export function verifyLine(baseClose: number | null, next: NextDay | null, stop: number | null): string {
  if (!next) return "기준일 다음 거래일이 받아 온 일봉에 없습니다.";
  const pct = next.changePct == null ? "등락 계산 불가" : `${next.changePct >= 0 ? "+" : ""}${next.changePct}%`;
  const held =
    baseClose != null && next.low != null
      ? next.low < baseClose
        ? "다음날 저가가 기준 가격보다 낮습니다."
        : "다음날 저가가 기준 가격을 밑돌지 않았습니다."
      : "";
  const stopNote =
    stop != null && next.low != null ? (next.low < stop ? " 다음날 저가가 손절가 아래입니다." : " 다음날 저가가 손절가 위입니다.") : "";
  return `다음 거래일 ${next.date} 시가 ${next.open ?? "—"} 고가 ${next.high ?? "—"} 저가 ${next.low ?? "—"} 종가 ${next.close ?? "—"} (${pct}). ${held}${stopNote}`.trim();
}

export function readMinuteRows(rows: Record<string, unknown>[]): MinuteBar[] {
  return rows
    .map((r) => ({
      time: String(r.stck_cntg_hour ?? "").replace(/\D/g, ""),
      open: toNum(r.stck_oprc),
      high: toNum(r.stck_hgpr),
      low: toNum(r.stck_lwpr),
      close: toNum(r.stck_prpr),
    }))
    .filter((b) => b.close != null && b.time)
    .sort((a, b) => a.time.localeCompare(b.time));
}

export function toHourly(minutes: MinuteBar[]): HourBar[] {
  const hours = new Map<string, MinuteBar[]>();
  for (const b of minutes) {
    const hour = b.time.slice(0, 2);
    const list = hours.get(hour) ?? [];
    list.push(b);
    hours.set(hour, list);
  }
  return [...hours.entries()].map(([hour, list]) => {
    const highs = list.map((b) => b.high).filter((n): n is number => n != null);
    const lows = list.map((b) => b.low).filter((n): n is number => n != null);
    return {
      hour: `${hour}:00`,
      open: list[0]?.open ?? null,
      high: highs.length ? Math.max(...highs) : null,
      low: lows.length ? Math.min(...lows) : null,
      close: list[list.length - 1]?.close ?? null,
    };
  });
}

/** 요청 시각 이전의 마지막 봉. 1분 간격이면 분봉, 더 굵으면 시간봉으로 본다. */
export function priceThrough(minutes: MinuteBar[], hhmmss: string): { price: number | null; via: "분봉" | "시간봉" | "없음" } {
  const hhmm = hhmmss.replace(/\D/g, "").padEnd(6, "0").slice(0, 6);
  const upto = minutes.filter((b) => b.time <= hhmm && b.close != null);
  if (!upto.length) return { price: null, via: "없음" };
  let via: "분봉" | "시간봉" = "분봉";
  if (upto.length >= 2) {
    const gap = Math.abs(Number(upto[upto.length - 1]!.time) - Number(upto[upto.length - 2]!.time));
    if (gap >= 3000) via = "시간봉";
  }
  return { price: upto[upto.length - 1]!.close, via };
}

/** 기준일 이후 봉을 제거하고 지표를 그 날까지만 다시 계산한다. */
export function applyAsOf(
  snap: LiveSnapshot,
  asOf: string | undefined,
  stop: number | null = null,
): { text: string | null; next: NextDay | null } {
  const ymd = ymdOnly(asOf);
  if (!ymd) return { text: null, next: null };
  const { known, next } = splitDaily(snap.dailyPrices, ymd);
  if (!known.length) return { text: `${ymd} 이전 일봉이 없습니다.`, next: null };
  snap.dailyPrices = known;
  const bar = known[0]!;
  const close = toNum(bar.stck_clpr);
  const prev = toNum(known[1]?.stck_clpr);
  snap.currentPrice = close;
  snap.openPrice = toNum(bar.stck_oprc);
  snap.highPrice = toNum(bar.stck_hgpr);
  snap.lowPrice = toNum(bar.stck_lwpr);
  snap.volume = toNum(bar.acml_vol);
  snap.prevClose = prev;
  snap.prevVolume = toNum(known[1]?.acml_vol);
  snap.changeRatePct = close != null && prev != null && prev !== 0 ? ((close - prev) / prev) * 100 : null;
  snap.ma5 = computeMa(known, 5);
  snap.ma10 = computeMa(known, 10);
  snap.ma20 = computeMa(known, 20);
  snap.ma60 = computeMa(known, 60);
  snap.ma120 = computeMa(known, 120);
  const [h20, l20] = computeHighLow(known, 20);
  const [h60, l60] = computeHighLow(known, 60);
  snap.high20d = h20;
  snap.low20d = l20;
  snap.high60d = h60;
  snap.low60d = l60;
  return {
    text: `기준일 ${ymd} 종가 ${close ?? "—"}. ${verifyLine(close, next, stop)}`,
    next,
  };
}
