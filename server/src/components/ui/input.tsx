import * as React from "react";
import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "min-h-9 w-full min-w-0 rounded-md border border-[var(--border)] bg-card px-3 py-1.5 text-base text-foreground shadow-none transition-colors outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-[var(--bad-border)] aria-invalid:bg-[var(--bad-soft)]",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
