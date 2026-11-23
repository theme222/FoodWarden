import { AlertTriangle, CheckCircle2 } from "lucide-react";
import type { ReactNode } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function StatusAlert({
  children,
  variant = "destructive",
  action,
}: {
  children: ReactNode;
  variant?: "destructive" | "warning" | "success";
  action?: ReactNode;
}) {
  return (
    <Alert
      variant={variant}
      role={variant === "success" ? "status" : "alert"}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        {variant === "success" ? (
          <CheckCircle2 aria-hidden="true" />
        ) : (
          <AlertTriangle aria-hidden="true" />
        )}
        <AlertDescription>{children}</AlertDescription>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </Alert>
  );
}
