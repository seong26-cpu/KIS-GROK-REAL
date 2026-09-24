import { SrChart } from "@/components/scanner/mini-charts";
import { Card, CardDesc, CardHeader, CardTitle } from "@/components/ui/card";
import type { AnalysisReport } from "@/lib/scanner/types";
import type { DipHit, SignHit } from "@/lib/scanner/screens";
import { fmtWon } from "@/lib/utils";

export function AnalysisPanel({ report }: { report: AnalysisReport }) {
  const lv = report.levels;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {report.stockName} <span className="font-mono text-sm text-fg-subtle">{report.stockCode}</span>
        </CardTitle>
        <CardDesc>
          시황 {report.marketState} · 매수 {report.recommend == null ? "판단불가" : report.recommend ? "Yes" : "No"} ·{" "}
          {fmtWon(report.currentPrice)}
        </CardDesc>
      </CardHeader>
      <p className="text-sm leading-relaxed text-fg-muted">{report.summary}</p>
      <div className="mt-4">
        <p className="mb-2 text-sm font-semibold">주가 · 지지 / 저항</p>
        <SrChart
          bars={report.chartBars ?? report.recentCloses.map((b) => ({ ...b, volume: null }))}
          support1={lv?.support1 ?? null}
          support2={lv?.support2 ?? null}
          resistance1={lv?.resistance1 ?? null}
          resistance2={lv?.resistance2 ?? null}
        />
        <p className="mt-1 text-xs text-fg-subtle">
          지지 {fmtWon(lv?.support1 ?? null)} / {fmtWon(lv?.support2 ?? null)} · 저항 {fmtWon(lv?.resistance1 ?? null)} /{" "}
          {fmtWon(lv?.resistance2 ?? null)} · 손절 {fmtWon(lv?.stop ?? null)}
        </p>
      </div>
      {report.timing?.length ? (
        <ul className="mt-4 flex flex-col gap-2">
          {report.timing.map((t) => (
            <li key={t.title} className="rounded-lg bg-bg-subtle px-3 py-2">
              <p className="text-sm font-semibold">{t.title}</p>
              <p className="text-sm text-fg-muted">{t.body}</p>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mt-3 text-sm text-fg-muted">
        {report.maNote} · RSI {report.rsi ?? "미산출"} · {report.macdNote} · {report.stochNote}
      </p>
      {report.news.length ? (
        <ul className="mt-3 space-y-1 text-sm text-fg-muted">
          {report.news.slice(0, 6).map((n) => (
            <li key={n.title}>{n.title}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-fg-subtle">종목 뉴스가 없어 실적·수주 문단은 생략합니다.</p>
      )}
      <p className="mt-3 text-[11px] text-fg-subtle">{report.disclaimer}</p>
    </Card>
  );
}

export function SignsPanel({
  signs,
  note,
  skipped,
}: {
  signs: SignHit[];
  note: string;
  skipped: string;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">사전징후</h2>
      <p className="text-sm text-fg-muted">{note}</p>
      <p className="text-xs text-fg-subtle">{skipped}</p>
      <p className="text-xs text-fg-subtle">
        더 채우려면: 매수·매도 수량은 DART 공시 본문(rcpNo)을 더 열어야 합니다. 단주 매매는 KIS 호가 API가 필요합니다.
        제목과 재무제표에 없는 확률·수량은 만들지 않습니다.
      </p>
      {!signs.length ? (
        <Card>
          <p className="text-sm text-fg-muted">이번에 스캔한 A∪B∪C 종목에서 기사·일봉으로 확인된 징후가 없습니다.</p>
        </Card>
      ) : (
        signs.map((s) => (
          <Card key={`${s.code}-${s.title}`}>
            <CardHeader>
              <CardTitle>
                {s.kind} · {s.name} <span className="font-mono text-sm font-normal text-fg-subtle">{s.code}</span>
              </CardTitle>
              <CardDesc>{s.title}</CardDesc>
            </CardHeader>
            <p className="text-sm text-fg-muted">{s.detail}</p>
            <p className="mt-1 text-xs text-fg-subtle">근거: {s.evidence}</p>
          </Card>
        ))
      )}
    </section>
  );
}

export function DipPanel({ dips, note, skipped }: { dips: DipHit[]; note: string; skipped: string }) {
  const top = dips.filter((d) => d.priority === 1);
  const wait = dips.filter((d) => d.priority !== 1);
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">저가매수</h2>
      <p className="text-sm text-fg-muted">
        A∪B∪C 안에서 AI·반도체·로봇·바이오만 보고, 고점 대비 -20~-40%, 저점 대비 +5~+20%, 거래량 1.2배, 기술 신호 2개
        이상을 동시에 통과한 종목만 남깁니다. {note}
      </p>
      <p className="text-xs text-fg-subtle">{skipped}</p>
      <p className="text-xs text-fg-subtle">
        재무 숫자는 DART 연결 재무제표가 있는 항목만 적습니다. R&D처럼 계정에 없으면 미확보로 남깁니다. 52주 고저는
        일봉 1년치가 더 필요합니다.
      </p>
      {!dips.length ? (
        <Card>
          <p className="text-sm text-fg-muted">조건을 모두 통과한 종목이 없습니다. 재무 숫자를 채워 넣지 않았습니다.</p>
        </Card>
      ) : null}
      {top.length ? <p className="text-sm font-semibold">기술 신호 3개 이상</p> : null}
      {[...top, ...wait].map((d) => (
        <Card key={d.code}>
          <CardHeader>
            <CardTitle>
              {d.priority}순위 · {d.name} <span className="font-mono text-sm font-normal text-fg-subtle">{d.code}</span>
            </CardTitle>
            <CardDesc>
              {d.theme} · {fmtWon(d.price)} · 고점 {d.fromHighPct}% · 저점 +{d.fromLowPct}% · {d.windowDays}일봉
            </CardDesc>
          </CardHeader>
          <p className="text-sm text-fg-muted">
            RSI {d.rsi ?? "—"} · 거래량 {d.volRatio ?? "—"}배 · {d.techHits.join(" · ")}
          </p>
          <p className="mt-2 text-sm">
            테스트 {fmtWon(d.step1)} (저점 +10%) · 확신 {fmtWon(d.step2)} · 추가 {fmtWon(d.step3)} · 손절 {fmtWon(d.stop)}
          </p>
          {d.dartLines?.length ? (
            <ul className="mt-2 text-sm">
              {d.dartLines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
          <p className="mt-1 text-xs text-fg-subtle">미확보: {d.missing.length ? d.missing.join(", ") : "없음"}</p>
          {d.news.length ? (
            <ul className="mt-2 text-sm text-fg-muted">
              {d.news.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-fg-subtle">최근 뉴스 없음 — 이벤트(실적·임상·계약)는 적지 않습니다.</p>
          )}
          <p className="mt-2 text-xs text-fg-subtle">{d.note}</p>
        </Card>
      ))}
    </section>
  );
}
