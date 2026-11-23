import { useState } from "react";
import { toast } from "sonner";
import { Star } from "lucide-react";
import { useFavorites, lineAction, favoriteMatches } from "./line-data";
import type { Food, Language } from "./model";

export function FavoriteToggle({
  food,
  fridgeId,
  language,
  className = "starbtn",
}: {
  food: Food;
  fridgeId: string;
  language: Language;
  className?: string;
}) {
  const state = useFavorites(fridgeId);
  const [busy, setBusy] = useState(false);
  const th = language === "th";
  const favorite = state.data?.items.find((item) =>
    favoriteMatches(item, food),
  );

  async function toggle() {
    if (busy || !state.data) return;
    setBusy(true);
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
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      className={className}
      disabled={busy || !state.data}
      aria-pressed={Boolean(favorite)}
      aria-label={
        (th
          ? favorite
            ? "นำออกจากของโปรด: "
            : "เพิ่มของโปรด: "
          : favorite
            ? "Remove favorite: "
            : "Favorite: ") + (th ? food.nameTh : food.nameEn)
      }
      onClick={() => void toggle()}
    >
      <Star
        size={17}
        fill={favorite ? "currentColor" : "none"}
        aria-hidden="true"
      />
    </button>
  );
}
