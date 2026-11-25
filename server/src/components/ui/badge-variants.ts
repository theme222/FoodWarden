import { cva } from "class-variance-authority";

export const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1.5 rounded-sm border border-transparent px-3 py-1 text-xs font-semibold whitespace-nowrap [&>svg]:pointer-events-none [&>svg]:size-3.5",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        secondary: "bg-secondary text-secondary-foreground",
        outline: "border-[var(--border)] bg-transparent text-foreground",
        destructive:
          "border-[var(--bad-border)] bg-[var(--bad-surface)] text-[var(--bad-ink)]",
        lime: "bg-[var(--lime)] text-[var(--lime-ink)]",
        fresh:
          "border-[var(--fresh-border)] bg-[var(--fresh-surface)] text-[var(--fresh-ink)]",
        soon: "bg-[var(--soon-pill-bg)] text-soon-foreground",
        expired:
          "border-[var(--bad-border)] bg-[var(--bad-surface)] text-[var(--bad-ink)]",
        neutral: "bg-secondary text-muted-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);
