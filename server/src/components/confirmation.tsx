import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import type { Language } from "@/model";
import { words } from "@/words";

type ConfirmTone = "destructive" | "take";
type Request = {
  message: string;
  label: string;
  tone: ConfirmTone;
  resolve: (accepted: boolean) => void;
};
type Confirm = (
  message: string,
  label: string,
  tone?: ConfirmTone,
) => Promise<boolean>;

const ConfirmationContext = createContext<Confirm | null>(null);

export function ConfirmationProvider({
  children,
  language,
}: {
  children: ReactNode;
  language: Language;
}) {
  const [request, setRequest] = useState<Request | null>(null);
  const pending = useRef<Request | null>(null);
  const settle = useCallback((accepted: boolean) => {
    pending.current?.resolve(accepted);
    pending.current = null;
    setRequest(null);
  }, []);
  const confirm = useCallback<Confirm>(
    (message, label, tone = "destructive") =>
      new Promise((resolve) => {
        pending.current?.resolve(false);
        const next = { message, label, tone, resolve };
        pending.current = next;
        setRequest(next);
      }),
    [],
  );
  useEffect(
    () => () => {
      pending.current?.resolve(false);
      pending.current = null;
    },
    [],
  );
  return (
    <ConfirmationContext value={confirm}>
      {children}
      <AlertDialog
        open={request !== null}
        onOpenChange={(open) => {
          if (!open) settle(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{request?.label}</AlertDialogTitle>
            <AlertDialogDescription>{request?.message}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              type="button"
              variant="secondary"
              className="min-h-11"
              onClick={() => settle(false)}
            >
              {words[language].cancel}
            </AlertDialogCancel>
            <AlertDialogAction
              type="button"
              variant={request?.tone === "take" ? "take" : "destructive"}
              className="min-h-11"
              onClick={() => settle(true)}
            >
              {request?.label}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmationContext>
  );
}

export function useConfirm(): Confirm {
  const confirm = useContext(ConfirmationContext);
  if (!confirm) throw new Error("ConfirmationProvider is required.");
  return confirm;
}
