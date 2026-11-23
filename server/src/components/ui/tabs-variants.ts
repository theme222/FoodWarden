import { cva } from "class-variance-authority";

export const tabsListVariants = cva(
  "group/tabs-list inline-flex h-auto w-fit items-center justify-center gap-1 rounded-full border-0 p-1 text-muted-foreground group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col data-[variant=line]:rounded-none",
  {
    variants: {
      variant: {
        default: "bg-card",
        line: "gap-1 bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);
