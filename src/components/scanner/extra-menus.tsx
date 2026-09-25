import { SrChart } from "@/components/scanner/mini-charts";
import { Card, CardDesc, CardHeader, CardTitle } from "@/components/ui/card";
import type { AnalysisReport, MarketBrief } from "@/lib/scanner/types";
import type { DipHit, DipSetup, SignHit } from "@/lib/scanner/screens";
import type { DartEventHit } from "@/lib/dart/events";
import { fmtWon } from "@/lib/utils";

export function AnalysisPanel({ report, onPick }: { report: AnalysisReport; onPick?: (code: string, name: string) => void }) {
  const lv = report.levels;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <button type="button" className="text-left hover:underline" onClick={() => onPick?.(report.stockCode, report.stockName ?? report.stockCode)}>
            {report.stockName} <span className="font-mono text-sm text-fg-subtle">{report.stockCode}</span>
          </button>
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
      {report.consensus ? (
        <p className="mt-2 text-sm">
          네이버 컨센서스 {report.consensus.date} · 목표 {report.consensus.target}원 · 추천평균 {report.consensus.score}{" "}
          (5 적극매수~1 적극매도) · 현재가 대비 {report.consensus.upsidePct == null ? "—" : `${report.consensus.upsidePct}%`}
        </p>
      ) : (
        <p className="mt-2 text-xs text-fg-subtle">네이버 목표주가·추천평균을 받지 못했습니다.</p>
      )}
      {report.researches?.length ? (
        <ul className="mt-2 text-sm text-fg-muted">
          {report.researches.map((r) => (
            <li key={`${r.broker}-${r.title}`}>
              {r.date} {r.broker} · {r.title}
            </li>
          ))}
        </ul>
      ) : null}
      {report.news.length ? (
        <ul className="mt-3 space-y-2 text-sm text-fg-muted">
          {report.news.slice(0, 6).map((n) => (
            <li key={`${n.source ?? ""}-${n.title}`}>
              <p>
                <span className="text-fg-subtle">{n.source ?? "뉴스"} · </span>
                {n.title}
              </p>
              {n.summary ? <p className="text-xs leading-relaxed">{n.summary}</p> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-fg-subtle">종목 뉴스가 없어 실적·수주 문단은 생략합니다.</p>
      )}
      <p className="mt-3 text-[11px] text-fg-subtle">{report.disclaimer}</p>
    </Card>
  );
}

export function MarketPanel({ brief, onPick }: { brief: MarketBrief; onPick?: (code: string, name: string) => void }) {
  return (
    <section className="flex flex-col gap-3">
      <Card>
        <CardHeader>
          <CardTitle>
            {brief.market} 시황
          </CardTitle>
          <CardDesc>
            {brief.price == null ? "교차확인 지수 없음" : brief.price.toLocaleString("ko-KR")}{" "}
            {brief.changePct == null ? "" : `${brief.changePct >= 0 ? "+" : ""}${brief.changePct.toFixed(2)}%`}
          </CardDesc>
        </CardHeader>
        <p className="text-sm leading-relaxed">{brief.outlook}</p>
        <p className="mt-2 text-xs text-fg-subtle">{brief.crossNote}</p>
      </Card>
      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <p className="mb-2 text-sm font-semibold">시세</p>
          <ul className="space-y-1 text-sm text-fg-muted">
            {brief.stats.map((s) => (
              <li key={s.label}>
                {s.label} {s.value}
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <p className="mb-2 text-sm font-semibold">수급</p>
          <ul className="space-y-1 text-sm text-fg-muted">
            {brief.flow.map((s) => (
              <li key={s.label}>
                {s.label} {s.value}
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <p className="mb-2 text-sm font-semibold">등락 종목 수</p>
          <ul className="space-y-1 text-sm text-fg-muted">
            {brief.breadth.map((s) => (
              <li key={s.label}>
                {s.label} {s.value}
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <Card>
        <p className="mb-2 text-sm font-semibold">시가총액 상위 (매수 추천 아님)</p>
        <ul className="space-y-1 text-sm">
          {brief.leaders.map((s) => (
            <li key={s.code}>
              <button type="button" className="text-left hover:underline" onClick={() => onPick?.(s.code, s.name)}>
                {s.name} <span className="font-mono text-fg-subtle">{s.code}</span> {s.price} · {s.change}
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-fg-subtle">
          이름 기준 묶음: {brief.sectors.map((s) => `${s.name} ${s.names.join(", ")}`).join(" / ") || "분류 없음"}
        </p>
      </Card>
      {brief.news.length ? (
        <Card>
          <p className="mb-2 text-sm font-semibold">시황 뉴스</p>
          <ul className="space-y-2 text-sm text-fg-muted">
            {brief.news.map((n) => (
              <li key={n.title}>
                <p>
                  {n.title} <span className="text-fg-subtle">· {n.source}</span>
                </p>
                {n.summary ? <p className="text-xs leading-relaxed">{n.summary}</p> : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <p className="text-[11px] text-fg-subtle">{brief.disclaimer}</p>
    </section>
  );
}

export function SignsPanel({
  signs,
  note,
  skipped,
  onPick,
}: {
  signs: SignHit[];
  note: string;
  skipped: string;
  onPick?: (code: string, name: string) => void;
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
      {(["급등", "급락", "공시"] as const).map((kind) => {
        const rows = signs.filter((s) => s.kind === kind);
        return (
          <div key={kind} className="overflow-x-auto rounded-lg border border-border">
            <p className="border-b border-border px-3 py-2 text-sm font-semibold">
              {kind}
              <span className="ml-2 font-normal text-fg-subtle">{rows.length}건</span>
            </p>
            {rows.length ? (
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="text-xs text-fg-subtle">
                  <tr>
                    <th className="px-3 py-2 font-medium">종목</th>
                    <th className="px-3 py-2 font-medium">이유</th>
                    <th className="px-3 py-2 font-medium">내용</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s) => (
                    <tr key={`${s.code}-${s.title}-${s.evidence}`} className="border-t border-border align-top">
                      <td className="px-3 py-2">
                        <button type="button" className="text-left hover:underline" onClick={() => onPick?.(s.code, s.name)}>
                          {s.name}
                          <div className="font-mono text-xs text-fg-subtle">{s.code}</div>
                        </button>
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium">{s.title}</div>
                        <div className="text-xs text-fg-muted">{s.detail}</div>
                        <div className="text-xs text-fg-subtle">근거 {s.evidence}</div>
                      </td>
                      <td className="px-3 py-2 text-fg-muted">
                        {s.excerpt || "본문 요약을 받지 못했습니다."}
                        {s.verifyNote ? <p className="mt-1 text-xs text-fg">{s.verifyNote}</p> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="px-3 py-3 text-sm text-fg-subtle">이번 스캔에서 해당 없음</p>
            )}
          </div>
        );
      })}
    </section>
  );
}

export function DipPanel({
  dips,
  events,
  setups,
  note,
  skipped,
  onPick,
}: {
  dips: DipHit[];
  events: DartEventHit[];
  setups: DipSetup[];
  note: string;
  skipped: string;
  onPick?: (code: string, name: string) => void;
}) {
  const top = dips.filter((d) => d.priority === 1);
  const wait = dips.filter((d) => d.priority !== 1);
  const groups = ["실적", "설명회", "신제품", "임상", "계약", "산업"] as const;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">저가매수</h2>
      <p className="text-sm text-fg-muted">
        조건이 하나만 맞은 종목은 빼 둡니다. 수급(기관 또는 외인·기관 동반)과 가격(양봉·5일선 회복·낙폭 반등)이 함께 있거나, 가격 조건이 2개
        이상 겹칠 때만 나옵니다. 고점 근처 양봉·순매수는 저가매수로 보지 않습니다. 겹친 개수는 적중 확률이 아니며, 맞는 사실이 더 많은
        종목만 남긴 것입니다. {note}
      </p>
      <p className="text-xs text-fg-subtle">{skipped}</p>
      <div className="overflow-x-auto rounded-lg border border-border">
        <p className="border-b border-border px-3 py-2 text-sm font-semibold">
          겹친 조건
          <span className="ml-2 font-normal text-fg-subtle">
            {setups.length}종목 · 많은 순
          </span>
        </p>
        {setups.length ? (
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-xs text-fg-subtle">
              <tr>
                <th className="px-3 py-2 font-medium">종목</th>
                <th className="px-3 py-2 font-medium">겹침</th>
                <th className="px-3 py-2 font-medium">근거</th>
              </tr>
            </thead>
            <tbody>
              {[...setups]
                .sort((a, b) => b.score - a.score)
                .slice(0, 15)
                .map((s) => (
                  <tr key={`${s.code}-${s.title}`} className="border-t border-border align-top">
                    <td className="px-3 py-2">
                      <button type="button" className="text-left hover:underline" onClick={() => onPick?.(s.code, s.name)}>
                        {s.name}
                        <div className="font-mono text-xs text-fg-subtle">{s.code}</div>
                      </button>
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{s.score}개</div>
                      <div className="text-xs text-fg-subtle">{s.hits.join(" · ")}</div>
                    </td>
                    <td className="px-3 py-2 text-fg-muted">
                      {s.detail}
                      {s.verifyNote ? <p className="mt-1 text-xs text-fg">{s.verifyNote}</p> : null}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        ) : (
          <p className="px-3 py-3 text-sm text-fg-subtle">
            조건이 겹친 종목이 없습니다. 하나만 맞은 종목은 확률을 높이기 위해 목록에서 뺐습니다.
          </p>
        )}
      </div>
      <h3 className="mt-2 text-sm font-semibold">DART 공시</h3>
      {!events.length ? (
        <Card>
          <p className="text-sm text-fg-muted">이번 검색에서 조건에 맞는 공시가 없습니다.</p>
        </Card>
      ) : null}
      {groups.map((category) => {
        const rows = events.filter((e) => e.category === category);
        if (!rows.length) return null;
        return (
          <div key={category} className="flex flex-col gap-2">
            <p className="text-sm font-semibold">{category}</p>
            {rows.map((e) => (
              <Card key={`${e.code}-${e.category}-${e.title}`}>
                <CardHeader>
                  <CardTitle>
                    <button type="button" className="text-left hover:underline" onClick={() => onPick?.(e.code, e.name)}>
                      {e.theme} · {e.name} <span className="font-mono text-sm font-normal text-fg-subtle">{e.code}</span>
                    </button>
                  </CardTitle>
                  <CardDesc>
                    {e.filedOn} 접수
                    {e.link ? (
                      <>
                        {" "}
                        ·{" "}
                        <a className="underline" href={e.link} target="_blank" rel="noreferrer">
                          공시 원문
                        </a>
                      </>
                    ) : null}
                  </CardDesc>
                </CardHeader>
                <p className="text-sm">{e.title}</p>
                <p className="mt-1 text-xs text-fg-subtle">{e.note}</p>
              </Card>
            ))}
          </div>
        );
      })}
      <h3 className="mt-4 text-sm font-semibold">참고: 거래대금 조건 통과 종목</h3>
      <p className="text-xs text-fg-subtle">
        이 목록은 돈이 이미 몰린 종목입니다. 급등 뒤 조정인지와 별개로, 가격 조건만 맞은 참고치입니다. 전력·에너지·지주·조선·방산·2차전지도
        포함합니다.
      </p>
      {!dips.length ? (
        <Card>
          <p className="text-sm text-fg-muted">가격 조건을 통과한 종목은 없습니다.</p>
        </Card>
      ) : null}
      {top.length ? <p className="text-sm font-semibold">기술 신호 3개 이상</p> : null}
      {[...top, ...wait].map((d) => (
        <Card key={d.code}>
          <CardHeader>
            <CardTitle>
              <button type="button" className="text-left hover:underline" onClick={() => onPick?.(d.code, d.name)}>
                {d.priority}순위 · {d.name} <span className="font-mono text-sm font-normal text-fg-subtle">{d.code}</span>
              </button>
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
          {d.verifyNote ? <p className="mt-1 text-xs text-fg">{d.verifyNote}</p> : null}
        </Card>
      ))}
    </section>
  );
}
