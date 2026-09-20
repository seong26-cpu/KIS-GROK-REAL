import * as React from "react";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "flex h-11 w-full rounded-sm bg-bg px-3 text-sm text-fg shadow-[var(--shadow-border)] placeholder:text-fg-subtle transition-[box-shadow] duration-150 focus-visible:shadow-[var(--shadow-border-hover)] disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
