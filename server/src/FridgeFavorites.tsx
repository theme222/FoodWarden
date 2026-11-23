import { useState } from "react";
import { Star, Heart } from "lucide-react";
import { toast } from "sonner";
import type { Language } from "./model";
import { useFavorites, lineAction } from "./line-data";
import type { Favorite } from "./line-data";
import { categoryLabel, categories } from "./words";
import { StatusAlert } from "./components/status-alert";

const copy = {
  th: {
    favorites: "ของโปรดของฉันในตู้นี้",
    private: "มีเพียงคุณที่เห็นรายการนี้ ทุกคนในครอบครัวเลือกของโปรดได้ต่างกัน",
    types: "หมวดอาหารโปรด",
    foods: "อาหารโปรด",
    loading: "กำลังโหลด…",
    loadError: "โหลดของโปรดไม่ได้",
    empty: "แตะดาวข้างอาหารที่ชอบ",
    categoryError: "บันทึกหมวดโปรดไม่สำเร็จ",
    remove: "ลบของโปรด ",
    removeError: "ลบไม่ได้",
    outOfStock: "หมดแล้ว · อาจต้องซื้อเพิ่ม",
  },
  en: {
    favorites: "My favorites in this fridge",
    private: "Only you see this list. Everyone has their own favorites.",
    types: "Favorite food types",
    foods: "Favorite foods",
    loading: "Loading…",
    loadError: "Could not load favorites",
    empty: "Star something you like in the food list above.",
    categoryError: "Could not save favorite categories",
    remove: "Remove favorite ",
    removeError: "Could not remove favorite",
    outOfStock: "Out of stock · buy more?",
  },
};

function useFavoritePreferences(fridgeId: string, language: Language) {
  const state = useFavorites(fridgeId);
  const [busy, setBusy] = useState(false);
  const t = copy[language];
  const base = `/api/fridges/${encodeURIComponent(fridgeId)}/favorites`;

  async function update(
    path: string,
    method: string,
    body: unknown,
    error: string,
  ) {
    if (busy) return;
    setBusy(true);
    try {
      await lineAction(base + path, method, body);
      await state.mutate();
    } catch {
      toast.error(error);
    } finally {
      setBusy(false);
    }
  }

  function toggle(category: string) {
    if (!state.data) return;
    const selected = new Set(state.data.categories);
    if (selected.has(category)) selected.delete(category);
    else selected.add(category);
    return update(
      "/categories",
      "PUT",
      { categories: [...selected] },
      t.categoryError,
    );
  }

  function remove(key: string) {
    return update("/" + key, "DELETE", undefined, t.removeError);
  }

  return { state, busy, toggle, remove };
}

type FavoritePreferences = ReturnType<typeof useFavoritePreferences>;

function FavoriteFoodRow({
  item,
  language,
  preferences,
}: {
  item: Favorite;
  language: Language;
  preferences: FavoritePreferences;
}) {
  const t = copy[language];
  const name = language === "th" ? item.name_th : item.name_en;
  const count =
    language === "th" ? `เหลือ ${item.count} ชิ้น` : `${item.count} left`;
  return (
    <li>
      <div>
        <strong>{name}</strong>
        <p className="small">{item.count ? count : t.outOfStock}</p>
      </div>
      <button
        type="button"
        className="btn sm"
        disabled={preferences.busy}
        aria-label={t.remove + name}
        onClick={() => void preferences.remove(item.item_key)}
      >
        <Star fill="currentColor" size={18} aria-hidden="true" />
      </button>
    </li>
  );
}

function FavoriteContents({
  language,
  preferences,
}: {
  language: Language;
  preferences: FavoritePreferences;
}) {
  const { state, busy, toggle } = preferences;
  const t = copy[language];
  if (state.error) {
    return (
      <StatusAlert
        action={
          <button
            type="button"
            className="btn sm"
            onClick={() => void state.mutate()}
          >
            {language === "th" ? "ลองใหม่" : "Retry"}
          </button>
        }
      >
        {t.loadError}
      </StatusAlert>
    );
  }
  if (!state.data) return <output className="sub">{t.loading}</output>;
  const selected = new Set(state.data.categories);
  return (
    <div className="flex flex-col gap-3">
      <details className="favorite-categories">
        <summary>{t.types}</summary>
        <div className="category-chips">
          {Object.keys(categories).map((category) => (
            <button
              key={category}
              type="button"
              className="chip"
              aria-pressed={selected.has(category)}
              disabled={busy}
              onClick={() => void toggle(category)}
            >
              {categoryLabel(category, language)} (
              {state.data!.category_counts[category] ?? 0})
            </button>
          ))}
        </div>
      </details>
      <h3>{t.foods}</h3>
      {!state.data.items.length ? (
        <p className="sub">{t.empty}</p>
      ) : (
        <ul className="favorite-list">
          {state.data.items.map((item) => (
            <FavoriteFoodRow
              key={item.item_key}
              item={item}
              language={language}
              preferences={preferences}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

export function FridgeFavorites({
  fridgeId,
  language,
}: {
  fridgeId: string;
  language: Language;
}) {
  const preferences = useFavoritePreferences(fridgeId, language);
  const t = copy[language];
  return (
    <section className="panel flex flex-col gap-3">
      <h2 className="flex items-center gap-2">
        <Heart size={20} aria-hidden="true" /> {t.favorites}
      </h2>
      <p className="sub">{t.private}</p>
      <FavoriteContents language={language} preferences={preferences} />
    </section>
  );
}
