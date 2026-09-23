import { useMemo, useState } from "react";
import { Antenna, ChevronDown, Cpu, Factory, Fuel, Radar, Shield, Sparkles, Wifi } from "lucide-react";
import type { BoardStock, NewsItem, ThemeCard } from "@/lib/scanner/types";
import { buildThemeCards } from "@/lib/scanner/themes";
import { Dialog, DialogContent, DialogDesc, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { PriceChart, SupplyChart } from "@/components/scanner/mini-charts";
import { cn, fmtPct } from "@/lib/utils";

type SortKey = "change" | "prev" | "value";

const ICONS: Record<string, typeof Wifi> = {
  "5g": Wifi,
  defense: Shield,
  "semi-eqp": Cpu,
  "semi-mat": Factory,
  auto: Radar,
  sofc: Fuel,
  ai: Sparkles,
  robot: Antenna,
};

function fmtEok(v: number | null): string {
  if (v == null) return "—";
  return Math.round(v).toLocaleString("ko-KR");
}

function tonePct(v: number | null): string {
  if (v == null) return "text-fg-muted";
  if (v > 0) return "text-up";
  if (v < 0) return "text-down";
  return "text-fg-muted";
}

function rsClass(rs: number | null): string {
  if (rs == null) return "text-fg-muted";
  if (rs >= 80) return "text-warn";
  return "text-fg";
}

export function ThemeBoard({
  rows,
  fetchedLabel,
  headlines = [],
}: {
  rows: BoardStock[];
  fetchedLabel?: string;
  headlines?: NewsItem[];
}) {
  const [sort, setSort] = useState<SortKey>("change");
  const [themeN, setThemeN] = useState(4);
  const [open, setOpen] = useState<BoardStock | null>(null);

  const cards = useMemo(() => buildThemeCards(rows, sort, themeN), [rows, sort, themeN]);

  if (!rows.length) {
    return (
      <div className="rounded-xl bg-bg-elevated p-8 text-sm text-fg-muted shadow-[var(--shadow-card)]">
        자동스캔 결과가 없습니다. 유니버스(A∪B∪C, ETF·관리·신규상장 제외)를 스캔하면 테마별로 모입니다.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              ["change", "등락률순"],
              ["prev", "전일비순"],
              ["value", "거래대금순"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setSort(k)}
              className={cn(
                "h-10 min-w-11 rounded-full px-4 text-sm font-medium transition-colors",
                sort === k ? "bg-accent text-accent-fg" : "bg-bg-elevated text-fg-muted shadow-[var(--shadow-border)]",
              )}
            >
              {label}
            </button>
          ))}
          <label className="ml-1 inline-flex h-10 items-center gap-2 rounded-full bg-bg-elevated px-3 text-sm text-fg-muted shadow-[var(--shadow-border)]">
            테마당
            <select
              className="bg-transparent text-fg outline-none"
              value={themeN}
              onChange={(e) => setThemeN(Number(e.target.value))}
            >
              {[4, 6, 8].map((n) => (
                <option key={n} value={n}>
                  {n}개
                </option>
              ))}
            </select>
            <ChevronDown className="size-3.5" />
          </label>
        </div>
        <div className="text-right text-xs text-fg-subtle">
          <p className="text-down">1분 자동 갱신</p>
          {fetchedLabel ? <p>기준: {fetchedLabel}</p> : null}
        </div>
      </div>

      <div className="flex flex-wrap gap-3 text-[11px] text-fg-subtle">
        <span className="inline-flex items-center gap-1.5">
          <i className="size-2 rounded-sm bg-warn/40" /> 역사적 신고가
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="size-2 rounded-sm bg-up/30" /> 52주 신고가
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="size-2 rounded-sm bg-up" /> 상한가
        </span>
      </div>

      {headlines.length ? (
        <ul className="grid gap-2 md:grid-cols-2">
          {headlines.slice(0, 4).map((n) => (
            <li key={n.title} className="truncate rounded-lg bg-bg-elevated px-3 py-2 text-sm shadow-[var(--shadow-border)]">
              <span className="text-fg-subtle">{n.source} · </span>
              {n.title}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {cards.map((card) => (
          <ThemeCardView key={card.id} card={card} onOpen={setOpen} />
        ))}
      </div>

      <Dialog open={Boolean(open)} onOpenChange={(v) => !v && setOpen(null)}>
        <DialogContent className="max-w-2xl">
          {open ? <StockDetail stock={open} /> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ThemeCardView({ card, onOpen }: { card: ThemeCard; onOpen: (s: BoardStock) => void }) {
  const Icon = ICONS[card.id] ?? Sparkles;
  return (
    <article className="rounded-xl bg-bg-elevated p-4 shadow-[var(--shadow-card)] sm:p-5">
      <header className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex size-7 items-center justify-center rounded-md bg-accent text-xs font-semibold text-accent-fg">
            {card.rank ?? 0}
          </span>
          <h3 className="text-base font-semibold tracking-tight">{card.name}</h3>
          <Icon className="size-4 text-fg-subtle" />
        </div>
        <p className={cn("tabular text-sm font-semibold", tonePct(card.avgChangePct))}>
          {fmtPct(card.avgChangePct, 1)}
        </p>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[28rem] text-left text-sm">
          <thead>
            <tr className="text-[11px] text-fg-subtle">
              <th className="pb-2 font-medium">종목명</th>
              <th className="pb-2 text-right font-medium">등락률</th>
              <th className="pb-2 text-right font-medium">RS</th>
              <th className="pb-2 text-right font-medium">신고가</th>
              <th className="pb-2 text-right font-medium">대금(억)</th>
              <th className="pb-2 text-right font-medium">전일비</th>
            </tr>
          </thead>
          <tbody>
            {card.stocks.map((s) => (
              <tr
                key={s.code}
                className="cursor-pointer border-t border-border/70 transition-colors hover:bg-bg-subtle"
                onClick={() => onOpen(s)}
              >
                <td className="py-2.5 pr-2 font-medium">
                  <span className="inline-flex items-center gap-1.5">
                    {s.name}
                    {s.isLeader ? (
                      <span className="rounded bg-accent px-1 py-0.5 text-[10px] font-medium text-accent-fg">주도</span>
                    ) : null}
                  </span>
                </td>
                <td className="py-2.5 text-right">
                  {s.isLimitUp ? (
                    <span className="inline-flex rounded-md bg-up px-1.5 py-0.5 text-xs font-semibold text-accent-fg tabular">
                      {fmtPct(s.changeRatePct, 1)}
                    </span>
                  ) : (
                    <span className={cn("tabular font-medium", tonePct(s.changeRatePct))}>
                      {fmtPct(s.changeRatePct, 1)}
                    </span>
                  )}
                </td>
                <td className={cn("py-2.5 text-right tabular", rsClass(s.rs))}>{s.rs ?? "—"}</td>
                <td className={cn("py-2.5 text-right tabular", tonePct(s.highVsPeakPct))}>
                  {fmtPct(s.highVsPeakPct, 1)}
                </td>
                <td className="py-2.5 text-right tabular text-fg">{fmtEok(s.tradingValueEok)}</td>
                <td className={cn("py-2.5 text-right tabular", tonePct(s.prevVolPct))}>
                  {s.prevVolPct == null ? "—" : `${Math.round(s.prevVolPct)}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}

function StockDetail({ stock }: { stock: BoardStock }) {
  const primary = stock.cases[0];
  return (
    <>
      <DialogTitle className="pr-10">
        {stock.name}{" "}
        <span className="font-mono text-sm font-normal text-fg-subtle">{stock.code}</span>
      </DialogTitle>
      <DialogDesc>
        {stock.themeName} · {fmtPct(stock.changeRatePct)} · 대금 {fmtEok(stock.tradingValueEok)}억
      </DialogDesc>

      <dl className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
        <Stat label="현재가" value={stock.currentPrice != null ? `${stock.currentPrice.toLocaleString("ko-KR")}원` : "미확보"} />
        <Stat label="RS" value={stock.rs != null ? String(stock.rs) : "미확보"} />
        <Stat label="신고가 대비" value={fmtPct(stock.highVsPeakPct, 1)} />
        <Stat label="목표가" value={stock.targetPrice != null ? `${stock.targetPrice.toLocaleString("ko-KR")}원` : "미산출"} />
        <Stat label="이탈가" value={stock.stopLoss != null ? `${stock.stopLoss.toLocaleString("ko-KR")}원` : "미산출"} />
        <Stat label="전일 거래량비" value={stock.prevVolPct == null ? "미확보" : `${Math.round(stock.prevVolPct)}%`} />
      </dl>

      <h4 className="mt-5 text-sm font-semibold">근시일 차트</h4>
      <PriceChart bars={stock.bars} />

      <h4 className="mt-5 text-sm font-semibold">수급 (외인 / 기관 / 개인)</h4>
      <SupplyChart rows={stock.supply} />

      <p className="mt-3 text-sm text-fg-muted">{stock.supplyDemandNote}</p>

      <h4 className="mt-5 text-sm font-semibold">CASE 판단근거</h4>
      {stock.cases.length === 0 ? (
        <p className="mt-2 text-sm text-fg-muted">매수 판정 CASE가 없습니다. 관망이며 숫자를 지어내지 않습니다.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-3">
          {stock.cases.map((c) => (
            <li key={c.caseId} className="rounded-md bg-bg-subtle p-3">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <Badge tone={c.verdict === "적극매수" ? "up" : "info"}>
                  CASE {c.caseId} · {c.verdict}
                </Badge>
                <span className="text-xs text-fg-subtle">{c.probabilityLabel}</span>
              </div>
              <p className="text-sm font-medium">{c.caseTitle}</p>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-fg-muted">
                {c.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              {c.warnings.length ? (
                <p className="mt-2 text-xs text-warn">{c.warnings.join(" · ")}</p>
              ) : null}
              <p className="mt-2 text-xs text-fg-subtle">
                {c.actionTiming} · {c.targetBasis}
              </p>
            </li>
          ))}
        </ul>
      )}

      {stock.closingReasons.length ? (
        <>
          <h4 className="mt-5 text-sm font-semibold">종가베팅 통과 조건</h4>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-fg-muted">
            {stock.closingReasons.slice(0, 8).map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </>
      ) : null}

      {stock.newsTitles.length ? (
        <>
          <h4 className="mt-5 text-sm font-semibold">최근 뉴스</h4>
          <ul className="mt-2 space-y-1 text-sm text-fg-muted">
            {stock.newsTitles.slice(0, 5).map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </>
      ) : null}

      {primary ? (
        <p className="mt-4 text-[11px] text-fg-subtle">신뢰도 {primary.dataConfidence}. 매매 책임은 사용자에게 있습니다.</p>
      ) : null}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-bg-subtle px-3 py-2">
      <p className="text-[11px] text-fg-subtle">{label}</p>
      <p className="tabular text-sm font-medium">{value}</p>
    </div>
  );
}
