import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react";

import { Toaster as Sonner, type ToasterProps } from "sonner";

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      position="bottom-center"
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-5 text-[var(--lime)]" />,
        info: <InfoIcon className="size-5 text-[var(--lime)]" />,
        warning: <TriangleAlertIcon className="size-5 text-[var(--soon)]" />,
        error: <OctagonXIcon className="size-5 text-[#FF8A75]" />,
        loading: <Loader2Icon className="size-5 animate-spin text-[var(--lime)]" />,
      }}
      toastOptions={{
        classNames: {
          toast:
            "rounded-full border-0 bg-[var(--dark)] text-[var(--on-dark)] px-5 py-2.5 shadow-none font-medium gap-3",
          title: "text-[0.95rem] font-semibold text-[var(--on-dark)]",
          description: "text-[0.85rem] text-[var(--on-dark-2)]",
          actionButton:
            "!rounded-full !bg-[var(--lime)] !text-[var(--lime-ink)] !min-h-[38px] !px-4 !font-bold",
          cancelButton:
            "!rounded-full !bg-white/15 !text-[var(--on-dark)] !min-h-[38px] !px-3.5",
        },
      }}
      style={
        {
          "--normal-bg": "var(--dark)",
          "--normal-text": "var(--on-dark)",
          "--normal-border": "transparent",
          "--border-radius": "999px",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
