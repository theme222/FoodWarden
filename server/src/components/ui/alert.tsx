import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const alertVariants = cva(
  "relative flex w-full flex-wrap items-center justify-between gap-3 rounded-[22px] border px-[18px] py-3.5 text-base shadow-none [&_svg]:size-5 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "border-[var(--border)] bg-card text-card-foreground",
        destructive:
          "border-[var(--bad-border)] bg-[var(--bad-surface)] text-[var(--bad-ink)] [&_svg]:text-[var(--bad)]",
        warning:
          "border-[var(--soon-border)] bg-[var(--soon-surface)] text-[var(--soon-ink)] [&_svg]:text-[var(--soon)]",
        success:
          "border-[var(--fresh-border)] bg-[var(--fresh-surface)] text-[var(--fresh-ink)] font-semibold [&_svg]:text-[var(--fresh)]",
        soft: "border-[var(--rule)] bg-[var(--lime-soft)] text-[var(--lime-ink)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Alert({
  className,
  variant,
  role = "alert",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role={role}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  );
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn("font-semibold tracking-tight", className)}
      {...props}
    />
  );
}

function AlertDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn("min-w-0 flex-1 text-[0.96rem] leading-snug font-medium", className)}
      {...props}
    />
  );
}

export { Alert, AlertTitle, AlertDescription };
