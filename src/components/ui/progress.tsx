import * as React from "react";
import { cn } from "@/lib/utils";

export function Progress({
  value,
  className,
  tone = "accent",
}: {
  value: number;
  className?: string;
  tone?: "accent" | "up" | "down" | "warn";
}) {
  const colors = {
    accent: "bg-accent",
    up: "bg-up",
    down: "bg-down",
    warn: "bg-warn",
  };
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-bg-subtle", className)}>
      <div
        className={cn("h-full rounded-full transition-[width] duration-250 ease-[var(--ease-out-soft)]", colors[tone])}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}
