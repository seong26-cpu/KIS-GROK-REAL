import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export function PriceChart({
  bars,
}: {
  bars: { date: string; close: number; volume: number | null }[];
}) {
  if (bars.length < 2) {
    return <p className="text-sm text-fg-muted">일봉이 부족해 차트를 그리지 않습니다.</p>;
  }
  const data = bars.map((b) => ({
    ...b,
    label: b.date.slice(4, 6) && b.date.length >= 8 ? `${b.date.slice(4, 6)}.${b.date.slice(6, 8)}` : b.date.slice(-5),
  }));
  const first = data[0]!.close;
  const last = data[data.length - 1]!.close;
  const up = last >= first;
  const stroke = up ? "var(--color-up)" : "var(--color-down)";
  return (
    <div className="h-40 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="color-mix(in oklab, var(--color-fg) 8%, transparent)" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--color-fg-subtle)" }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
          <YAxis
            domain={["auto", "auto"]}
            width={52}
            tick={{ fontSize: 10, fill: "var(--color-fg-subtle)" }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) => Math.round(v).toLocaleString("ko-KR")}
          />
          <Tooltip
            contentStyle={{ background: "var(--color-bg-elevated)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }}
            formatter={(v) => [`${Number(v).toLocaleString("ko-KR")}원`, "종가"]}
          />
          <Line type="monotone" dataKey="close" stroke={stroke} strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function SupplyChart({
  rows,
}: {
  rows: { date: string; foreign: number | null; inst: number | null; individual: number | null }[];
}) {
  if (!rows.length) {
    return <p className="text-sm text-fg-muted">수급 데이터가 없어 표시하지 않습니다.</p>;
  }
  const data = rows.map((r) => ({
    label: r.date.length >= 8 ? `${r.date.slice(4, 6)}.${r.date.slice(6, 8)}` : r.date || "—",
    외국인: r.foreign ?? 0,
    기관: r.inst ?? 0,
    개인: r.individual ?? 0,
  }));
  return (
    <div className="h-36 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="color-mix(in oklab, var(--color-fg) 8%, transparent)" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--color-fg-subtle)" }} axisLine={false} tickLine={false} />
          <YAxis hide />
          <Tooltip
            contentStyle={{ background: "var(--color-bg-elevated)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }}
            formatter={(v) => [Number(v).toLocaleString("ko-KR"), ""]}
          />
          <Bar dataKey="외국인" fill="var(--color-up)" radius={2} />
          <Bar dataKey="기관" fill="var(--color-accent)" radius={2} />
          <Bar dataKey="개인" fill="var(--color-fg-subtle)" radius={2} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function IndexSpark({
  points,
  label,
}: {
  points: { date: string; close: number; changePct: number | null }[];
  label: string;
}) {
  if (points.length < 2) return null;
  const last = points[points.length - 1]!;
  const first = points[0]!;
  const up = last.close >= first.close;
  return (
    <div className="rounded-xl bg-bg-elevated p-3 shadow-[var(--shadow-card)]">
      <p className="text-[11px] text-fg-subtle">{label} 5거래일</p>
      <p className={`tabular text-sm font-semibold ${up ? "text-up" : "text-down"}`}>
        {last.close.toLocaleString("ko-KR")} {last.changePct != null ? `${last.changePct >= 0 ? "+" : ""}${last.changePct.toFixed(2)}%` : ""}
      </p>
      <div className="mt-1 h-12">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points}>
            <Line type="monotone" dataKey="close" stroke={up ? "var(--color-up)" : "var(--color-down)"} strokeWidth={1.5} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function CheckDots({ items }: { items: { label: string; status: "pass" | "fail" | "unknown" }[] }) {
  return (
    <ul className="flex flex-col gap-1">
      {items.map((c) => (
        <li key={c.label} className="flex items-center gap-2 text-xs">
          <CellDot status={c.status} />
          <span className="text-fg-muted">{c.label}</span>
        </li>
      ))}
    </ul>
  );
}

function CellDot({ status }: { status: "pass" | "fail" | "unknown" }) {
  const cls =
    status === "pass" ? "bg-up" : status === "fail" ? "bg-down" : "bg-fg-subtle";
  return <span className={`inline-block size-2 shrink-0 rounded-full ${cls}`} />;
}
