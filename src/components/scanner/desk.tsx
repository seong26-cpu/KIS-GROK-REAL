import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ChevronLeft,
  Crosshair,
  Download,
  KeyRound,
  LayoutDashboard,
  Menu,
  Newspaper,
  PanelLeft,
  RefreshCw,
  Search,
  ShieldAlert,
  TrendingDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardDesc, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDesc, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { ThemeBoard, StockDetail } from "@/components/scanner/theme-board";
import { IndexSpark } from "@/components/scanner/mini-charts";
import {
  connectKis,
  evaluateBatch,
  fetchMarketNewsFn,
  fetchSihwangFn,
  fetchUniverseFn,
  getTokenStatusFn,
  refreshToken,
  screenChunkFn,
  serverKeyStatusFn,
  fetchDartEventsFn,
  minuteCheckFn,
  stockBoardFn,
} from "@/lib/scanner/fns";
import { DipPanel, SignsPanel } from "@/components/scanner/extra-menus";
import { SkillPicksPanel } from "@/components/scanner/skill-picks-panel";
import { skillPicksFn } from "@/lib/scanner/skill-picks-fn";
import type { SkillPicksResult } from "@/lib/scanner/skill-picks";
import type { DipHit, DipSetup, SignHit } from "@/lib/scanner/screens";
import type { DartEventHit } from "@/lib/dart/events";
import type { MarketBrief } from "@/lib/scanner/types";
import { rankClosingBetCandidates } from "@/lib/scanner/closing-bet";
import { assignRelativeStrength } from "@/lib/scanner/themes";
import { clearCreds, loadCreds, maskKey, saveCreds } from "@/lib/scanner/keys";
import type {
  AnalysisReport,
  BoardStock,
  BrokerCreds,
  ClosingBetCandidate,
  NewsItem,
  SihwangSnapshot,
  TokenStatus,
  UniverseSnapshot,
} from "@/lib/scanner/types";
import { cn, fmtPct, fmtWon } from "@/lib/utils";

type NavId = "scan" | "closing" | "analysis" | "news" | "keys" | "signs" | "dip" | "minute";

export function ScannerDesk({
  initialSihwang = null,
  initialSihwangError = null,
}: {
  initialSihwang?: SihwangSnapshot | null;
  initialSihwangError?: string | null;
}) {
  const [creds, setCreds] = useState<BrokerCreds | null>(null);
  const [serverManaged, setServerManaged] = useState(false);
  const [keyMask, setKeyMask] = useState<string | null>(null);
  const [dartOn, setDartOn] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [nav, setNav] = useState<NavId>("scan");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [keyOpen, setKeyOpen] = useState(false);
  const [draftKey, setDraftKey] = useState("");
  const [draftSecret, setDraftSecret] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connectLog, setConnectLog] = useState<string | null>(null);
  const [connectOk, setConnectOk] = useState<boolean | null>(null);
  const [token, setToken] = useState<TokenStatus>({ hasToken: false });
  const [universe, setUniverse] = useState<UniverseSnapshot | null>(null);
  const [uniError, setUniError] = useState<string | null>(null);
  const [uniLoading, setUniLoading] = useState(false);
  const [sihwang, setSihwang] = useState<SihwangSnapshot | null>(initialSihwang);
  const [sihwangError, setSihwangError] = useState<string | null>(initialSihwangError);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState({ done: 0, total: 0, stage: "" });
  const [scanError, setScanError] = useState<string | null>(null);
  const [board, setBoard] = useState<BoardStock[]>([]);
  const [closing, setClosing] = useState<ClosingBetCandidate[]>([]);
  const [scanAt, setScanAt] = useState<string | null>(null);
  const [scanSize, setScanSize] = useState<50 | 100 | 300>(50);
  const [analysisQ, setAnalysisQ] = useState("");
  const [analysis, setAnalysis] = useState<AnalysisReport | null>(null);
  const [marketBrief, setMarketBrief] = useState<MarketBrief | null>(null);
  const [analysisErr, setAnalysisErr] = useState<string | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [skillResult, setSkillResult] = useState<SkillPicksResult | null>(null);
  const [skillErr, setSkillErr] = useState<string | null>(null);
  const [screenLoading, setScreenLoading] = useState(false);
  const [screenErr, setScreenErr] = useState<string | null>(null);
  const [screenNote, setScreenNote] = useState("");
  const [screenSkip, setScreenSkip] = useState("");
  const [screenDone, setScreenDone] = useState(0);
  const [screenTotal, setScreenTotal] = useState(0);
  const [signs, setSigns] = useState<SignHit[]>([]);
  const [dips, setDips] = useState<DipHit[]>([]);
  const [setups, setSetups] = useState<DipSetup[]>([]);
  const [events, setEvents] = useState<DartEventHit[]>([]);
  const [popup, setPopup] = useState<{
    code: string;
    name: string;
    stock: BoardStock | null;
    error: string | null;
    loading: boolean;
  } | null>(null);
  const [asOfDate, setAsOfDate] = useState("");
  const [asOfTime, setAsOfTime] = useState("15:30");
  const [minuteCode, setMinuteCode] = useState("");
  const [minuteNote, setMinuteNote] = useState("");
  const [minuteRows, setMinuteRows] = useState<{ hour: string; open: number | null; high: number | null; low: number | null; close: number | null }[]>([]);
  const [minuteLoading, setMinuteLoading] = useState(false);
  const screenOnce = useRef(false);
  const cancelRef = useRef(false);

  useEffect(() => {
    let stop = false;
    void (async () => {
      try {
        const status = await serverKeyStatusFn({ data: {} });
        if (stop) return;
        setDartOn(status.dart);
        if (status.configured) {
          clearCreds();
          setServerManaged(true);
          setKeyMask(status.mask);
          setCreds({ appKey: "", appSecret: "" });
        } else {
          const stored = loadCreds();
          setCreds(stored);
          if (stored) {
            setDraftKey(stored.appKey);
            setDraftSecret(stored.appSecret);
          }
        }
      } catch {
        if (!stop) setCreds(loadCreds());
      } finally {
        if (!stop) {
          setHydrated(true);
          if (typeof window !== "undefined" && window.innerWidth >= 768) setSidebarOpen(true);
        }
      }
    })();
    return () => {
      stop = true;
    };
  }, []);

  const loadSihwang = useCallback(async () => {
    try {
      const res = await fetchSihwangFn({ data: {} });
      if (res.ok) setSihwang(res.sihwang);
      else setSihwangError(res.error);
    } catch (e) {
      setSihwangError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const loadNews = useCallback(async () => {
    try {
      const res = await fetchMarketNewsFn({ data: { asOf: asOfDate || undefined } });
      if (res.ok) setNews(res.items);
    } catch {
      /* public feed */
    }
  }, [asOfDate]);

  useEffect(() => {
    if (!initialSihwang) void loadSihwang();
    void loadNews();
    const tapeId = setInterval(() => void loadSihwang(), 60_000);
    const newsId = setInterval(() => void loadNews(), 5 * 60_000);
    return () => {
      clearInterval(tapeId);
      clearInterval(newsId);
    };
  }, [initialSihwang, loadNews, loadSihwang]);

  useEffect(() => {
    if (!creds) return;
    let stop = false;
    const tick = async () => {
      try {
        const res = await getTokenStatusFn({ data: creds });
        if (!stop && res.ok) setToken(res.token);
      } catch {
        /* ignore */
      }
    };
    void tick();
    const id = setInterval(tick, 20000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [creds]);

  const loadUniverse = useCallback(
    async (force = false) => {
      if (!creds) return;
      setUniLoading(true);
      setUniError(null);
      try {
        const res = await fetchUniverseFn({ data: { ...creds, force, todayTop: scanSize } });
        if (!res.ok) {
          setUniError(res.error);
          return;
        }
        setUniverse(res.universe);
      } catch (e) {
        setUniError(e instanceof Error ? e.message : String(e));
      } finally {
        setUniLoading(false);
      }
    },
    [creds, scanSize],
  );

  useEffect(() => {
    if (creds) void loadUniverse(false);
  }, [creds, loadUniverse]);

  const handleConnect = async () => {
    const next: BrokerCreds = { appKey: draftKey.trim(), appSecret: draftSecret.trim() };
    if (next.appKey.length < 8 || next.appSecret.length < 8) {
      setConnectOk(false);
      setConnectLog("APP KEY와 SECRET KEY를 모두 입력하세요.");
      return;
    }
    setConnecting(true);
    setConnectLog("KIS 실전 토큰 발급 확인 중…");
    try {
      const res = await connectKis({ data: next });
      if (!res.ok) {
        setConnectOk(false);
        setConnectLog(res.error);
        return;
      }
      saveCreds(next);
      setCreds(next);
      setToken(res.token);
      setConnectOk(true);
      setConnectLog(Object.entries(res.report).map(([k, v]) => `${k}: ${v}`).join("\n"));
      setKeyOpen(false);
    } catch (e) {
      setConnectOk(false);
      setConnectLog(e instanceof Error ? e.message : String(e));
    } finally {
      setConnecting(false);
    }
  };

  const runScan = async () => {
    if (!creds) return;
    cancelRef.current = false;
    setScanning(true);
    setScanError(null);
    setBoard([]);
    setClosing([]);
    try {
      setScanProgress({ done: 0, total: 0, stage: "A∪B∪C 유니버스" });
      const uniRes = await fetchUniverseFn({ data: { ...creds, force: true, todayTop: scanSize } });
      if (!uniRes.ok) {
        setScanError(uniRes.error);
        return;
      }
      setUniverse(uniRes.universe);
      const pool = uniRes.universe.selected.filter((s) => s.code).slice(0, scanSize);
      if (!pool.length) {
        setScanError(uniRes.universe.notes.join(" ") || "A∪B∪C 대상이 비었습니다.");
        return;
      }
      const tvCodes = uniRes.universe.todayTv.map((s) => s.code);
      const crCodes = uniRes.universe.changeRate.map((s) => s.code);
      const allBoard: BoardStock[] = [];
      const allClosing: ClosingBetCandidate[] = [];
      const errors: string[] = [];
      setScanProgress({ done: 0, total: pool.length, stage: "테마 스캔 (시세·수급·뉴스)" });
      for (let i = 0; i < pool.length; i += 4) {
        if (cancelRef.current) break;
        const chunk = pool.slice(i, i + 4);
        const res = await evaluateBatch({
          data: {
            ...creds,
            codes: chunk.map((s) => s.code),
            tradingValueCodes: tvCodes,
            changeRateCodes: crCodes,
            asOf: asOfDate || undefined,
            time: asOfTime || undefined,
            seed: chunk.map((s) => ({
              code: s.code,
              name: s.name,
              price: s.price,
              changeRatePct: s.changeRatePct,
              volume: s.volume,
              tradingValue: s.tradingValue,
              tradingValueEstimated: s.tradingValueEstimated,
              marketCapEok: s.marketCapEok,
              listedShares: s.listedShares,
              avgTradingValue: s.avgTradingValue,
              leaderScore: s.leaderScore,
            })),
          },
        });
        if (!res.ok) errors.push(res.error);
        else {
          allBoard.push(...res.board);
          allClosing.push(...res.closing);
          errors.push(...res.errors);
        }
        setScanProgress({
          done: Math.min(pool.length, i + chunk.length),
          total: pool.length,
          stage: "테마 스캔 (시세·수급·뉴스)",
        });
      }
      setBoard(assignRelativeStrength(allBoard));
      setClosing(rankClosingBetCandidates(allClosing, 12));
      setScanAt(
        new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false }).replace(/\. /g, ".").slice(2, 16),
      );
      if (errors.length) setScanError(errors.slice(0, 4).join(" · "));
      setNav("scan");
    } catch (e) {
      setScanError(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  };

  const runSkill = async (query: string) => {
    if (!creds || !query.trim()) return;
    setAnalysisLoading(true);
    setSkillErr(null);
    setAnalysis(null);
    setMarketBrief(null);
    try {
      const res = await skillPicksFn({
        data: { ...creds, query: query.trim(), asOf: asOfDate || undefined },
      });
      if (!res.ok) {
        setSkillResult(null);
        setSkillErr(res.error);
        return;
      }
      setSkillResult(res);
      setAnalysis(res.report ?? null);
      setMarketBrief(res.market ?? null);
    } catch (e) {
      setSkillErr(e instanceof Error ? e.message : String(e));
    } finally {
      setAnalysisLoading(false);
    }
  };

  const runScreen = useCallback(async () => {
    if (!creds) return;
    setScreenLoading(true);
    setScreenErr(null);
    setSigns([]);
    setDips([]);
    setSetups([]);
    setEvents([]);
    try {
      let eventNote = "";
      const eventRes = await fetchDartEventsFn({ data: {} });
      if (eventRes.ok) {
        setEvents(eventRes.events);
        eventNote = eventRes.note;
        setScreenSkip(eventNote);
      } else {
        setScreenErr(eventRes.error);
      }
      const uniRes = await fetchUniverseFn({ data: { ...creds, todayTop: scanSize } });
      if (!uniRes.ok) {
        setScreenErr(uniRes.error);
        return;
      }
      const pool = uniRes.universe.selected.filter((s) => s.code);
      setScreenTotal(pool.length);
      setScreenDone(0);
      setScreenNote(uniRes.universe.notes[0] ?? "A∪B∪C");
      const allSigns: SignHit[] = [];
      const allDips: DipHit[] = [];
      const allSetups: DipSetup[] = [];
      const tally = new Map<string, number>();
      const errors: string[] = [];
      for (let i = 0; i < pool.length; i += 5) {
        const chunk = pool.slice(i, i + 5);
        const res = await screenChunkFn({
          data: {
            ...creds,
            items: chunk.map((s) => ({
              code: s.code,
              name: s.name,
              price: s.price,
              changeRatePct: s.changeRatePct,
              volume: s.volume,
            })),
            asOf: asOfDate || undefined,
            time: asOfTime || undefined,
          },
        });
        if (!res.ok) {
          errors.push(res.error);
        } else {
          allSigns.push(...res.signs);
          allDips.push(...res.dips);
          allSetups.push(...(res.setups ?? []));
          for (const reason of res.reasons) tally.set(reason, (tally.get(reason) ?? 0) + 1);
          errors.push(...res.errors);
        }
        setScreenDone(Math.min(pool.length, i + chunk.length));
        setSigns([...allSigns]);
        setDips([...allDips].sort((a, b) => a.priority - b.priority));
        setSetups([...allSetups].sort((a, b) => b.score - a.score));
      }
      const breakdown = [...tally.entries()].map(([k, n]) => `${k} ${n}`).join(" · ");
      setScreenNote(
        `A∪B∪C ${pool.length}종목 전부 일봉·뉴스를 조회했습니다. ${uniRes.universe.notes[0] ?? ""} 탈락 집계: ${breakdown || "없음"}`,
      );
      setScreenSkip(
        `${eventNote} 가격 조건 목록만 거래대금 유니버스를 쓰고, 업종은 전력·에너지·지주·조선·방산·2차전지를 포함합니다. 공시에 없는 발표일은 만들지 않습니다.`,
      );
      if (errors.length) setScreenErr(errors.slice(0, 3).join(" · "));
    } catch (e) {
      setScreenErr(e instanceof Error ? e.message : String(e));
    } finally {
      setScreenLoading(false);
    }
  }, [creds, scanSize, asOfDate, asOfTime]);

  const openStock = useCallback(
    (code: string, name: string, known?: BoardStock) => {
      const hit = known ?? board.find((b) => b.code === code);
      if (hit) {
        setPopup({ code, name: hit.name, stock: hit, error: null, loading: false });
        return;
      }
      if (!/^\d{6}$/.test(code)) {
        setPopup({ code, name, stock: null, error: "6자리 종목코드가 없어 팝업을 열 수 없습니다.", loading: false });
        return;
      }
      if (!creds) {
        setPopup({ code, name, stock: null, error: "시세 키가 없습니다.", loading: false });
        return;
      }
      setPopup({ code, name, stock: null, error: null, loading: true });
      void stockBoardFn({ data: { ...creds, code, asOf: asOfDate || undefined, time: asOfTime || undefined } })
        .then((res) => {
          if (!res.ok) {
            setPopup({ code, name, stock: null, error: res.error, loading: false });
            return;
          }
          setPopup({ code, name: res.stock.name, stock: res.stock, error: null, loading: false });
        })
        .catch((e) => {
          setPopup({ code, name, stock: null, error: e instanceof Error ? e.message : String(e), loading: false });
        });
    },
    [asOfDate, asOfTime, board, creds],
  );

  useEffect(() => {
    if ((nav !== "signs" && nav !== "dip") || !creds || screenOnce.current || screenLoading) return;
    screenOnce.current = true;
    void runScreen();
  }, [nav, creds, runScreen, screenLoading]);

  const remainPct = useMemo(() => {
    if (!token.hasToken || !token.totalSeconds) return 0;
    return ((token.secondsRemaining ?? 0) / token.totalSeconds) * 100;
  }, [token]);

  if (!hydrated) return <div className="min-h-dvh bg-bg" />;

  const navItems: { id: NavId; label: string; icon: typeof LayoutDashboard }[] = [
    { id: "scan", label: "자동스캔", icon: LayoutDashboard },
    { id: "closing", label: "종가베팅", icon: Crosshair },
    { id: "analysis", label: "분석 STOCK", icon: Search },
    { id: "minute", label: "분봉", icon: Activity },
    { id: "signs", label: "사전징후", icon: AlertTriangle },
    { id: "dip", label: "저가매수", icon: TrendingDown },
    { id: "news", label: "시황·뉴스", icon: Newspaper },
    { id: "keys", label: "API 설정", icon: KeyRound },
  ];

  return (
    <div className="min-h-dvh bg-bg text-fg">
      <div className="flex min-h-dvh">
        {sidebarOpen ? (
          <button
            type="button"
            className="fixed inset-0 z-20 bg-black/30 md:hidden"
            aria-label="메뉴 닫기"
            onClick={() => setSidebarOpen(false)}
          />
        ) : null}
        <aside
          className={cn(
            "fixed inset-y-0 left-0 z-30 flex h-dvh shrink-0 flex-col border-r border-border bg-bg-elevated transition-[width,transform] duration-200 md:sticky md:z-20",
            sidebarOpen ? "w-56 translate-x-0" : "w-0 -translate-x-full overflow-hidden md:w-14 md:translate-x-0",
          )}
        >
          <div className="flex h-14 items-center justify-between px-3">
            {sidebarOpen ? <p className="text-sm font-semibold tracking-tight">세력추적</p> : null}
            <button
              type="button"
              className="inline-flex size-10 items-center justify-center rounded-md text-fg-muted hover:bg-bg-subtle"
              onClick={() => setSidebarOpen((v) => !v)}
              aria-label="메뉴"
            >
              {sidebarOpen ? <ChevronLeft className="size-4" /> : <PanelLeft className="size-4" />}
            </button>
          </div>
          <nav className="flex flex-1 flex-col gap-1 p-2">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.id}>
                  <button
                    type="button"
                    onClick={() => setNav(item.id)}
                    className={cn(
                      "flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-sm font-medium",
                      nav === item.id ? "bg-accent text-accent-fg" : "text-fg-muted hover:bg-bg-subtle hover:text-fg",
                    )}
                  >
                    <Icon className="size-4 shrink-0" />
                    {sidebarOpen ? item.label : <span className="sr-only">{item.label}</span>}
                  </button>
                  {item.id === "scan" && sidebarOpen ? (
                    <div className="ml-7 mt-1 flex flex-wrap gap-1 pb-1">
                      {([50, 100, 300] as const).map((n) => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => {
                            setScanSize(n);
                            setNav("scan");
                          }}
                          className={cn(
                            "h-8 min-w-11 rounded-md px-2 text-xs",
                            scanSize === n ? "bg-bg-subtle font-medium text-fg" : "text-fg-subtle hover:text-fg",
                          )}
                        >
                          {n}개
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
            <button
              type="button"
              onClick={() => void loadUniverse(true)}
              className="mt-2 flex min-h-11 items-center gap-3 rounded-md px-3 text-sm text-fg-muted hover:bg-bg-subtle hover:text-fg"
            >
              <RefreshCw className={cn("size-4 shrink-0", uniLoading && "animate-spin")} />
              {sidebarOpen ? "유니버스 갱신" : <span className="sr-only">유니버스 갱신</span>}
            </button>
            <a
              href="/kis-scanner-render.zip"
              download="kis-scanner-render.zip"
              className="mt-auto flex min-h-11 items-center gap-3 rounded-md px-3 text-sm text-fg-muted hover:bg-bg-subtle hover:text-fg"
            >
              <Download className="size-4 shrink-0" />
              {sidebarOpen ? "ZIP 다운로드" : <span className="sr-only">ZIP 다운로드</span>}
            </a>
          </nav>
          {sidebarOpen && (serverManaged || creds) ? (
            <p className="px-3 pb-4 font-mono text-[10px] text-fg-subtle">
              {serverManaged ? `서버 키 ${keyMask ?? ""}` : creds ? `KIS ${maskKey(creds.appKey)}` : ""}
              {dartOn ? " · DART" : ""}
            </p>
          ) : null}
        </aside>

        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-10 flex h-14 items-center justify-between gap-3 border-b border-border bg-bg/90 px-4 backdrop-blur">
            <div className="flex items-center gap-2 md:hidden">
              <button
                type="button"
                className="inline-flex size-10 items-center justify-center rounded-md"
                onClick={() => setSidebarOpen(true)}
              >
                <Menu className="size-4" />
              </button>
            </div>
            <p className="min-w-0 truncate text-sm font-medium">{navItems.find((item) => item.id === nav)?.label}</p>
            <div className="flex items-center gap-2">
              {creds ? <Badge tone="info">실전</Badge> : <Badge tone="warn">키 없음</Badge>}
              <Button size="sm" disabled={!creds || scanning} onClick={() => void runScan()}>
                <Activity />
                {scanning ? "스캔 중" : "자동스캔"}
              </Button>
            </div>
          </header>
          <div className="sticky top-14 z-10 flex gap-1 overflow-x-auto border-b border-border bg-bg px-4 py-2">
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setNav(item.id)}
                className={cn(
                  "h-9 shrink-0 rounded-full px-3 text-sm",
                  nav === item.id ? "bg-accent font-medium text-accent-fg" : "bg-bg-elevated text-fg-muted",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="ticker-track border-b border-border bg-bg-elevated">
            <p className="overflow-x-auto whitespace-nowrap px-4 py-2 font-mono text-[11px] text-fg-subtle">
              {(sihwang?.korean ?? []).map((t) => `${t.name} ${fmtPct(t.changeRatePct, 1)}`).join("   ·   ") ||
                "시황 로딩…"}
              {sihwangError ? `  ·  ${sihwangError}` : ""}
            </p>
          </div>

          <main className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-5 pb-16">
            {nav === "scan" || nav === "closing" || nav === "signs" || nav === "dip" || nav === "analysis" || nav === "minute" || nav === "news" ? (
              <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-bg-elevated px-3 py-2">
                <label className="flex flex-col gap-1 text-xs text-fg-subtle">
                  {nav === "scan"
                    ? "자동스캔"
                    : nav === "closing"
                      ? "종가베팅"
                      : nav === "signs"
                        ? "사전징후"
                        : nav === "dip"
                          ? "저가매수"
                          : nav === "analysis"
                            ? "분석 STOCK"
                            : nav === "news"
                              ? "시황"
                              : "분봉"}{" "}
                  기준일
                  <input
                    type="date"
                    value={asOfDate}
                    onChange={(e) => {
                      setAsOfDate(e.target.value);
                      if (!e.target.value) setAsOfTime("");
                    }}
                    className="h-9 rounded-md border border-border bg-bg px-2 text-sm text-fg"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-fg-subtle">
                  시각
                  <span className="flex items-center gap-1">
                    <input
                      type="time"
                      value={asOfTime}
                      onChange={(e) => setAsOfTime(e.target.value)}
                      className="h-9 rounded-md border border-border bg-bg px-2 text-sm text-fg"
                    />
                    <button
                      type="button"
                      className="h-9 rounded-md px-2 text-xs text-fg-muted hover:bg-bg-subtle"
                      onClick={() => setAsOfTime("")}
                    >
                      시각 지우기
                    </button>
                  </span>
                </label>
                <p className="max-w-xl text-xs text-fg-muted">
                  {nav === "news"
                    ? "날짜를 비우면 최신 시황입니다. 날짜를 넣으면 그날을 포함한 이전 3주의 기사만 남깁니다. 네이버증권, 연합뉴스, 구글 뉴스를 함께 가져옵니다."
                    : nav === "analysis" || nav === "minute"
                    ? "날짜를 비우면 최신 시세입니다. 날짜를 넣으면 그날 일봉으로 조건을 계산하고, 시각까지 분봉을 찾습니다. 분봉이 없으면 시간봉, 그것도 없으면 일봉 종가입니다. 다음 거래일 시가·고가·저가·종가로 유효 여부를 적습니다."
                    : "날짜와 시각을 비우면 최신 시세입니다. 날짜만 있으면 그날 일봉 종가입니다. 시각을 남기면 분석·분봉에서만 그 시각 가격을 찾습니다."}
                </p>
              </div>
            ) : null}
            {uniError ? <p className="text-sm text-down">{uniError}</p> : null}
            {universe ? (
              <p className="text-xs text-fg-subtle">{universe.notes.join(" ")}</p>
            ) : creds ? (
              <p className="text-xs text-fg-subtle">
                유니버스: 전일대금 상위200 ∪ 5일평균대금 상위200 ∪ 당일대금 상위50 · ETF·관리·신규상장 제외
              </p>
            ) : null}

            {scanning ? (
              <div>
                <div className="mb-1 flex justify-between font-mono text-[11px] text-fg-subtle">
                  <span>{scanProgress.stage}</span>
                  <span className="tabular">
                    {scanProgress.done}/{scanProgress.total || "—"}
                  </span>
                </div>
                <Progress value={scanProgress.total ? (scanProgress.done / scanProgress.total) * 100 : 0} />
              </div>
            ) : null}
            {scanError ? <p className="text-sm text-down">{scanError}</p> : null}

            {nav === "scan" ? (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <IndexSpark points={sihwang?.korean.find((t) => t.symbol === "KOSPI")?.history ?? []} label="코스피" />
                  <IndexSpark points={sihwang?.korean.find((t) => t.symbol === "KOSDAQ")?.history ?? []} label="코스닥" />
                </div>
                <ThemeBoard
                  rows={board}
                  fetchedLabel={scanAt ?? undefined}
                  headlines={news}
                  onOpen={(stock) => openStock(stock.code, stock.name, stock)}
                />
              </>
            ) : null}

            {nav === "closing" ? (
              <section className="flex flex-col gap-3">
                <h2 className="text-lg font-semibold">종가베팅 후보</h2>
                <p className="text-sm text-fg-muted">
                  유동성 하한 시총 1,000억원 · 섹터 동조 · 재료 지속성. 충족 조건과 품질검증을 펼칩니다.
                </p>
                {!closing.length ? (
                  <Card>
                    <p className="text-sm text-fg-muted">자동스캔을 실행하면 A∪B∪C 종목의 종가베팅 통과 여부가 여기에 모입니다.</p>
                  </Card>
                ) : (
                  closing.map((c) => (
                    <Card key={c.stockCode}>
                      <CardHeader>
                        <CardTitle>
                          <button
                            type="button"
                            className="text-left hover:underline"
                            onClick={() => openStock(c.stockCode, c.stockName ?? c.stockCode)}
                          >
                            {c.stockName}{" "}
                            <span className="font-mono text-sm font-normal text-fg-subtle">{c.stockCode}</span>
                          </button>
                        </CardTitle>
                        <CardDesc>
                          충족 {c.matchScore}/5 · {c.reasonSummary}
                          {c.verifyNote ? ` · ${c.verifyNote}` : ""}
                        </CardDesc>
                      </CardHeader>
                      <p className="text-sm">
                        {fmtWon(c.currentPrice)} · {fmtPct(c.changeRatePct)} · 목표 {fmtWon(c.targetPrice)} · 이탈{" "}
                        {fmtWon(c.stopLoss)}
                      </p>
                      <p className="mt-1 text-xs text-fg-subtle">{c.targetBasis} · {c.stopLossBasis}</p>
                      {(board.find((b) => b.code === c.stockCode)?.newsTitles ?? []).slice(0, 2).map((t) => (
                        <p key={t} className="mt-1 text-xs text-fg-muted">
                          {t}
                        </p>
                      ))}
                      <ul className="mt-3 grid gap-1 sm:grid-cols-2">
                        {[...c.conditions, ...c.qualityChecks].map((q) => (
                          <li key={q.label} className="flex gap-2 text-xs text-fg-muted">
                            <span
                              className={cn(
                                "mt-1 size-2 shrink-0 rounded-full",
                                q.status === "pass" ? "bg-up" : q.status === "fail" ? "bg-down" : "bg-fg-subtle",
                              )}
                            />
                            <span>
                              <span className="text-fg">{q.label}</span> — {q.detail}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </Card>
                  ))
                )}
              </section>
            ) : null}

            {nav === "minute" ? (
              <section className="flex flex-col gap-3">
                <h2 className="text-lg font-semibold">분봉 검증</h2>
                <p className="text-sm text-fg-muted">
                  지정 날짜·시각까지의 분봉을 시간봉으로 묶습니다. 분봉이 없으면 그날 일봉 종가와 다음 거래일을 비교합니다.
                </p>
                <form
                  className="flex flex-col gap-2 sm:flex-row"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!creds || !minuteCode.trim()) return;
                    setMinuteLoading(true);
                    setMinuteNote("");
                    void minuteCheckFn({
                      data: { ...creds, code: minuteCode.trim(), date: asOfDate || new Date().toISOString().slice(0, 10), time: asOfTime || undefined },
                    })
                      .then((res) => {
                        if (!res.ok) {
                          setMinuteRows([]);
                          setMinuteNote(res.error);
                          return;
                        }
                        setMinuteRows(res.hourly);
                        setMinuteNote(`${res.note} 기준가 ${res.priceAt ?? "—"} · 분봉 ${res.bars}개. ${res.verify}`);
                      })
                      .catch((err) => setMinuteNote(err instanceof Error ? err.message : String(err)))
                      .finally(() => setMinuteLoading(false));
                  }}
                >
                  <Input
                    value={minuteCode}
                    onChange={(e) => setMinuteCode(e.target.value)}
                    placeholder="005930"
                    className="sm:max-w-xs"
                  />
                  <Button type="submit" disabled={minuteLoading || !creds}>
                    {minuteLoading ? "조회 중…" : "분봉 확인"}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={!/^\d{6}$/.test(minuteCode.trim().padStart(6, "0"))}
                    onClick={() => openStock(minuteCode.trim().padStart(6, "0"), minuteCode.trim())}
                  >
                    차트·수급
                  </Button>
                </form>
                {minuteNote ? <p className="text-sm text-fg-muted">{minuteNote}</p> : null}
                {minuteRows.length ? (
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full text-left text-sm">
                      <thead className="text-xs text-fg-subtle">
                        <tr>
                          <th className="px-3 py-2">시간</th>
                          <th className="px-3 py-2">시가</th>
                          <th className="px-3 py-2">고가</th>
                          <th className="px-3 py-2">저가</th>
                          <th className="px-3 py-2">종가</th>
                        </tr>
                      </thead>
                      <tbody>
                        {minuteRows.map((r) => (
                          <tr key={r.hour} className="border-t border-border">
                            <td className="px-3 py-2">{r.hour}</td>
                            <td className="px-3 py-2">{r.open ?? "—"}</td>
                            <td className="px-3 py-2">{r.high ?? "—"}</td>
                            <td className="px-3 py-2">{r.low ?? "—"}</td>
                            <td className="px-3 py-2">{r.close ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </section>
            ) : null}

            {nav === "analysis" ? (
              <SkillPicksPanel
                creds={creds}
                loading={analysisLoading}
                error={skillErr ?? analysisErr}
                onRun={runSkill}
                result={skillResult}
                onPick={openStock}
              />
            ) : null}

            {nav === "signs" || nav === "dip" ? (
              <section className="flex flex-col gap-3">
                <button
                  type="button"
                  className="self-start text-sm text-fg-muted underline"
                  disabled={screenLoading || !creds}
                  onClick={() => void runScreen()}
                >
                  {screenLoading ? `추출 중 ${screenDone}/${screenTotal || "…"}` : "A∪B∪C 전체 다시 추출"}
                </button>
                {screenLoading ? <Progress value={screenTotal ? (screenDone / screenTotal) * 100 : 5} /> : null}
                {screenErr ? <p className="text-sm text-down">{screenErr}</p> : null}
                {nav === "signs" ? <SignsPanel signs={signs} note={screenNote} skipped={screenSkip} onPick={openStock} /> : null}
                {nav === "dip" ? (
                  <DipPanel dips={dips} events={events} setups={setups} note={screenNote} skipped={screenSkip} onPick={openStock} />
                ) : null}
              </section>
            ) : null}

            {nav === "news" ? (
              <section className="flex flex-col gap-4">
                <h2 className="text-lg font-semibold">시황 · 주요 뉴스</h2>
                <p className="text-xs text-fg-subtle">네이버증권, 연합뉴스, 구글 뉴스. 제목 아래는 받아 온 본문 일부입니다.</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {(sihwang?.korean ?? []).map((t) => (
                    <Card key={t.symbol}>
                      <p className="text-xs text-fg-subtle">{t.name}</p>
                      <p className="tabular text-lg font-semibold">
                        {t.price?.toLocaleString("ko-KR") ?? "—"}{" "}
                        <span className="text-sm font-medium">{fmtPct(t.changeRatePct)}</span>
                      </p>
                    </Card>
                  ))}
                </div>
                <ul className="flex flex-col gap-2">
                  {news.length ? (
                    news.slice(0, 12).map((n) => (
                      <li key={`${n.source ?? ""}-${n.title}`} className="rounded-lg bg-bg-elevated px-4 py-3 shadow-[var(--shadow-border)]">
                        <p className="text-sm font-medium">{n.title}</p>
                        {n.summary ? <p className="mt-1 text-xs leading-relaxed text-fg-muted">{n.summary}</p> : null}
                        <p className="text-[11px] text-fg-subtle">
                          {n.source} · {n.pubDate}
                        </p>
                      </li>
                    ))
                  ) : (
                    <li className="text-sm text-fg-muted">시황 뉴스를 받지 못했습니다. 잠시 후 다시 열어 주세요.</li>
                  )}
                </ul>
              </section>
            ) : null}

            {nav === "keys" ? (
              <Card>
                <CardHeader>
                  <CardTitle>한국투자증권 실전 키</CardTitle>
                  <CardDesc>
                    {serverManaged
                      ? "키는 이 서버 환경변수에만 있습니다. 화면과 저장소에는 넣지 않습니다. 브라우저에 남아 있던 복사본은 지웠습니다."
                      : "서버에 KIS_APP_KEY / KIS_APP_SECRET 이 없습니다. Render Environment에 넣거나, 아래에서 이 기기에만 임시로 입력하세요."}
                  </CardDesc>
                </CardHeader>
                <Progress value={remainPct} />
                <p className="mt-2 text-xs text-fg-subtle">
                  {serverManaged ? `사용 중 ${keyMask ?? ""}` : "서버 키 없음"}
                  {dartOn ? " · DART 연결됨" : " · DART 키 없음"}
                  {token.hasToken ? ` · 토큰 ${Math.floor((token.secondsRemaining ?? 0) / 60)}분 남음` : " · 토큰 없음"}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {serverManaged ? null : (
                    <Button onClick={() => setKeyOpen(true)}>
                      <KeyRound />키 입력
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    disabled={!creds}
                    onClick={async () => {
                      if (!creds) return;
                      const res = await refreshToken({ data: creds });
                      if (res.ok) setToken(res.token);
                    }}
                  >
                    토큰 갱신
                  </Button>
                  {serverManaged ? null : (
                    <Button
                      variant="ghost"
                      onClick={() => {
                        clearCreds();
                        setCreds(null);
                      }}
                    >
                      삭제
                    </Button>
                  )}
                </div>
              </Card>
            ) : null}

            <footer className="mt-4 flex items-start gap-2 text-xs text-fg-subtle">
              <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
              참고 자료입니다. 매매 책임은 사용자에게 있습니다. 데이터가 없으면 판단불가로 두며 시세·뉴스를 만들지 않습니다.
            </footer>
          </main>
        </div>
      </div>

      <Dialog open={keyOpen} onOpenChange={setKeyOpen}>
        <DialogContent>
          <DialogTitle>KIS 실전 APP KEY · SECRET KEY</DialogTitle>
          <DialogDesc>한국투자증권 Open API 실전 키만 입력하세요. 모의투자 키는 거래대금 순위가 비어 있습니다.</DialogDesc>
          <div className="mt-4 flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="appkey">APP KEY</Label>
              <Input id="appkey" value={draftKey} onChange={(e) => setDraftKey(e.target.value)} autoComplete="off" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="secret">SECRET KEY</Label>
              <Input
                id="secret"
                type="password"
                value={draftSecret}
                onChange={(e) => setDraftSecret(e.target.value)}
                autoComplete="off"
              />
            </div>
            {connectLog ? (
              <pre className="max-h-32 overflow-auto rounded-md bg-bg-subtle p-2 text-[11px] text-fg-muted">
                {connectLog}
              </pre>
            ) : null}
            {connectOk === false ? <p className="text-sm text-down">연결 실패</p> : null}
            <Button disabled={connecting} onClick={() => void handleConnect()}>
              {connecting ? "확인 중…" : "저장하고 연결"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(popup)} onOpenChange={(v) => !v && setPopup(null)}>
        <DialogContent className="max-w-2xl">
          {popup?.loading ? (
            <>
              <DialogTitle>
                {popup.name} <span className="font-mono text-sm font-normal text-fg-subtle">{popup.code}</span>
              </DialogTitle>
              <DialogDesc>시세·차트·수급을 불러오는 중입니다.</DialogDesc>
            </>
          ) : popup?.error ? (
            <>
              <DialogTitle>{popup.name || popup.code}</DialogTitle>
              <DialogDesc>{popup.error}</DialogDesc>
            </>
          ) : popup?.stock ? (
            <StockDetail stock={popup.stock} />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
