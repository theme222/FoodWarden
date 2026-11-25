import { Toggle, ToggleIcon } from "@ui-sdk/react/toggle";
import { Star } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { favoriteMatches, lineAction, useFavorites } from "./line-data";
import type { Food, Language } from "./model";
import { foodName } from "./words";

export function FavoriteStar({
  name,
  language,
  pressed,
  disabled,
  busy,
  onToggle,
}: {
  name: string;
  language: Language;
  pressed: boolean;
  disabled?: boolean;
  busy?: boolean;
  onToggle: () => void;
}) {
  const th = language === "th";

  return (
    <Toggle
      aria-label={(th ? "รายการโปรด: " : "Favorite: ") + name}
      pressed={pressed}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      onPressedChange={onToggle}
      className="size-9 min-w-0 rounded-md border-0 bg-transparent p-0 text-muted-foreground shadow-none transition-none hover:bg-secondary disabled:opacity-50 data-pressed:bg-transparent data-pressed:text-leaf data-pressed:hover:bg-secondary pointer-coarse:size-11"
    >
      <ToggleIcon data-variant="fill">
        <Star size={18} fill={pressed ? "currentColor" : "none"} />
      </ToggleIcon>
    </Toggle>
  );
}

export function FavoriteToggle({
  food,
  fridgeId,
  language,
}: {
  food: Food;
  fridgeId: string;
  language: Language;
}) {
  const state = useFavorites(fridgeId);
  const [pending, setPending] = useState<boolean | null>(null);
  const busy = pending !== null;
  const th = language === "th";
  const favorite = state.data?.items.find((item) =>
    favoriteMatches(item, food),
  );

  async function toggle() {
    if (busy || !state.data) return;
    setPending(!favorite);
    try {
      await lineAction(
        `/api/fridges/${encodeURIComponent(fridgeId)}/favorites/${favorite ? favorite.item_key : encodeURIComponent(food.id)}`,
        favorite ? "DELETE" : "PUT",
      );
      await state.mutate();
      toast.success(
        th
          ? favorite
            ? "นำออกจากของโปรดแล้ว"
            : "เพิ่มในของโปรดแล้ว"
          : favorite
            ? "Removed from favorites"
            : "Added to favorites",
      );
    } catch {
      toast.error(th ? "บันทึกของโปรดไม่ได้" : "Could not save favorite");
    } finally {
      setPending(null);
    }
  }

  return (
    <FavoriteStar
      name={foodName(food, language)}
      language={language}
      pressed={pending ?? Boolean(favorite)}
      busy={busy}
      disabled={!state.data}
      onToggle={() => void toggle()}
    />
  );
}
