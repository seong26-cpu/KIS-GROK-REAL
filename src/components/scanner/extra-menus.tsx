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

function won(n: number | null | undefined): string {
  return n == null ? "미산출" : `${Math.round(n).toLocaleString("ko-KR")}원`;
}

function TradeTable({
  title,
  rows,
  onPick,
}: {
  title: string;
  rows: {
    key: string;
    code: string;
    name: string;
    current: string;
    reason: string;
    buy: string;
    sell: string;
    wait: string;
  }[];
  onPick?: (code: string, name: string) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <p className="border-b border-border px-3 py-2 text-sm font-semibold">
        {title}
        <span className="ml-2 font-normal text-fg-subtle">{rows.length}건</span>
      </p>
      <table className="w-full min-w-[860px] text-left text-sm">
        <thead className="text-xs text-fg-subtle">
          <tr>
            <th className="px-3 py-2 font-medium">종목</th>
            <th className="px-3 py-2 font-medium">현재</th>
            <th className="px-3 py-2 font-medium">근거</th>
            <th className="px-3 py-2 font-medium">매수</th>
            <th className="px-3 py-2 font-medium">매도</th>
            <th className="px-3 py-2 font-medium">대기시간</th>
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((r) => (
              <tr key={r.key} className="border-t border-border align-top">
                <td className="px-3 py-2">
                  <button type="button" className="text-left hover:underline" onClick={() => onPick?.(r.code, r.name)}>
                    {r.name}
                    <div className="font-mono text-xs text-fg-subtle">{r.code}</div>
                  </button>
                </td>
                <td className="px-3 py-2 tabular">{r.current}</td>
                <td className="px-3 py-2 text-fg-muted">{r.reason}</td>
                <td className="px-3 py-2">{r.buy}</td>
                <td className="px-3 py-2">{r.sell}</td>
                <td className="px-3 py-2 text-fg-muted">{r.wait}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={6} className="px-3 py-3 text-fg-subtle">
                해당 없음
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
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
        매수·손절·익절은 일봉 스윙 지지·저항입니다. 지지가 없으면 미산출이고, 확률은 적지 않습니다.
      </p>
      {(["급등", "급락"] as const).map((kind) => (
        <TradeTable
          key={kind}
          title={kind}
          onPick={onPick}
          rows={signs
            .filter((s) => s.kind === kind)
            .map((s) => ({
              key: `${s.code}-${s.title}-${s.evidence}`,
              code: s.code,
              name: s.name,
              current: won(s.price),
              reason: `${s.title}. ${s.detail} 근거: ${s.evidence}. ${s.excerpt}`,
              buy: s.impact === "악재" ? "진입 보류" : `지지 ${won(s.buy)}`,
              sell: `손절 ${won(s.stop)} · 익절 ${s.impact === "악재" ? "비움" : won(s.take)}`,
              wait: `${s.wait}${s.verifyNote ? ` · ${s.verifyNote}` : ""}`,
            }))}
        />
      ))}
      <div className="overflow-x-auto rounded-lg border border-border">
        <p className="border-b border-border px-3 py-2 text-sm font-semibold">
          공시
          <span className="ml-2 font-normal text-fg-subtle">{signs.filter((s) => s.kind === "공시").length}건</span>
        </p>
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="text-xs text-fg-subtle">
            <tr>
              <th className="px-3 py-2 font-medium">종목</th>
              <th className="px-3 py-2 font-medium">내용</th>
              <th className="px-3 py-2 font-medium">세부내용</th>
              <th className="px-3 py-2 font-medium">근거</th>
              <th className="px-3 py-2 font-medium">영향</th>
            </tr>
          </thead>
          <tbody>
            {signs.filter((s) => s.kind === "공시").length ? (
              signs
                .filter((s) => s.kind === "공시")
                .map((s) => (
                  <tr key={`${s.code}-${s.title}`} className="border-t border-border align-top">
                    <td className="px-3 py-2">
                      <button type="button" className="text-left hover:underline" onClick={() => onPick?.(s.code, s.name)}>
                        {s.name}
                        <div className="font-mono text-xs text-fg-subtle">{s.code}</div>
                      </button>
                    </td>
                    <td className="px-3 py-2">{s.title}</td>
                    <td className="px-3 py-2 text-fg-muted">{s.excerpt || s.detail}</td>
                    <td className="px-3 py-2 text-fg-muted">{s.evidence}</td>
                    <td className="px-3 py-2">{s.impact}</td>
                  </tr>
                ))
            ) : (
              <tr>
                <td colSpan={5} className="px-3 py-3 text-fg-subtle">
                  해당 없음
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
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
  const level = (code: string) => {
    const s = setups.find((x) => x.code === code);
    if (s) return { price: s.price, buy: s.buy, stop: s.stop, take: s.take, wait: s.wait };
    const d = dips.find((x) => x.code === code);
    if (d) {
      return {
        price: d.price,
        buy: d.step1,
        stop: d.stop,
        take: d.step2,
        wait: "저점 대비 구간. 제목에 일정이 없으면 날짜를 만들지 않습니다.",
      };
    }
    return { price: null, buy: null, stop: null, take: null, wait: "이 종목 일봉을 이번 스캔에서 받지 않아 가격은 비웁니다." };
  };
  const eventRows = (cats: string[]) =>
    events
      .filter((e) => cats.includes(e.category))
      .map((e) => {
        const lv = level(e.code);
        const dated = e.note.match(/20\d{2}-\d{2}-\d{2}/);
        return {
          key: `${e.code}-${e.category}-${e.title}`,
          code: e.code,
          name: e.name,
          current: won(lv.price),
          reason: `${e.category} · ${e.title}. ${e.note}`,
          buy: lv.buy == null ? "미산출" : `지지 ${won(lv.buy)}`,
          sell: `손절 ${won(lv.stop)} · 익절 ${won(lv.take)}`,
          wait: dated ? `제목 일정 ${dated[0]}` : lv.wait,
        };
      });
  const seen = new Set(setups.map((s) => s.code));
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">저가매수</h2>
      <p className="text-sm text-fg-muted">
        매수는 일봉 지지, 매도의 손절은 그 아래 지지, 익절은 위쪽 저항입니다. 없는 가격은 미산출입니다. 대기시간은 신호 종류로 나눈
        확인 구간이지 수익 예상이 아닙니다. {note}
      </p>
      <p className="text-xs text-fg-subtle">{skipped}</p>
      <TradeTable
        title="경쟁조건"
        onPick={onPick}
        rows={[...setups]
          .sort((a, b) => b.score - a.score)
          .slice(0, 15)
          .map((s) => ({
            key: s.code,
            code: s.code,
            name: s.name,
            current: won(s.price),
            reason: `${s.hits.join(" · ")}. ${s.detail}`,
            buy: `지지 ${won(s.buy)}`,
            sell: `손절 ${won(s.stop)} · 익절 ${won(s.take)}`,
            wait: s.wait,
          }))}
      />
      <TradeTable title="임상 · 실적" onPick={onPick} rows={eventRows(["임상", "실적", "설명회"])} />
      <TradeTable title="계약" onPick={onPick} rows={eventRows(["계약", "신제품", "산업"])} />
      <div className="overflow-x-auto rounded-lg border border-border">
        <p className="border-b border-border px-3 py-2 text-sm font-semibold">공시</p>
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="text-xs text-fg-subtle">
            <tr>
              <th className="px-3 py-2 font-medium">종목</th>
              <th className="px-3 py-2 font-medium">내용</th>
              <th className="px-3 py-2 font-medium">세부내용</th>
              <th className="px-3 py-2 font-medium">영향</th>
            </tr>
          </thead>
          <tbody>
            {events.length ? (
              events.map((e) => (
                <tr key={`d-${e.code}-${e.title}`} className="border-t border-border align-top">
                  <td className="px-3 py-2">
                    <button type="button" className="text-left hover:underline" onClick={() => onPick?.(e.code, e.name)}>
                      {e.name}
                      <div className="font-mono text-xs text-fg-subtle">{e.code}</div>
                    </button>
                  </td>
                  <td className="px-3 py-2">{e.category}</td>
                  <td className="px-3 py-2 text-fg-muted">
                    {e.title}
                    <div className="text-xs">{e.note}</div>
                  </td>
                  <td className="px-3 py-2">{/적자|소송|횡령|지연/.test(e.title) ? "악재" : "호재"}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={4} className="px-3 py-3 text-fg-subtle">
                  해당 없음
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <TradeTable
        title="가격 조건"
        onPick={onPick}
        rows={dips
          .filter((d) => !seen.has(d.code))
          .map((d) => ({
            key: `p-${d.code}`,
            code: d.code,
            name: d.name,
            current: won(d.price),
            reason: `${d.techHits.join(" · ")}. 고점 ${d.fromHighPct ?? "—"}%, 저점 +${d.fromLowPct ?? "—"}%. ${d.note}`,
            buy: `저점+10% ${won(d.step1)}`,
            sell: `손절 ${won(d.stop)} · 익절 ${won(d.step2)}`,
            wait: `${d.windowDays}일봉 구간 · 제목에 일정 없음`,
          }))}
      />
    </section>
  );
}
