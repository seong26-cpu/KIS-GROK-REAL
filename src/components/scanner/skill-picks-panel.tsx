import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardDesc, CardHeader, CardTitle } from "@/components/ui/card";
import { AnalysisPanel, MarketPanel } from "@/components/scanner/extra-menus";
import type { BrokerCreds } from "@/lib/scanner/types";
import { SKILL_PROMPTS, SKILL_STEPS, type SkillPicksResult } from "@/lib/scanner/skill-picks";
import { fmtPct, fmtWon } from "@/lib/utils";

export function SkillPicksPanel({
  creds,
  loading,
  error,
  onRun,
  result,
  onPick,
}: {
  creds: BrokerCreds | null;
  loading: boolean;
  error: string | null;
  onRun: (q: string) => Promise<void>;
  result: SkillPicksResult | null;
  onPick?: (code: string, name: string) => void;
}) {
  const [q, setQ] = useState("저가매수 후보를 조건이 겹치는 종목만 골라줘. 고점 근처는 빼.");
  const reports = result?.reports?.length ? result.reports : result?.report ? [result.report] : [];
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">분석 STOCK</h2>
        <p className="mt-1 text-sm text-fg-muted">
          korean-stock-picks 절차입니다. 저가 추천, 종목 분석, 9.21 시황은 예시이고, 칸에 적은 질문대로 시세·뉴스·컨센서스를 붙입니다.
          없는 목표가나 확률은 만들지 않습니다.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {SKILL_PROMPTS.map((p) => (
          <button
            key={p.label}
            type="button"
            className="rounded-md border border-border bg-bg-elevated px-3 py-1.5 text-xs hover:bg-bg-subtle"
            onClick={() => {
              setQ(p.query);
              void onRun(p.query);
            }}
          >
            {p.label}
          </button>
        ))}
      </div>
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void onRun(q);
        }}
      >
        <textarea
          value={q}
          onChange={(e) => setQ(e.target.value)}
          rows={4}
          placeholder="예: 2026-09-21 코스피 시황 / 000660 손절과 저항 / 조선주 저가 후보"
          className="w-full rounded-md border border-border bg-bg-elevated px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent"
        />
        <div className="flex items-center gap-2">
          <Button type="submit" disabled={loading || !creds || !q.trim()}>
            {loading ? "분석 중…" : "분석 STOCK 실행"}
          </Button>
          {!creds ? <span className="text-xs text-fg-subtle">KIS 키가 있어야 시세를 붙입니다.</span> : null}
        </div>
      </form>
      {error ? <p className="text-sm text-down">{error}</p> : null}
      {result ? (
        <Card>
          <CardHeader>
            <CardTitle>분석 STOCK</CardTitle>
            <CardDesc>
              {result.mode} · {result.asOf ? `기준 ${result.asOf}` : "최신"} · korean-stock-picks
            </CardDesc>
          </CardHeader>
          <ol className="mb-3 list-decimal pl-5 text-xs text-fg-subtle">
            {SKILL_STEPS.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-fg-muted">{result.body}</p>
          {result.cheap?.length ? (
            <ul className="mt-3 space-y-2 text-sm">
              {result.cheap.map((r) => (
                <li key={`${r.code}-${r.note.slice(0, 24)}`} className="rounded-md bg-bg-subtle px-3 py-2">
                  <button type="button" className="text-left hover:underline" onClick={() => onPick?.(r.code, r.name)}>
                    <span className="font-medium">{r.name}</span>{" "}
                    <span className="font-mono text-fg-subtle">{r.code}</span>
                  </button>{" "}
                  {fmtWon(r.price)} {r.changePct == null ? "" : fmtPct(r.changePct)}
                  <p className="text-xs text-fg-muted">{r.note}</p>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="mt-3 text-[11px] text-fg-subtle">참고 자료이며 매수 권유가 아닙니다. 투자 손실은 사용자 책임입니다.</p>
        </Card>
      ) : (
        <Card>
          <p className="text-sm text-fg-muted">왼쪽에서 분석 STOCK을 연 뒤, 예시를 누르거나 질문을 적으면 이 자리에 결과가 나옵니다.</p>
        </Card>
      )}
      {result?.market ? <MarketPanel brief={result.market} onPick={onPick} /> : null}
      {reports.map((report) => (
        <AnalysisPanel key={report.stockCode} report={report} onPick={onPick} />
      ))}
    </section>
  );
}
