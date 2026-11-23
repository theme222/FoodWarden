import { useState } from "react";
import type { FormEvent } from "react";
import { Star, Heart, Clock } from "lucide-react";
import { toast } from "sonner";
import type { Language } from "./model";
import { LineConnection } from "./LineConnection";
import { useLineStatus, useFavorites, lineAction } from "./line-data";
import type { Favorite } from "./line-data";
import { categoryLabel, categories } from "./words";
import { StatusAlert } from "./components/status-alert";
import { ThemeLanguagePicker } from "./components/theme-picker";
import type { ColorTheme } from "./state/dashboard-machine";

const copy = {
  th: {
    title: "ของฉัน",
    description:
      "LINE ของโปรด และการแจ้งเตือนเฉพาะคุณ การเปลี่ยนที่นี่ไม่กระทบคนอื่นในบ้าน",
    favorites: "ของโปรดของฉันในตู้นี้",
    private:
      "มีเพียงคุณที่เห็นรายการนี้ ทุกคนในครอบครัวเลือกของโปรดได้ต่างกัน",
    types: "หมวดอาหารโปรด",
    foods: "อาหารโปรด",
    loading: "กำลังโหลด…",
    loadError: "โหลดของโปรดไม่ได้",
    empty: "ไปที่รายการอาหาร แล้วแตะดาวข้างของที่ชอบ",
    categoryError: "บันทึกหมวดโปรดไม่สำเร็จ",
    remove: "ลบของโปรด ",
    removeError: "ลบไม่ได้",
    outOfStock: "หมดแล้ว · อาจต้องซื้อเพิ่ม",
    notifications: "การแจ้งเตือนของฉัน",
    morning: "สรุปตอนเช้า",
    morningEnabled: "ส่งสรุปให้ฉันทุกเช้า",
    time: "เวลา (ประเทศไทย)",
    morningHelp:
      "รวมอาหารใกล้หมดอายุ ของโปรด และสถานะจากทุกตู้ที่คุณเป็นสมาชิก หากไม่มีเรื่องให้รายงานจะไม่ส่ง",
    instant: "แจ้งทันทีเมื่อ",
    obstruct: "ประตูมีสิ่งกีดขวางหรืออุปกรณ์ผิดปกติ",
    warm: "ตู้เย็นร้อนเกินไป",
    spoil: "ค่า VOC สูง อาหารอาจเริ่มเสีย",
    saving: "กำลังบันทึก…",
    save: "บันทึกการแจ้งเตือน",
    saved: "บันทึกการแจ้งเตือนแล้ว",
    saveError: "บันทึกไม่ได้ กรุณาลองใหม่",
  },
  en: {
    title: "Me",
    description:
      "Your LINE, favorites and notifications. Changes here do not affect anyone else.",
    favorites: "My favorites in this fridge",
    private: "Only you see this list. Everyone has their own favorites.",
    types: "Favorite food types",
    foods: "Favorite foods",
    loading: "Loading…",
    loadError: "Could not load favorites",
    empty: "Open the food list and star something you like.",
    categoryError: "Could not save favorite categories",
    remove: "Remove favorite ",
    removeError: "Could not remove favorite",
    outOfStock: "Out of stock · buy more?",
    notifications: "My notifications",
    morning: "Morning summary",
    morningEnabled: "Send me a morning summary",
    time: "Time (Asia/Bangkok)",
    morningHelp:
      "Includes expiring food, favorites and activity from your fridges. Days with nothing to report are skipped.",
    instant: "Tell me right away when",
    obstruct: "Door obstruction or a device fault",
    warm: "The fridge gets too warm",
    spoil: "High VOC suggests possible spoilage",
    saving: "Saving…",
    save: "Save preferences",
    saved: "Notification preferences saved",
    saveError: "Could not save preferences",
  },
};

type Preferences = {
  morning_enabled: boolean;
  morning_time: string;
  inst_obstruct: boolean;
  inst_warm: boolean;
  inst_spoil: boolean;
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
      <h3>{t.types}</h3>
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

function FavoriteCategories({
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

function useNotificationPreferences(language: Language) {
  const profile = useLineStatus("/api/me/line");
  const [draft, setDraft] = useState<Preferences | null>(null);
  const [busy, setBusy] = useState(false);
  const t = copy[language];
  const value: Preferences = draft ?? {
    morning_enabled: profile.data?.morning_enabled ?? true,
    morning_time: profile.data?.morning_time ?? "07:30",
    inst_obstruct: profile.data?.inst_obstruct ?? true,
    inst_warm: profile.data?.inst_warm ?? true,
    inst_spoil: profile.data?.inst_spoil ?? true,
  };

  function change<K extends keyof Preferences>(key: K, next: Preferences[K]) {
    setDraft({ ...value, [key]: next });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await lineAction("/api/me/line", "PATCH", value);
      await profile.mutate();
      setDraft(null);
      toast.success(t.saved);
    } catch {
      toast.error(t.saveError);
    } finally {
      setBusy(false);
    }
  }

  return { profile, value, busy, change, save };
}

function NotificationPreferences({ language }: { language: Language }) {
  const { profile, value, busy, change, save } =
    useNotificationPreferences(language);
  const t = copy[language];
  const alerts = [
    ["inst_obstruct", t.obstruct],
    ["inst_warm", t.warm],
    ["inst_spoil", t.spoil],
  ] as const;

  return (
    <form
      onSubmit={(event) => void save(event)}
      className="panel notification-preferences flex flex-col gap-3"
    >
      <h2 className="flex items-center gap-2">
        <Clock size={20} aria-hidden="true" /> {t.notifications}
      </h2>
      <fieldset disabled={busy || !profile.data}>
        <div className="subblock">
          <h3>{t.morning}</h3>
          <label className="chk">
            <span>{t.morningEnabled}</span>
            <input
              type="checkbox"
              checked={value.morning_enabled}
              onChange={(e) => change("morning_enabled", e.target.checked)}
            />
          </label>
          <label className="flex flex-col gap-1.5 font-medium">
            {t.time}
            <input
              type="time"
              value={value.morning_time}
              disabled={!value.morning_enabled}
              onChange={(e) => change("morning_time", e.target.value)}
              required
            />
          </label>
          <p className="small">{t.morningHelp}</p>
        </div>

        <div className="subblock">
          <h3>{t.instant}</h3>
          {alerts.map(([key, label]) => (
            <label className="chk" key={key}>
              <span>{label}</span>
              <input
                type="checkbox"
                checked={value[key]}
                onChange={(e) => change(key, e.target.checked)}
              />
            </label>
          ))}
        </div>

        <div>
          <button type="submit" className="primary">
            {busy ? t.saving : t.save}
          </button>
        </div>
      </fieldset>
    </form>
  );
}

export function MyAccount({
  language,
  fridgeId,
  colorTheme = "green",
  onLanguageChange,
  onColorThemeChange,
}: {
  language: Language;
  fridgeId?: string;
  colorTheme?: ColorTheme;
  onLanguageChange?: (next: Language) => void;
  onColorThemeChange?: (next: ColorTheme) => void;
}) {
  const t = copy[language];
  return (
    <div className="settings">
      <div className="page-head">
        <div className="page-head-copy">
          <h1>{t.title}</h1>
          <p className="sub">{t.description}</p>
        </div>
      </div>
      <ThemeLanguagePicker
        language={language}
        colorTheme={colorTheme}
        onLanguageChange={onLanguageChange}
        onColorThemeChange={onColorThemeChange}
      />
      <LineConnection language={language} />
      <NotificationPreferences language={language} />
      {fridgeId && (
        <FavoriteCategories fridgeId={fridgeId} language={language} />
      )}
    </div>
  );
}
