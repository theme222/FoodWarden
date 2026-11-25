import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function InventoryRow({
  name,
  category,
  emoji,
  quantity,
  status,
  statusLabel,
  expiry,
  href,
  photoUrl,
  selection,
  selected,
  actions,
}: {
  name: string;
  category: string;
  emoji: string;
  quantity: number;
  status: "fresh" | "soon" | "expired" | "neutral";
  statusLabel: string;
  expiry: string;
  href?: string;
  photoUrl?: string;
  selection?: ReactNode;
  selected?: boolean;
  actions?: ReactNode;
}) {
  const content = (
    <>
      <div className="relative grid size-11 place-items-center overflow-hidden rounded-md bg-secondary text-xl">
        <span aria-hidden="true">{emoji}</span>
        {photoUrl && (
          <img
            src={photoUrl}
            loading="lazy"
            alt=""
            className="absolute inset-0 size-full object-cover"
            onError={(event) => {
              event.currentTarget.hidden = true;
            }}
          />
        )}
      </div>
      <div className="min-w-0">
        <div className="font-semibold wrap-anywhere">{name}</div>
        <div className="text-sm text-muted-foreground">
          {category}
          {quantity > 1 && <span className="tabular-nums"> · ×{quantity}</span>}
        </div>
      </div>
    </>
  );

  const detailsClass =
    "grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-md text-inherit no-underline";

  return (
    <li
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_auto] gap-2 px-3 py-2.5 @sm:grid-cols-[minmax(0,1fr)_auto_auto] @sm:items-center @sm:gap-4",
        selected && "bg-accent",
      )}
    >
      <div className="col-span-2 flex min-w-0 items-center gap-2 @sm:col-span-1">
        {selection}
        {href ? (
          <Link
            className={cn(
              detailsClass,
              "hover:text-leaf focus-visible:-outline-offset-2",
            )}
            to={href}
          >
            {content}
          </Link>
        ) : (
          <div className={detailsClass}>{content}</div>
        )}
      </div>
      <div className="flex min-w-0 flex-wrap content-center items-center gap-x-2 gap-y-1 text-sm @sm:flex-col @sm:items-end">
        <Badge variant={status}>{statusLabel}</Badge>
        <span className="text-muted-foreground tabular-nums">{expiry}</span>
      </div>
      {actions && (
        <div className="flex flex-wrap items-center justify-end gap-1">
          {actions}
        </div>
      )}
    </li>
  );
}
