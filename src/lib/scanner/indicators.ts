import type { DailyBar, InvestorRow } from "./types";

export function toNum(val: unknown): number | null {
  if (val == null || val === "") return null;
  const n = typeof val === "number" ? val : Number(String(val).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function computeMa(daily: DailyBar[], window: number): number | null {
  const closes: number[] = [];
  for (const row of daily.slice(0, window)) {
    const c = toNum(row.stck_clpr);
    if (c == null) continue;
    closes.push(c);
  }
  if (closes.length < window) return null;
  return closes.slice(0, window).reduce((a, b) => a + b, 0) / window;
}

export function computeHighLow(
  daily: DailyBar[],
  window: number,
): [number | null, number | null] {
  const highs: number[] = [];
  const lows: number[] = [];
  for (const row of daily.slice(0, window)) {
    const h = toNum(row.stck_hgpr);
    const l = toNum(row.stck_lwpr);
    if (h != null) highs.push(h);
    if (l != null) lows.push(l);
  }
  if (!highs.length || !lows.length) return [null, null];
  return [Math.max(...highs), Math.min(...lows)];
}

export function computeRsi(daily: DailyBar[] | null, period = 14): number | null {
  if (!daily || daily.length < period + 1) return null;
  const closes: number[] = [];
  for (const row of daily.slice(0, period + 1)) {
    const c = toNum(row.stck_clpr);
    if (c == null) return null;
    closes.push(c);
  }
  const ordered = [...closes].reverse();
  const gains: number[] = [];
  const losses: number[] = [];
  for (let i = 1; i < ordered.length; i++) {
    const diff = ordered[i]! - ordered[i - 1]!;
    gains.push(Math.max(diff, 0));
    losses.push(Math.max(-diff, 0));
  }
  const avgGain = gains.reduce((a, b) => a + b, 0) / period;
  const avgLoss = losses.reduce((a, b) => a + b, 0) / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return Math.round((100 - 100 / (1 + rs)) * 10) / 10;
}

export function computeAtr(daily: DailyBar[] | null, period = 14): number | null {
  if (!daily || daily.length < period + 1) return null;
  const rows = daily.slice(0, period + 1);
  const trueRanges: number[] = [];
  try {
    for (let i = 0; i < rows.length - 1; i++) {
      const high = toNum(rows[i]!.stck_hgpr);
      const low = toNum(rows[i]!.stck_lwpr);
      const prevClose = toNum(rows[i + 1]!.stck_clpr);
      if (high == null || low == null || prevClose == null) return null;
      trueRanges.push(
        Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)),
      );
    }
  } catch {
    return null;
  }
  if (!trueRanges.length) return null;
  return Math.round((trueRanges.reduce((a, b) => a + b, 0) / trueRanges.length) * 10) / 10;
}

export function computeMacd(daily: DailyBar[] | null): {
  macd: number;
  signal: number;
  goldenCross: boolean;
  deadCross: boolean;
} | null {
  if (!daily || daily.length < 35) return null;
  const closes: number[] = [];
  for (const row of [...daily].reverse()) {
    const c = toNum(row.stck_clpr);
    if (c != null) closes.push(c);
  }
  if (closes.length < 35) return null;
  const ema = (period: number, arr: number[]) => {
    const k = 2 / (period + 1);
    let prev = arr.slice(0, period).reduce((a, b) => a + b, 0) / period;
    const out: number[] = [prev];
    for (let i = period; i < arr.length; i++) {
      prev = arr[i]! * k + prev * (1 - k);
      out.push(prev);
    }
    return out;
  };
  const ema12 = ema(12, closes);
  const ema26 = ema(26, closes);
  const offset = ema12.length - ema26.length;
  const macdLine: number[] = ema26.map((v, i) => ema12[i + offset]! - v);
  if (macdLine.length < 9) return null;
  const sig = ema(9, macdLine);
  const macd = macdLine[macdLine.length - 1]!;
  const signal = sig[sig.length - 1]!;
  const prevM = macdLine[macdLine.length - 2]!;
  const prevS = sig[sig.length - 2]!;
  return {
    macd: Math.round(macd * 100) / 100,
    signal: Math.round(signal * 100) / 100,
    goldenCross: prevM <= prevS && macd > signal,
    deadCross: prevM >= prevS && macd < signal,
  };
}

export function countConsecutiveNetBuyDays(
  rows: InvestorRow[] | null,
  field: string,
): number {
  if (!rows?.length) return 0;
  let count = 0;
  for (const row of rows) {
    const val = toNum(row[field]);
    if (val == null) break;
    if (val > 0) count += 1;
    else break;
  }
  return count;
}

export function kstNow(): Date {
  return new Date(Date.now() + 9 * 60 * 60 * 1000);
}

export function ymdKst(offsetDays = 0): string {
  const d = kstNow();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

export function marketHoursNote(): {
  available: boolean;
  serverTimeKst: string;
  isWeekday: boolean;
  likelyRegularSession: boolean;
  note: string;
} {
  const now = kstNow();
  const weekday = now.getUTCDay();
  const isWeekday = weekday >= 1 && weekday <= 5;
  const hm = now.getUTCHours() * 60 + now.getUTCMinutes();
  const inSession = hm >= 9 * 60 && hm <= 15 * 60 + 30;
  const likely = isWeekday && inSession;
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const stamp = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")} ${String(now.getUTCHours()).padStart(2, "0")}:${String(now.getUTCMinutes()).padStart(2, "0")}:${String(now.getUTCSeconds()).padStart(2, "0")} (${days[weekday]})`;
  return {
    available: true,
    serverTimeKst: stamp,
    isWeekday,
    likelyRegularSession: likely,
    note: likely
      ? "평일 09:00~15:30(추정, 공휴일 미반영) 기준으로는 정규장 시간대로 보입니다."
      : "평일 09:00~15:30(추정, 공휴일 미반영) 기준으로는 정규장 시간대가 아닌 것으로 보입니다. 시각만으로 판단한 추정치이며 공휴일은 반영하지 않습니다.",
  };
}
