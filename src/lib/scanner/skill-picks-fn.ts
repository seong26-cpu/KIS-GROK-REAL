import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { resolveKisCreds } from "@/lib/secret-env.server";
import {
  classifySkillQuery,
  extractAsOf,
  mentionedTickers,
  sectorPool,
  SKILL_STEPS,
  type SkillCheapRow,
  type SkillPicksResult,
} from "@/lib/scanner/skill-picks";
import { detectDipSetups } from "@/lib/scanner/screens";
import type { AnalysisReport, MarketBrief } from "@/lib/scanner/types";

const input = z.object({
  appKey: z.string().optional().default(""),
  appSecret: z.string().optional().default(""),
  query: z.string().min(1).max(400),
  asOf: z.string().optional(),
});

export type SkillPicksFnResult = SkillPicksResult | { ok: false; error: string };

function thesis(report: AnalysisReport): string {
  const lines = [
    report.summary,
    report.maNote,
    report.macdNote,
    report.marketReason,
    report.consensus
      ? `네이버 컨센서스 ${report.consensus.date} 목표 ${report.consensus.target}원, 괴리 ${report.consensus.upsidePct ?? "—"}%.`
      : "네이버 목표주가는 이번 조회에 없습니다.",
    report.strengths.slice(0, 2).map((s) => `강점: ${s}`).join(" "),
    report.risks.slice(0, 2).map((s) => `위험: ${s}`).join(" "),
  ].filter(Boolean);
  return lines.join(" ");
}

export const skillPicksFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => input.parse(d))
  .handler(async ({ data }): Promise<SkillPicksFnResult> => {
    const q = data.query.trim();
    const mode = classifySkillQuery(q);
    const asOf = extractAsOf(q) || data.asOf || null;
    const pack = (
      body: string,
      extra: Partial<Pick<SkillPicksResult, "cheap" | "report" | "reports" | "market">> = {},
    ): SkillPicksResult => ({
      ok: true,
      heading: "분석 STOCK",
      query: q,
      mode,
      asOf,
      workflow: [...SKILL_STEPS],
      body,
      ...extra,
    });

    try {
      const { KisClient } = await import("@/lib/kis/client.server");
      const { buildSnapshot } = await import("@/lib/kis/snapshot.server");
      const { buildAnalysis } = await import("@/lib/scanner/analysis");
      const { fetchSihwang } = await import("@/lib/market/sihwang.server");
      const { buildMarketBrief } = await import("@/lib/market/brief.server");
      const client = new KisClient(resolveKisCreds(data.appKey, data.appSecret));
      await client.ensureToken();
      const sihwang = await fetchSihwang().catch(() => null);
      const marketName = /코스닥|KOSDAQ/i.test(q) && !/코스피|KOSPI/i.test(q) ? "KOSDAQ" : "KOSPI";

      const loadMarket = async (): Promise<MarketBrief> => buildMarketBrief(marketName, asOf ?? undefined);

      const loadReport = async (code: string, name?: string): Promise<AnalysisReport> => {
        const snap = await buildSnapshot(client, code, name ? { name } : undefined, asOf ?? undefined);
        return buildAnalysis(snap, sihwang, asOf ?? undefined);
      };

      if (mode === "market") {
        const market = await loadMarket();
        const when = asOf ? `기준일 ${asOf}` : "최신";
        const body = [
          `${when} ${market.market} ${market.price?.toLocaleString("ko-KR") ?? "—"} (${
            market.changePct == null ? "등락 미확보" : `${market.changePct >= 0 ? "+" : ""}${market.changePct.toFixed(2)}%`
          })`,
          market.outlook,
          market.crossNote,
          "korean-stock-picks 매크로 단계입니다. 지수와 뉴스만 붙였고, 종목 매수 판단으로 넘기지 않습니다.",
        ].join("\n");
        return pack(body, { market });
      }

      const named = mentionedTickers(q).slice(0, 3);
      if (mode === "ticker" && named.length) {
        const reports: AnalysisReport[] = [];
        for (const row of named) reports.push(await loadReport(row.code, row.name === row.code ? undefined : row.name));
        const market = /시황|코스피|코스닥/.test(q) ? await loadMarket().catch(() => undefined) : undefined;
        const body = [
          asOf ? `가격·뉴스는 ${asOf} 기준으로 잘랐습니다.` : "최신 시세입니다.",
          ...reports.map((r, i) => `${i + 1}. ${r.stockName ?? named[i]!.name}(${r.stockCode}) ${thesis(r)}`),
          "같은 섹터만 잔뜩 담지 마세요. 코어 1, 위성 1 정도가 스킬의 분산 원칙입니다.",
        ].join("\n");
        return pack(body, { report: reports[0], reports, market });
      }

      const pool = (mode === "cheap" ? sectorPool(q) : sectorPool(q)).slice(0, mode === "cheap" ? 8 : 4);
      const cheap: SkillCheapRow[] = [];
      const reports: AnalysisReport[] = [];
      for (const row of pool) {
        try {
          const snap = await buildSnapshot(client, row.code, { name: row.name }, asOf ?? undefined);
          const built = await buildAnalysis(snap, sihwang, asOf ?? undefined);
          const setups = detectDipSetups(snap);
          const hit = setups[0];
          if (mode === "cheap" && !hit) continue;
          reports.push(built);
          cheap.push({
            code: built.stockCode,
            name: built.stockName ?? row.name,
            price: built.currentPrice,
            changePct: built.changeRatePct ?? null,
            note: hit ? `${hit.title}: ${hit.hits.join(", ")}. ${hit.detail}` : thesis(built).slice(0, 280),
          });
        } catch (e) {
          if (mode !== "cheap") {
            cheap.push({
              code: row.code,
              name: row.name,
              price: null,
              changePct: null,
              note: e instanceof Error ? e.message : String(e),
            });
          }
        }
      }
      const market = await loadMarket().catch(() => undefined);
      const intro =
        mode === "cheap"
          ? cheap.length
            ? "저가 후보는 고점 대비 조정 중이고, 수급과 가격 조건이 같이 맞은 이름만 남겼습니다. 맞는 개수는 확률 숫자가 아닙니다."
            : "이번 유동성 후보 안에서는 조건이 겹친 종목이 없습니다. 목록을 채우려고 완화된 종목을 넣지 않았습니다."
          : `질문에서 종목코드가 없어 ${pool.map((p) => p.sector).filter((v, i, a) => a.indexOf(v) === i).join(", ")} 대표 종목과 시황만 붙였습니다. 코드를 적으면 그 종목만 깊게 봅니다.`;
      return pack(`${intro}\n기준: ${asOf ?? "최신"}.`, { cheap, report: reports[0], reports, market });
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
