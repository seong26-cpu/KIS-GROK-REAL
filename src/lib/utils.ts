import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function fmtWon(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "미확보";
  return `${Math.round(v).toLocaleString("ko-KR")}원`;
}

export function fmtPct(v: number | null | undefined, digits = 2): string {
  if (v == null || Number.isNaN(v)) return "미확보";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(digits)}%`;
}

export function fmtCompactWon(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "—";
  const abs = Math.abs(v);
  if (abs >= 100_000_000_000) return `${(v / 100_000_000_000).toFixed(1)}천억`;
  if (abs >= 100_000_000) return `${(v / 100_000_000).toFixed(1)}억`;
  if (abs >= 10_000) return `${(v / 10_000).toFixed(0)}만`;
  return Math.round(v).toLocaleString("ko-KR");
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
