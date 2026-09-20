import * as React from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "rounded-xl bg-bg-elevated p-5 shadow-[var(--shadow-border)]",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("mb-4 flex flex-col gap-1", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return <h2 className={cn("text-base font-medium tracking-tight", className)} {...props} />;
}

export function CardDesc({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("text-sm text-fg-muted leading-relaxed", className)} {...props} />;
}
