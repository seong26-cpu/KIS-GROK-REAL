import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardDesc, CardHeader, CardTitle } from "@/components/ui/card";
import { AnalysisPanel, MarketPanel } from "@/components/scanner/extra-menus";
import type { AnalysisReport, BrokerCreds, MarketBrief } from "@/lib/scanner/types";
import { SKILL_PROMPTS, SKILL_STEPS, type SkillPicksResult } from "@/lib/scanner/skill-picks";
import { fmtPct, fmtWon } from "@/lib/utils";

export function SkillPicksPanel({
  creds,
  loading,
  error,
  onRun,
  result,
  report,
  market,
}: {
  creds: BrokerCreds | null;
  loading: boolean;
  error: string | null;
  onRun: (q: string) => Promise<void>;
  result: SkillPicksResult | null;
  report: AnalysisReport | null;
  market: MarketBrief | null;
}) {
  const [q, setQ] = useState("");
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">분석 STOCK</h2>
        <p className="mt-1 text-sm text-fg-muted">
          korean-stock-picks 스킬 환경입니다. 저가 추천·종목 분석·시황은 예시일 뿐이고, 아래 칸에 원하는 분석을
          자유롭게 적으면 됩니다.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {SKILL_PROMPTS.map((p) => (
          <button
            key={p.label}
            type="button"
            className="rounded-md border border-border bg-bg-elevated px-3 py-1.5 text-xs hover:bg-bg-subtle"
            onClick={() => setQ(p.query)}
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
          placeholder="예: 전력기기 중 추격 말고 조정 국면인 곳 / 000660 목표가와 손절 / 오늘 외인 순매수 대형주"
          className="w-full rounded-md border border-border bg-bg-elevated px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent"
        />
        <div className="flex items-center gap-2">
          <Button type="submit" disabled={loading || !creds || !q.trim()}>
            {loading ? "스킬 분석 중…" : "분석 STOCK 실행"}
          </Button>
          {!creds ? <span className="text-xs text-fg-subtle">KIS 키가 있어야 종목 시세를 붙입니다.</span> : null}
        </div>
      </form>
      {error ? <p className="text-sm text-down">{error}</p> : null}

      {result ? (
        <Card>
          <CardHeader>
            <CardTitle>분석 STOCK</CardTitle>
            <CardDesc>
              모드 {result.mode} · korean-stock-picks
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
                <li key={r.code} className="rounded-md bg-bg-subtle px-3 py-2">
                  <span className="font-medium">{r.name}</span>{" "}
                  <span className="font-mono text-fg-subtle">{r.code}</span> {fmtWon(r.price)}{" "}
                  {r.changePct == null ? "" : fmtPct(r.changePct)}
                  <p className="text-xs text-fg-muted">{r.note}</p>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="mt-3 text-[11px] text-fg-subtle">참고 자료이며 매수 권유가 아닙니다.</p>
        </Card>
      ) : (
        <Card>
          <p className="text-sm text-fg-muted">
            실행하면 이 자리 제목이 <b>분석 STOCK</b>으로 결과가 붙습니다. 프롬프트를 고르거나 직접 질문을 적으세요.
          </p>
        </Card>
      )}

      {market ? <MarketPanel brief={market} /> : null}
      {report ? <AnalysisPanel report={report} /> : null}
    </section>
  );
}
