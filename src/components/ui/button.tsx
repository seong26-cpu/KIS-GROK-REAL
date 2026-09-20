import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-sm text-sm font-medium transition-[opacity,transform,background-color,box-shadow] duration-150 ease-[var(--ease-out-soft)] disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4 [&_svg]:shrink-0 min-h-11",
  {
    variants: {
      variant: {
        default: "bg-accent text-accent-fg hover:opacity-90 active:scale-[0.98]",
        secondary:
          "bg-bg-subtle text-fg shadow-[var(--shadow-border)] hover:shadow-[var(--shadow-border-hover)]",
        ghost: "text-fg-muted hover:text-fg hover:bg-bg-subtle",
        danger: "bg-bg-subtle text-down shadow-[var(--shadow-border)] hover:bg-[#fde8ee]",
      },
      size: {
        default: "px-4 py-2.5",
        sm: "min-h-9 px-3 py-1.5 text-xs rounded-xs",
        lg: "min-h-12 px-5 py-3 w-full",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
