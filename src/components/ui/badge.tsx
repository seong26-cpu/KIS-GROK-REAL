import * as React from "react";
import { cn } from "@/lib/utils";

export function Badge({
  className,
  tone = "neutral",
  ...props
}: React.ComponentProps<"span"> & { tone?: "neutral" | "up" | "down" | "warn" | "info" | "accent" }) {
  const tones: Record<string, string> = {
    neutral: "bg-bg-subtle text-fg-muted",
    up: "bg-[#fde8ee] text-up",
    down: "bg-[#e8eefc] text-down",
    warn: "bg-[#f8edd9] text-warn",
    info: "bg-[#e7eefc] text-info",
    accent: "bg-accent text-accent-fg",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-medium tracking-wide",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
