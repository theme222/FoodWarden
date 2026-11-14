import { Alert, AlertDescription } from "@/components/ui/alert";
export function StatusAlert({ children }: { children: React.ReactNode }) {
  return (
    <Alert variant="destructive">
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}
