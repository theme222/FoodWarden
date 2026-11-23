import { cva } from "class-variance-authority";

export const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center gap-2 rounded-full border-0 font-semibold whitespace-nowrap transition-[background-color,filter,transform] outline-none select-none cursor-pointer focus-visible:outline-[3px] focus-visible:outline-ring focus-visible:outline-offset-2 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5",
  {
    variants: {
      variant: {
        default: "bg-card text-foreground hover:bg-secondary",
        secondary: "bg-secondary text-foreground hover:bg-accent",
        primary:
          "bg-primary text-primary-foreground hover:brightness-125 [&_svg]:text-[var(--lime)]",
        take: "bg-[var(--take)] text-white hover:bg-[var(--take-hover)] [&_svg]:text-white",
        destructive: "bg-destructive text-white hover:brightness-110",
        dangerGhost:
          "bg-secondary text-destructive hover:bg-[var(--bad-soft)]",
        lime: "bg-[var(--lime)] text-[var(--lime-ink)] hover:brightness-95",
        google:
          "bg-white text-[#161A12] hover:bg-[var(--lime)] hover:text-[var(--lime-ink)]",
        outline:
          "bg-secondary text-foreground hover:bg-accent",
        ghost:
          "bg-transparent hover:bg-secondary hover:text-foreground",
        link: "rounded-none bg-transparent px-0 text-destructive underline underline-offset-3 hover:opacity-80",
        iconEdit:
          "rounded-[14px] bg-[var(--edit-soft)] text-[var(--edit-ink)] hover:bg-[#f2df9e] hover:text-[#472f00]",
        iconDelete:
          "rounded-[14px] bg-[var(--bad-soft)] text-[var(--bad-ink)] hover:bg-[var(--bad)] hover:text-white",
      },
      size: {
        default: "min-h-[46px] px-[18px] py-[10px] text-base",
        big: "min-h-[54px] px-[22px] py-[13px] text-[1.05rem]",
        lg: "min-h-[54px] px-[22px] py-[13px] text-[1.05rem]",
        sm: "min-h-[40px] px-[14px] py-[6px] text-[0.9rem]",
        xs: "min-h-[34px] px-3 py-1 text-xs",
        google: "min-h-[58px] px-5 py-[14px] text-[1.08rem]",
        icon: "size-[46px] rounded-[14px] [&_svg]:size-[22px]",
        "icon-sm": "size-[38px] rounded-[12px] [&_svg]:size-[18px]",
        "icon-xs": "size-7 rounded-[10px] [&_svg]:size-3.5",
        "icon-lg": "size-[52px] rounded-[16px] [&_svg]:size-6",
        close:
          "size-[46px] rounded-full bg-secondary text-foreground hover:bg-accent [&_svg]:size-6",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);
