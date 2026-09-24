import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { resolveKisCreds } from "@/lib/secret-env.server";
import { classifySkillQuery, SKILL_STEPS } from "@/lib/scanner/skill-picks";
import { analyzeStockFn } from "@/lib/scanner/fns";

const input = z.object({
  appKey: z.string().optional().default(""),
  appSecret: z.string().optional().default(""),
  query: z.string().min(1).max(400),
});

export const skillPicksFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => input.parse(d))
  .handler(async ({ data }) => {
    const q = data.query.trim();
    const mode = classifySkillQuery(q);
    const heading = "분석 STOCK" as const;
    const wrap = (body: string, extra: Record<string, unknown> = {}) => ({
      ok: true as const,
      heading,
      query: q,
      mode,
      workflow: SKILL_STEPS,
      body,
      ...extra,
    });
    try {
      if (mode === "market") {
        const { buildMarketBrief } = await import("@/lib/market/brief.server");
        const market = await buildMarketBrief(/코스닥|KOSDAQ/i.test(q) ? "KOSDAQ" : "KOSPI");
        const body = [
          `${market.market} ${market.price?.toLocaleString("ko-KR") ?? "—"} (${
            market.changePct == null ? "—" : `${market.changePct >= 0 ? "+" : ""}${market.changePct.toFixed(2)}%`
          })`,
          market.outlook,
          market.crossNote,
          "korean-stock-picks: 시황은 매크로 단계입니다. 바로 매수 추천으로 이어가지 않습니다.",
        ].join("\n");
        return wrap(body, { market });
      }
      const { KisClient } = await import("@/lib/kis/client.server");
      const { buildSnapshot } = await import("@/lib/kis/snapshot.server");
      const { buildAnalysis } = await import("@/lib/scanner/analysis");
      const { fetchSihwang } = await import("@/lib/market/sihwang.server");
      const client = new KisClient(resolveKisCreds(data.appKey, data.appSecret));
      await client.ensureToken();
      const sihwang = await fetchSihwang().catch(() => null);
      const codes: { code: string; name: string }[] =
        mode === "cheap" || mode === "free"
          ? [
              { code: "005930", name: "삼성전자" },
              { code: "000660", name: "SK하이닉스" },
              { code: "005380", name: "현대차" },
              { code: "402340", name: "SK스퀘어" },
              { code: "105560", name: "KB금융" },
            ]
          : [];
      const found = q.match(/\d{6}/g);
      if (found) {
        for (const code of found) {
          if (!codes.some((c) => c.code === code)) codes.unshift({ code, name: code });
        }
      }
      if (mode === "ticker" && !codes.length) {
        const one = await analyzeStockFn({ data: { appKey: data.appKey, appSecret: data.appSecret, query: q.slice(0, 40) } });
        if (!one.ok) return { ok: false as const, error: one.error };
        const body = one.report
          ? `${one.report.stockName}(${one.report.stockCode}) ${one.report.summary}`
          : "시황 결과는 아래 패널을 보세요.";
        return wrap(body, { report: one.report, market: one.market });
      }
      const cheap = [];
      let report = undefined;
      for (const row of codes.slice(0, 5)) {
        try {
          const snap = await buildSnapshot(client, row.code);
          const built = await buildAnalysis(snap, sihwang);
          if (!report) report = built;
          cheap.push({
            code: built.stockCode,
            name: built.stockName ?? row.name,
            price: built.currentPrice,
            changePct: built.changeRatePct ?? null,
            note: built.summary.slice(0, 220),
          });
        } catch (e) {
          cheap.push({
            code: row.code,
            name: row.name,
            price: null,
            changePct: null,
            note: e instanceof Error ? e.message : String(e),
          });
        }
      }
      const intro =
        mode === "cheap"
          ? "저가매수 후보는 유동성 대형 위주입니다. PER 0.x 소형·테마 급락은 제외했습니다."
          : `질의: ${q}`;
      return wrap(`${intro}\n아래는 스킬 워크플로로 붙인 실시간 시세·컨센서스 요약입니다.`, { cheap, report });
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
  });
